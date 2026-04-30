/**
 * dev-server/warmup-plugin.ts — Vite plugin that gates incoming requests
 * until all listed source files have been pre-transformed (instrumented) by
 * the Vite module pipeline.
 *
 * This is primarily useful when VITE_COVERAGE=true: Istanbul instrumentation
 * happens during Vite's transform step, so requests that race ahead of the
 * first transform see un-instrumented modules and produce inaccurate coverage.
 * This plugin turns warmup into a hard gate so the first browser request only
 * proceeds after all listed files are ready.
 *
 * Consumers:
 *   - vite.config.ts
 *   - scripts/__tests__/vite-warmup-plugin.test.ts
 */

import type { Plugin } from "vite";

/**
 * Creates a Vite development-server plugin that delays HTTP responses until
 * the given source files have been transformed and cached.
 *
 * @param files Source files to pre-transform before the dev server allows
 *   requests to continue.
 */
export function blockingWarmup(files: readonly string[]): Plugin {
  return {
    name: "blocking-warmup",
    configureServer(server) {
      let warmedUp = false;
      let delayLogged = false;
      const warmupDone = new Promise<void>((resolveWarmup) => {
        // Guard for the edge case where Vite's internal middleware pipeline runs
        // before the HTTP server is created (e.g. SSR / middleware mode). In that
        // scenario there is nothing to wait for, so we resolve immediately. This
        // branch is unreachable in the normal SPA dev-server flow.
        if (!server.httpServer) {
          warmedUp = true;
          resolveWarmup();
          return;
        }

        server.httpServer.once("listening", async () => {
          try {
            const results = await Promise.allSettled(
              files.map((file) => server.transformRequest(`/${file}`)),
            );
            for (const result of results) {
              if (result.status === "rejected") {
                server.config.logger.warn(
                  `[blocking-warmup] Transform failed: ${String(result.reason)}`,
                );
              }
            }
          } finally {
            warmedUp = true;
            resolveWarmup();
          }
        });
      });

      server.middlewares.use((_req, res, next) => {
        if (warmedUp) {
          next();
          return;
        }

        res.setHeader("X-Vite-Warmup", "pending");
        // Log only the first delayed request to avoid flooding the console.
        if (!delayLogged) {
          server.config.logger.info("[blocking-warmup] Delaying requests until warmup completes.");
          delayLogged = true;
        }
        warmupDone.then(() => next(), (err: unknown) => {
          server.config.logger.warn(`[blocking-warmup] Warmup failed, proceeding: ${String(err)}`);
          next();
        });
      });
    },
  };
}
