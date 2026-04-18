import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
// `vite-plugin-istanbul`'s default export is mis-resolved as the module
// namespace under `module: NodeNext` (TS issue rather than the package's
// typings — its `dist/index.d.ts` correctly declares
// `(opts?: IstanbulPluginOptions) => Plugin`). Casting through the official
// options type keeps the call site honest while sidestepping the resolver
// bug; replace with a plain default import once TS resolves it correctly.
import istanbulPluginRaw, { type IstanbulPluginOptions } from "vite-plugin-istanbul";
const istanbulPlugin = istanbulPluginRaw as unknown as (opts?: IstanbulPluginOptions) => Plugin;

import { ARCHIVE_MIX_DIRS } from "./scripts/build-index.js";
import { CATEGORY_CONFIG_FILENAME, normalizeCategoryConfig } from "./src/data.js";

const COVERAGE_SOURCE_FILES = [
  "src/main.ts",
  "src/data.ts",
  "src/library.ts",
  "src/player.ts",
  "src/render.ts",
  "src/mix-player.ts",
  "src/mix-buffer.ts",
  "src/mix-parser.ts",
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

/**
 * Resolve a `/mix/<productId>/<filename>` request URL to an on-disk archive
 * path. Returns `null` for any URL that is not a mix request, mentions an
 * unknown product, tries to traverse directories, or points at a file that
 * does not exist on disk. The caller should respond 404 whenever `null` is
 * returned so the middleware remains safe against path-traversal attacks.
 */
export function resolveMixUrl(
  url: string,
  archiveRoot: string,
): { absolutePath: string; productId: string; filename: string } | null {
  const match = /^\/mix\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/.exec(url);
  if (!match) return null;
  const [, productId, rawFilename] = match;
  let filename: string;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    return null;
  }
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  if (!/\.mix$/i.test(filename)) return null;
  const layout = ARCHIVE_MIX_DIRS[productId];
  if (!layout) return null;
  const absolutePath = resolve(archiveRoot, layout.archiveDir, layout.mixSubdir, filename);
  const expectedPrefix = resolve(archiveRoot, layout.archiveDir, layout.mixSubdir) + (process.platform === "win32" ? "\\" : "/");
  if (!absolutePath.startsWith(expectedPrefix)) return null;
  if (!existsSync(absolutePath)) return null;
  try {
    if (!statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return { absolutePath, productId, filename };
}

/**
 * Dev-server plugin that exposes `archive/<product>/<MIX>/` folders at a
 * safe, allow-listed URL space (`/mix/<productId>/<filename>`). The full
 * archive tree is NOT served — only files whose product appears in the
 * `ARCHIVE_MIX_DIRS` whitelist are reachable, and only when the filename
 * ends with `.mix`. Responses use `application/octet-stream` with
 * `no-cache` so the browser always re-fetches the latest bytes.
 */
function serveMixFiles(archiveRoot: string): import("vite").Plugin {
  return {
    name: "serve-mix-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/mix/")) { next(); return; }
        const resolved = resolveMixUrl(req.url, archiveRoot);
        if (!resolved) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found");
          return;
        }
        try {
          const buf = readFileSync(resolved.absolutePath);
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", buf.length);
          res.setHeader("Cache-Control", "no-cache");
          res.end(buf);
        } catch (err) {
          server.config.logger.warn(`[serve-mix-files] Failed to read ${resolved.absolutePath}: ${String(err)}`);
          res.statusCode = 500;
          res.end("Internal error");
        }
      });
    },
  };
}

/**
 * Dev-server endpoint for persisting the editable category configuration to
 * `output/categories.json`. The browser is allowed to overwrite only this one
 * file, and only with a payload that matches the expected schema.
 */
function manageCategoryConfig(outputRoot: string): Plugin {
  return {
    name: "manage-category-config",
    configureServer(server) {
      const configPath = resolve(outputRoot, CATEGORY_CONFIG_FILENAME);

      server.middlewares.use((req, res, next) => {
        if (req.url !== "/__category-config") {
          next();
          return;
        }

        if (req.method !== "PUT") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Method not allowed");
          return;
        }

        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed: unknown = JSON.parse(body);
            const config = normalizeCategoryConfig(parsed);
            if (!config) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Invalid category config");
              return;
            }

            writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
            res.statusCode = 204;
            res.end();
          } catch (error) {
            server.config.logger.warn(`[manage-category-config] Failed to write ${configPath}: ${String(error)}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal error");
          }
        });
      });
    },
  };
}

/**
 * Vite build plugin: copy .mix files from the archive into `dist/mix/`
 * so the production bundle can serve them statically. Only runs during
 * `vite build`, not dev-server mode.
 *
 * Caching note: the dev-server `serveMixFiles` middleware sets
 * `Cache-Control: no-cache` so iterating on archive contents always
 * picks up the latest bytes. In production, the copied files under
 * `dist/mix/` are served by Vite's default static handler with whatever
 * caching policy the host applies — typically long-lived. That is the
 * intended asymmetry: `.mix` archive bytes never change for a published
 * build.
 */
function copyMixFilesPlugin(archiveRoot: string): Plugin {
  return {
    name: "copy-mix-files",
    apply: "build",
    closeBundle() {
      const outDir = resolve(process.cwd(), "dist", "mix");
      for (const [productId, layout] of Object.entries(ARCHIVE_MIX_DIRS)) {
        const mixDir = resolve(archiveRoot, layout.archiveDir, layout.mixSubdir);
        if (!existsSync(mixDir)) continue;
        let entries: string[];
        try {
          entries = readdirSync(mixDir);
        } catch {
          continue;
        }
        const productOutDir = resolve(outDir, productId);
        let hasFiles = false;
        for (const entry of entries) {
          if (!/\.mix$/i.test(entry)) continue;
          const src = resolve(mixDir, entry);
          try {
            if (!statSync(src).isFile()) continue;
          } catch {
            continue;
          }
          if (!hasFiles) {
            mkdirSync(productOutDir, { recursive: true });
            hasFiles = true;
          }
          copyFileSync(src, resolve(productOutDir, entry));
        }
      }
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
    manageCategoryConfig(resolve(process.cwd(), "output")),
    serveMixFiles(resolve(process.cwd(), "archive")),
    copyMixFilesPlugin(resolve(process.cwd(), "archive")),
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
