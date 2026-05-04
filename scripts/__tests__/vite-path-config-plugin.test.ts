import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolve } from "path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createManagedPathConfig, managePathConfig } from "../dev-server/path-config-plugin.js";
import { createPathConfigStore, PATH_CONFIG_UPDATED_EVENT } from "../path-config.js";

interface MockServer {
  ws: { send: Mock };
  middlewares: { use: Mock };
  config: { logger: { warn: Mock } };
}

interface FakeReq extends EventEmitter {
  url?: string;
  method?: string;
  setEncoding: Mock;
  destroy: Mock;
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

function makeMockServer(): MockServer {
  return {
    ws: { send: vi.fn() },
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn() } },
  };
}

function makeReq(url: string, method = "GET"): FakeReq {
  return Object.assign(new EventEmitter(), {
    url,
    method,
    setEncoding: vi.fn(),
    destroy: vi.fn(),
  }) as FakeReq;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk !== undefined) this.body = chunk;
    },
  };
}

type Middleware = (req: FakeReq, res: FakeRes, next: () => void) => void;

describe("managePathConfig", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "path-config-plugin-"));
    mkdirSync(join(repoRoot, "archive"), { recursive: true });
    mkdirSync(join(repoRoot, "output"), { recursive: true });
    mkdirSync(join(repoRoot, "data"), { recursive: true });
    writeFileSync(join(repoRoot, "output", "metadata.json"), JSON.stringify({ samples: [] }), "utf-8");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns plugin metadata", () => {
    const store = createPathConfigStore(repoRoot);
    expect(managePathConfig(store).name).toBe("manage-path-config");
  });

  it("serves GET /__path-config", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "GET");
    const res = makeRes();

    mw(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(typeof res.body).toBe("string");
    expect(res.body).toContain("archiveRoots");
  });

  it("updates config via PUT /__path-config and emits HMR event", () => {
    const newArchive = join(repoRoot, "archive-2");
    const newOutput = join(repoRoot, "output-2");
    mkdirSync(newArchive, { recursive: true });
    mkdirSync(newOutput, { recursive: true });

    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "PUT");
    const res = makeRes();

    mw(req, res, vi.fn());
    req.emit("data", JSON.stringify({
      archiveRoots: [newArchive],
      outputRoot: newOutput,
    }));
    req.emit("end");

    expect(res.statusCode).toBe(200);
    expect(server.ws.send).toHaveBeenCalledWith({
      type: "custom",
      event: PATH_CONFIG_UPDATED_EVENT,
      data: expect.objectContaining({
        config: expect.objectContaining({
          outputRoot: newOutput,
        }),
      }),
    });
  });

  it("responds 405 for unsupported methods", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "DELETE");
    const res = makeRes();

    mw(req, res, vi.fn());

    expect(res.statusCode).toBe(405);
    expect(res.body).toBe("Method not allowed");
  });

  it("returns 400 when patch payload is invalid", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "PUT");
    const res = makeRes();

    mw(req, res, vi.fn());
    req.emit("data", JSON.stringify({ outputRoot: 42 }));
    req.emit("end");

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("outputRoot must be a string.");
  });

  it("calls next for unrelated routes", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/other", "GET");
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("logs initial config issues during server setup", () => {
    const brokenStore = {
      getSnapshot: () => ({
        repoRoot,
        configPath: join(repoRoot, "data", "path-config.json"),
        source: "file" as const,
        parseError: "broken config",
        config: {
          archiveRoots: [join(repoRoot, "missing")],
          outputRoot: join(repoRoot, "missing-output"),
        },
        validation: {
          ok: false,
          errors: [{ code: "archive_root_missing", message: "missing archive", path: "archiveRoots[0]" }],
          warnings: [{ code: "output_metadata_missing", message: "missing metadata", path: "outputRoot" }],
        },
      }),
      reload: () => { throw new Error("unused"); },
      update: () => { throw new Error("unused"); },
    };

    const server = makeMockServer();
    (managePathConfig(brokenStore as never).configureServer as ((s: never) => void) | undefined)!(server as never);
    expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("broken config"));
    expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing archive"));
    expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing metadata"));
  });

  it("returns 400 for invalid JSON request bodies", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "PUT");
    const res = makeRes();
    mw(req, res, vi.fn());
    req.emit("data", "{ bad json");
    req.emit("end");

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("Invalid JSON");
  });

  it("returns 413 when request body exceeds the limit", () => {
    const store = createPathConfigStore(repoRoot);
    const server = makeMockServer();
    (managePathConfig(store).configureServer as ((s: never) => void) | undefined)!(server as never);

    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;
    const req = makeReq("/__path-config", "PUT");
    const res = makeRes();
    mw(req, res, vi.fn());
    req.emit("data", "x".repeat(1_048_577));

    expect(res.statusCode).toBe(413);
    expect(res.body).toBe("Request entity too large");
    expect(req.destroy).toHaveBeenCalledOnce();
  });

  it("returns 500 when store.update throws a non-TypeError", () => {
    const explodingStore = {
      getSnapshot: () => ({
        repoRoot,
        configPath: join(repoRoot, "data", "path-config.json"),
        source: "defaults" as const,
        parseError: null,
        config: {
          archiveRoots: [join(repoRoot, "archive")],
          outputRoot: join(repoRoot, "output"),
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      }),
      reload: () => { throw new Error("unused"); },
      update: () => {
        throw new Error("boom");
      },
    };

    const server = makeMockServer();
    (managePathConfig(explodingStore as never).configureServer as ((s: never) => void) | undefined)!(server as never);
    const mw = server.middlewares.use.mock.calls[0][0] as Middleware;

    const req = makeReq("/__path-config", "PUT");
    const res = makeRes();
    mw(req, res, vi.fn());
    req.emit("data", "{}");
    req.emit("end");

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("Internal error");
    expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to update path config"));
  });

  it("createManagedPathConfig returns a store and plugin pair", () => {
    const managed = createManagedPathConfig(repoRoot);
    expect(managed.plugin.name).toBe("manage-path-config");
    expect(managed.store.getSnapshot().repoRoot).toBe(resolve(repoRoot));
  });
});
