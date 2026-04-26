import { EventEmitter } from "events";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";

import {
  CATEGORY_CONFIG_MAX_BODY_BYTES,
  createCategoryConfigMiddleware,
} from "../dev-server/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────

type MockReq = EventEmitter & {
  url: string;
  method: string;
  setEncoding: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader(key: string, value: string): void;
  end(msg?: string): void;
};

function makeMockReq(url: string, method: string): MockReq {
  const req = new EventEmitter() as MockReq;
  req.url = url;
  req.method = method;
  req.setEncoding = vi.fn();
  req.destroy = vi.fn();
  return req;
}

function makeMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: "",
    ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    end(msg = "") { this.body = msg; this.ended = true; },
  };
  return res;
}

/** Minimal valid category config payload. */
const VALID_CONFIG = JSON.stringify({ categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }] });

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createCategoryConfigMiddleware", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cat-cfg-"));
    configPath = join(tmpDir, "categories.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calls next() for URLs other than /__category-config", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    const req = makeMockReq("/some-other-url", "PUT");
    const res = makeMockRes();
    const next = vi.fn();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.ended).toBe(false);
  });

  it("responds 405 for non-PUT methods", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    for (const method of ["GET", "POST", "DELETE", "PATCH"]) {
      const req = makeMockReq("/__category-config", method);
      const res = makeMockRes();
      handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());
      expect(res.statusCode, `method ${method}`).toBe(405);
      expect(res.ended).toBe(true);
    }
  });

  it("responds 413 and calls req.destroy() when body exceeds 1 MiB", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    // One chunk that is just over the limit
    req.emit("data", "x".repeat(CATEGORY_CONFIG_MAX_BODY_BYTES + 1));

    expect(res.statusCode).toBe(413);
    expect(res.body).toBe("Request entity too large");
    expect(res.ended).toBe(true);
    expect(req.destroy).toHaveBeenCalledOnce();
  });

  it("does not overwrite a 413 response when the end event fires after a large body", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    req.emit("data", "x".repeat(CATEGORY_CONFIG_MAX_BODY_BYTES + 1));
    // Simulate stream emitting end after destroy
    req.emit("end");

    expect(res.statusCode).toBe(413); // must not be overwritten
  });

  it("responds 400 for invalid JSON body", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    req.emit("data", "not-valid-json{{{");
    req.emit("end");

    expect(res.statusCode).toBe(400);
  });

  it("responds 400 for valid JSON that fails normalizeCategoryConfig validation", () => {
    const handler = createCategoryConfigMiddleware(configPath, vi.fn(), vi.fn());
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    req.emit("data", JSON.stringify({ notCategories: true }));
    req.emit("end");

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("Invalid category config");
  });

  it("writes the config file and responds 204 for a valid body", () => {
    const onWritten = vi.fn();
    const handler = createCategoryConfigMiddleware(configPath, onWritten, vi.fn());
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    req.emit("data", VALID_CONFIG);
    req.emit("end");

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(onWritten).toHaveBeenCalledOnce();

    const written = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
    expect(written).toMatchObject({ categories: [{ id: "Drum" }] });
  });

  it("responds 500 and calls warnLog when writeFileSync throws", () => {
    const warnLog = vi.fn();
    // configPath inside a directory that does not exist → writeFileSync will throw
    const badPath = join(tmpDir, "nonexistent-subdir", "categories.json");
    const handler = createCategoryConfigMiddleware(badPath, vi.fn(), warnLog);
    const req = makeMockReq("/__category-config", "PUT");
    const res = makeMockRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn());

    req.emit("data", VALID_CONFIG);
    req.emit("end");

    expect(res.statusCode).toBe(500);
    expect(warnLog).toHaveBeenCalledOnce();
    expect(warnLog.mock.calls[0][0]).toContain("[manage-category-config]");
  });
});
