import { EventEmitter } from "events";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { Plugin } from "vite";

import { blockingWarmup } from "../dev-server/warmup-plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockRes {
  setHeader: Mock;
  statusCode?: number;
}

interface MockServer {
  httpServer: EventEmitter | null;
  transformRequest: Mock;
  middlewares: { use: Mock };
  config: { logger: { warn: Mock; info: Mock } };
}

/**
 * Invoke the configureServer hook regardless of whether the plugin uses the
 * function form or the `{ handler }` object form (Vite's ObjectHook union).
 */
function callConfigureServer(plugin: Plugin, server: unknown): void {
  const hook = plugin.configureServer;
  if (!hook) return;
  const fn = (typeof hook === "function" ? hook : hook.handler) as (s: never) => void;
  fn(server as never);
}

function makeMockServer(httpServer: EventEmitter | null = new EventEmitter()): MockServer {
  return {
    httpServer,
    transformRequest: vi.fn().mockResolvedValue(null),
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn(), info: vi.fn() } },
  };
}

/** Extract the middleware registered via `server.middlewares.use(...)`. */
function getMiddleware(server: MockServer) {
  expect(server.middlewares.use).toHaveBeenCalled();
  return server.middlewares.use.mock.calls[0][0] as (
    req: unknown,
    res: MockRes,
    next: () => void,
  ) => void;
}

/** Flush all outstanding microtasks / macro tasks. */
async function flushAsync() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("blockingWarmup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'blocking-warmup'", () => {
    expect(blockingWarmup([]).name).toBe("blocking-warmup");
  });

  it("has a configureServer hook", () => {
    const plugin = blockingWarmup([]);
    expect(typeof plugin.configureServer).toBe("function");
  });

  describe("when httpServer is null (SSR / middleware mode)", () => {
    let server: MockServer;

    beforeEach(() => {
      server = makeMockServer(null);
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
    });

    it("registers a middleware", () => {
      expect(server.middlewares.use).toHaveBeenCalledOnce();
    });

    it("calls next() immediately because warmedUp is already true", () => {
      const mw = getMiddleware(server);
      const next = vi.fn();
      mw({}, { setHeader: vi.fn() }, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("does not call transformRequest", () => {
      expect(server.transformRequest).not.toHaveBeenCalled();
    });
  });

  describe("when httpServer is an EventEmitter", () => {
    let server: MockServer;

    beforeEach(() => {
      server = makeMockServer();
    });

    it("does not call transformRequest before 'listening' fires", () => {
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      expect(server.transformRequest).not.toHaveBeenCalled();
    });

    it("calls transformRequest for each file after 'listening' fires", async () => {
      callConfigureServer(blockingWarmup(["src/main.ts", "src/data.ts"]), server);
      server.httpServer!.emit("listening");
      await flushAsync();
      expect(server.transformRequest).toHaveBeenCalledWith("/src/main.ts");
      expect(server.transformRequest).toHaveBeenCalledWith("/src/data.ts");
    });

    it("calls next() after warmup completes", async () => {
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      // Start listening (warmup not yet complete)
      server.httpServer!.emit("listening");
      const mw = getMiddleware(server);
      const next = vi.fn();
      const res: MockRes = { setHeader: vi.fn() };
      mw({}, res, next);
      // next is queued on warmupDone promise — not called synchronously
      expect(next).not.toHaveBeenCalled();
      await flushAsync();
      expect(next).toHaveBeenCalledOnce();
    });

    it("sets X-Vite-Warmup header on delayed requests", async () => {
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      const mw = getMiddleware(server);
      const res: MockRes = { setHeader: vi.fn() };
      mw({}, res, vi.fn());
      expect(res.setHeader).toHaveBeenCalledWith("X-Vite-Warmup", "pending");
    });

    it("logs a single info message for the first delayed request", async () => {
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      const mw = getMiddleware(server);
      mw({}, { setHeader: vi.fn() }, vi.fn());
      mw({}, { setHeader: vi.fn() }, vi.fn());
      expect(server.config.logger.info).toHaveBeenCalledOnce();
    });

    it("logs a warning and still calls next when a transform is rejected", async () => {
      server.transformRequest.mockRejectedValueOnce(new Error("transform failed"));
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      const mw = getMiddleware(server);
      const next = vi.fn();
      mw({}, { setHeader: vi.fn() }, next);
      server.httpServer!.emit("listening");
      await flushAsync();
      expect(server.config.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Transform failed"),
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it("calls next() immediately on subsequent requests after warmup", async () => {
      callConfigureServer(blockingWarmup(["src/main.ts"]), server);
      server.httpServer!.emit("listening");
      await flushAsync();

      const mw = getMiddleware(server);
      const next = vi.fn();
      mw({}, { setHeader: vi.fn() }, next);
      // warmedUp is true now — should be synchronous
      expect(next).toHaveBeenCalledOnce();
    });
  });

  it("handles an empty files array without errors", async () => {
    const server = makeMockServer();
    callConfigureServer(blockingWarmup([]), server);
    server.httpServer!.emit("listening");
    await flushAsync();
    const mw = getMiddleware(server);
    const next = vi.fn();
    mw({}, { setHeader: vi.fn() }, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

