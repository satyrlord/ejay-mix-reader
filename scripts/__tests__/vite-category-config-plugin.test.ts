import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { EventEmitter } from "events";

import { CATEGORY_CONFIG_UPDATED_EVENT } from "../../src/data.js";
import { manageCategoryConfig } from "../dev-server/category-config-plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockServer {
  ws: { send: Mock };
  watcher: {
    add: Mock;
    on: Mock;
    // Simulated handlers registered via server.watcher.on(event, handler)
    handlers: Map<string, Array<(p: string) => void>>;
  };
  middlewares: { use: Mock };
  config: { logger: { warn: Mock } };
}

function makeMockServer(): MockServer {
  const handlers = new Map<string, Array<(p: string) => void>>();
  return {
    ws: { send: vi.fn() },
    watcher: {
      add: vi.fn(),
      on: vi.fn((event: string, handler: (p: string) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      handlers,
    },
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn() } },
  };
}

/** Trigger all registered watcher handlers for the given event. */
function triggerWatcher(server: MockServer, event: string, filePath: string) {
  for (const handler of server.watcher.handlers.get(event) ?? []) {
    handler(filePath);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("manageCategoryConfig", () => {
  let outputRoot: string;

  beforeEach(() => {
    outputRoot = mkdtempSync(join(tmpdir(), "cat-cfg-"));
  });

  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'manage-category-config'", () => {
    expect(manageCategoryConfig(outputRoot).name).toBe("manage-category-config");
  });

  it("has a configureServer hook", () => {
    expect(typeof manageCategoryConfig(outputRoot).configureServer).toBe("function");
  });

  describe("configureServer", () => {
    let server: MockServer;

    beforeEach(() => {
      server = makeMockServer();
      (manageCategoryConfig(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
    });

    it("watches the categories.json file", () => {
      expect(server.watcher.add).toHaveBeenCalledWith(
        expect.stringContaining("categories.json"),
      );
    });

    it("registers 'add', 'change', and 'unlink' watcher events", () => {
      const events = server.watcher.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain("add");
      expect(events).toContain("change");
      expect(events).toContain("unlink");
    });

    it("registers a middleware via middlewares.use", () => {
      expect(server.middlewares.use).toHaveBeenCalledOnce();
    });

    it("emits CATEGORY_CONFIG_UPDATED_EVENT when the config file changes", () => {
      const configPath = resolve(outputRoot, "categories.json");
      triggerWatcher(server, "change", configPath);
      expect(server.ws.send).toHaveBeenCalledWith({
        type: "custom",
        event: CATEGORY_CONFIG_UPDATED_EVENT,
        data: null,
      });
    });

    it("emits CATEGORY_CONFIG_UPDATED_EVENT when the config file is added", () => {
      const configPath = resolve(outputRoot, "categories.json");
      triggerWatcher(server, "add", configPath);
      expect(server.ws.send).toHaveBeenCalledOnce();
    });

    it("emits CATEGORY_CONFIG_UPDATED_EVENT when the config file is unlinked", () => {
      const configPath = resolve(outputRoot, "categories.json");
      triggerWatcher(server, "unlink", configPath);
      expect(server.ws.send).toHaveBeenCalledOnce();
    });

    it("does not emit when an unrelated file changes", () => {
      triggerWatcher(server, "change", "/some/other/file.json");
      expect(server.ws.send).not.toHaveBeenCalled();
    });

    it("handles a PUT /__category-config request via the middleware", () => {
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: {
          statusCode: number;
          headers: Record<string, string>;
          setHeader(n: string, v: string): void;
          end(s?: string): void;
        },
        next: () => void,
      ) => void;

      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(n: string, v: string) {
          this.headers[n] = v;
        },
        end() {},
      };

      // Route does not match — should call next
      const next = vi.fn();
      mw({ url: "/other-path", method: "PUT" }, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("delegates write to createCategoryConfigMiddleware and emits event on success", async () => {
      // Write a valid categories.json first so the middleware can write it back
      const configPath = resolve(outputRoot, "categories.json");
      writeFileSync(configPath, JSON.stringify({ version: 1, categories: [] }), "utf-8");

      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: NodeJS.EventEmitter & { url?: string; method?: string; setEncoding(e: string): void },
        res: {
          statusCode: number;
          headers: Record<string, string>;
          setHeader(n: string, v: string): void;
          end(s?: string): void;
        },
        next: () => void,
      ) => void;

      const req = Object.assign(new EventEmitter(), {
        url: "/__category-config",
        method: "PUT",
        setEncoding: vi.fn(),
      });

      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(n: string, v: string) { this.headers[n] = v; },
        end() {},
      };

      mw(req, res, vi.fn());
      req.emit("data", JSON.stringify({ version: 1, categories: [] }));
      req.emit("end");

      expect(res.statusCode).toBe(204);
      expect(server.ws.send).toHaveBeenCalledWith({
        type: "custom",
        event: CATEGORY_CONFIG_UPDATED_EVENT,
        data: null,
      });
    });
  });
});

