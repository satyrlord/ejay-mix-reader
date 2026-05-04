import type { IncomingMessage, ServerResponse } from "http";

import type { Plugin } from "vite";

import {
  createPathConfigStore,
  formatPathValidationSummary,
  PATH_CONFIG_UPDATED_EVENT,
  type PathConfigStore,
} from "../path-config.js";

const MAX_BODY_BYTES = 1_048_576;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function writeText(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function readRequestBody(
  req: IncomingMessage,
  res: ServerResponse,
  onComplete: (body: string) => void,
): void {
  let body = "";
  let bodyTooLarge = false;

  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      bodyTooLarge = true;
      writeText(res, 413, "Request entity too large");
      req.destroy();
    }
  });

  req.on("end", () => {
    if (bodyTooLarge) return;
    onComplete(body);
  });
}

export function managePathConfig(store: PathConfigStore): Plugin {
  return {
    name: "manage-path-config",
    configureServer(server) {
      const initialSnapshot = store.getSnapshot();
      if (!initialSnapshot.validation.ok || initialSnapshot.validation.warnings.length > 0 || initialSnapshot.parseError) {
        for (const line of formatPathValidationSummary(initialSnapshot)) {
          server.config.logger.warn(`[path-config] ${line}`);
        }
      }

      server.middlewares.use((req, res, next) => {
        if (req.url !== "/__path-config") {
          next();
          return;
        }

        if (req.method === "GET") {
          sendJson(res, 200, store.getSnapshot());
          return;
        }

        if (req.method !== "PUT") {
          writeText(res, 405, "Method not allowed");
          return;
        }

        readRequestBody(req, res, (body) => {
          let parsed: unknown;
          try {
            parsed = body.trim().length > 0 ? JSON.parse(body) : {};
          } catch {
            writeText(res, 400, "Invalid JSON");
            return;
          }

          try {
            const nextSnapshot = store.update(parsed);
            server.ws.send({
              type: "custom",
              event: PATH_CONFIG_UPDATED_EVENT,
              data: nextSnapshot,
            });
            sendJson(res, 200, nextSnapshot);
          } catch (error) {
            if (error instanceof TypeError) {
              writeText(res, 400, error.message);
              return;
            }
            server.config.logger.warn(`[path-config] Failed to update path config: ${String(error)}`);
            writeText(res, 500, "Internal error");
          }
        });
      });
    },
  };
}

export function createManagedPathConfig(repoRoot: string = process.cwd()): {
  store: PathConfigStore;
  plugin: Plugin;
} {
  const store = createPathConfigStore(repoRoot);
  return {
    store,
    plugin: managePathConfig(store),
  };
}
