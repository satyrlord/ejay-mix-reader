/**
 * dev-server/mix-files-plugin.ts — Vite plugin for serving
 * archive `.mix` files.
 *
 * Wraps pure path-discovery helpers from `index.ts` in a Vite plugin shell:
 *   - `serveMixFiles` — dev middleware: streams `.mix` bytes at
 *     `/mix/<productId>/<filename>`.
 *
 * Consumers:
 *   - vite.config.ts
 *   - scripts/__tests__/vite-mix-files-plugin.test.ts
 */

import { createReadStream } from "fs";
import type { Plugin } from "vite";

import { resolveMixUrl } from "./index.js";

// Re-usable narrow type for the res object used in respondWithReadError.
type MinimalResponse = NodeJS.WritableStream & {
  statusCode: number;
  writableEnded?: boolean;
  end(chunk?: string): void;
};

/**
 * Dev-server plugin that exposes `archive/<product>/<MIX>/` folders at
 * `/mix/<productId>/<filename>`. Only products in the `ARCHIVE_MIX_DIRS`
 * allow-list and files whose names end with `.mix` are reachable.
 */
export function serveMixFiles(archiveRoot: string): Plugin {
  return {
    name: "serve-mix-files",
    configureServer(server) {
      const respondWithReadError = (
        absolutePath: string,
        error: unknown,
        res: MinimalResponse,
      ): void => {
        server.config.logger.warn(
          `[serve-mix-files] Failed to read ${absolutePath}: ${String(error)}`,
        );
        if (res.writableEnded) return;
        res.statusCode = 500;
        res.end("Internal error");
      };

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/mix/")) {
          next();
          return;
        }
        const resolved = resolveMixUrl(req.url, archiveRoot);
        if (!resolved) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found");
          return;
        }
        try {
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Cache-Control", "no-cache");
          const stream = createReadStream(resolved.absolutePath);
          stream.on("error", (err) => {
            respondWithReadError(resolved.absolutePath, err, res);
          });
          stream.pipe(res);
        } catch (err) {
          respondWithReadError(resolved.absolutePath, err, res);
        }
      });
    },
  };
}
