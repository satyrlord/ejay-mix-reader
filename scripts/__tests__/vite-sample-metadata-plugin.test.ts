import { EventEmitter } from "events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { SAMPLE_METADATA_UPDATED_EVENT } from "../../src/data.js";
import { manageSampleMetadata } from "../dev-server/sample-metadata-plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockServer {
  ws: { send: Mock };
  middlewares: { use: Mock };
  config: { logger: { warn: Mock } };
}

function makeMockServer(): MockServer {
  return {
    ws: { send: vi.fn() },
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn() } },
  };
}

interface FakeReq extends EventEmitter {
  url?: string;
  method?: string;
  setEncoding: Mock;
  destroy: Mock;
}

function makeReq(url: string, method = "PUT"): FakeReq {
  const req = Object.assign(new EventEmitter(), {
    url,
    method,
    setEncoding: vi.fn(),
    destroy: vi.fn(),
  }) as FakeReq;
  return req;
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk?: string) { if (chunk !== undefined) this.body = chunk; },
  };
}

type Mw = (req: FakeReq, res: FakeRes, next: () => void) => void;

/** Call `plugin.configureServer`, return the registered middleware. */
function getMw(outputRoot: string, server: MockServer): Mw {
  (manageSampleMetadata(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
  return server.middlewares.use.mock.calls[0][0] as Mw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("manageSampleMetadata", () => {
  let outputRoot: string;

  beforeEach(() => {
    outputRoot = mkdtempSync(join(tmpdir(), "sample-meta-"));
  });

  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'manage-sample-metadata'", () => {
    expect(manageSampleMetadata(outputRoot).name).toBe("manage-sample-metadata");
  });

  it("has a configureServer hook", () => {
    expect(typeof manageSampleMetadata(outputRoot).configureServer).toBe("function");
  });

  describe("middleware routing", () => {
    it("calls next() for unrelated URLs", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const next = vi.fn();
      mw(makeReq("/other"), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("responds 405 for non-PUT methods on /__sample-move", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const res = makeRes();
      mw(makeReq("/__sample-move", "GET"), res, vi.fn());
      expect(res.statusCode).toBe(405);
      expect(res.body).toBe("Method not allowed");
    });
  });

  describe("body handling", () => {
    it("responds 413 when body exceeds 1 MiB", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      // Emit 1 MiB + 1 byte
      req.emit("data", "x".repeat(1_048_577));
      expect(res.statusCode).toBe(413);
      expect(req.destroy).toHaveBeenCalledOnce();
    });

    it("responds 400 for invalid JSON", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", "not json{");
      req.emit("end");
      expect(res.statusCode).toBe(400);
      expect(res.body).toBe("Invalid request body");
    });

    it("responds 400 when required fields are missing", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({ filename: "a.wav" })); // missing oldCategory, newCategory
      req.emit("end");
      expect(res.statusCode).toBe(400);
    });

    it("responds 400 when path validation fails (path traversal)", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({
        filename: "a.wav",
        oldCategory: "../evil",
        oldSubcategory: null,
        newCategory: "Bass",
        newSubcategory: null,
      }));
      req.emit("end");
      expect(res.statusCode).toBe(400);
    });

    it("skips body processing when bodyTooLarge is true on 'end'", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", "x".repeat(1_048_577));
      const statusBefore = res.statusCode;
      req.emit("end"); // should not overwrite the 413 status
      expect(res.statusCode).toBe(statusBefore);
    });
  });

  describe("happy path — move with real filesystem", () => {
    beforeEach(() => {
      // Set up a minimal output directory with a WAV file and metadata.json
      mkdirSync(join(outputRoot, "Bass"), { recursive: true });
      mkdirSync(join(outputRoot, "Guitar"), { recursive: true });
      writeFileSync(join(outputRoot, "Bass", "sample01.wav"), "RIFF");
      writeFileSync(
        join(outputRoot, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "sample01.wav", category: "Bass", subcategory: null },
          ],
        }),
        "utf-8",
      );
    });

    it("moves the WAV and patches metadata.json, responds 204", () => {
      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({
        filename: "sample01.wav",
        oldCategory: "Bass",
        oldSubcategory: null,
        newCategory: "Guitar",
        newSubcategory: null,
      }));
      req.emit("end");

      expect(res.statusCode).toBe(204);
      expect(server.ws.send).toHaveBeenCalledWith({
        type: "custom",
        event: SAMPLE_METADATA_UPDATED_EVENT,
        data: null,
      });

      expect(existsSync(join(outputRoot, "Guitar", "sample01.wav"))).toBe(true);
      expect(existsSync(join(outputRoot, "Bass", "sample01.wav"))).toBe(false);
    });

    it("updates metadata.json when WAV is missing (still patches manifest)", () => {
      // Remove the WAV first
      unlinkSync(join(outputRoot, "Bass", "sample01.wav"));

      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({
        filename: "sample01.wav",
        oldCategory: "Bass",
        oldSubcategory: null,
        newCategory: "Guitar",
        newSubcategory: null,
      }));
      req.emit("end");

      expect(res.statusCode).toBe(204);
      expect(server.config.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("WAV not found"),
      );
    });

    it("responds 500 when metadata.json cannot be read", () => {
      // Remove metadata.json to trigger readFileSync failure
      unlinkSync(join(outputRoot, "metadata.json"));

      const server = makeMockServer();
      const mw = getMw(outputRoot, server);
      const req = makeReq("/__sample-move");
      const res = makeRes();
      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({
        filename: "sample01.wav",
        oldCategory: "Bass",
        oldSubcategory: null,
        newCategory: "Guitar",
        newSubcategory: null,
      }));
      req.emit("end");

      expect(res.statusCode).toBe(500);
    });
  });
});

