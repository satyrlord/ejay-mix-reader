import { resolve } from "path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import istanbulPlugin from "vite-plugin-istanbul";

const COVERAGE_SOURCE_FILES = [
  "src/main.ts",
  "src/data.ts",
  "src/library.ts",
  "src/player.ts",
  "src/render.ts",
] as const;

// Shared list used by both blockingWarmup and server.warmup.clientFiles so they
// stay in sync: app.css must be pre-transformed together with the TS entry points.
const WARMUP_FILES = [...COVERAGE_SOURCE_FILES, "src/app.css"] as const;

/**
 * Creates a Vite development-server plugin that delays HTTP responses until the
 * given source files have been transformed and cached.
 *
 * This is primarily useful when coverage is enabled. Vite's built-in
 * `server.warmup` starts pre-transforming modules in the background, but it does
 * not block the first browser request. That can let the page load race ahead of
 * Istanbul instrumentation, producing a slower or less deterministic first load.
 * This plugin turns warmup into a hard gate so the first request only proceeds
 * after the listed modules are ready.
 *
 * Use this plugin when startup consistency matters more than immediately serving
 * the first request, especially in local test or coverage runs that need all
 * browser entry files precompiled before the app is loaded.
 *
 * @param files Source files to pre-transform before the dev server allows
 * requests to continue.
 * @returns A Vite plugin that waits for warmup to complete before passing
 * requests through the middleware chain.
 */
function blockingWarmup(files: readonly string[]): import("vite").Plugin {
  return {
    name: "blocking-warmup",
    configureServer(server) {
      let warmedUp = false;
      let delayLogged = false;
      const warmupDone = new Promise<void>((resolveWarmup) => {
        // Guard for the edge case where Vite's internal middleware pipeline runs
        // before the HTTP server is created (e.g. SSR / middleware mode). In that
        // scenario there is nothing to wait for, so we resolve immediately. This
        // branch is unreachable in the normal SPA dev-server flow and is therefore
        // not exercised by the test suite.
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

      server.middlewares.use((req, res, next) => {
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

export default defineConfig({
  appType: "spa",
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), "index.html"),
      },
    },
  },
  plugins: [
    tailwindcss(),
    ...(process.env.VITE_COVERAGE === "true"
      ? [istanbulPlugin({
          include: [...COVERAGE_SOURCE_FILES],
          extension: [".ts", ".js"],
          requireEnv: true,
        }),
        blockingWarmup([...WARMUP_FILES]),
        ]
      : []),
  ],
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    warmup: {
      clientFiles: [...WARMUP_FILES],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
});
