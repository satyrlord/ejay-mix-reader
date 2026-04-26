import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
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

import { ARCHIVE_MIX_DIRS, buildUserdataMixLibrary } from "./scripts/build-index.js";
import {
  applySampleMoveToManifest,
  createCategoryConfigMiddleware,
  resolveMixUrl,
  validateSampleMovePaths,
} from "./scripts/dev-server/index.js";
import type {
  SampleMetadataManifest,
  SampleMoveRequest,
} from "./scripts/dev-server/index.js";
import { buildDisplayVersion } from "./scripts/version.js";
import { CATEGORY_CONFIG_FILENAME, CATEGORY_CONFIG_UPDATED_EVENT, SAMPLE_METADATA_UPDATED_EVENT } from "./src/data.js";

export { applySampleMoveToManifest, resolveMixUrl, validateSampleMovePaths } from "./scripts/dev-server/index.js";
export { buildPerCategorySummary } from "./scripts/dev-server/index.js";

const COVERAGE_SOURCE_FILES = [
  "src/main.ts",
  "src/data.ts",
  "src/library.ts",
  "src/player.ts",
  "src/render/icons.ts",
  "src/render/transport.ts",
  "src/render/sidebar.ts",
  "src/render/grid.ts",
  "src/render/home.ts",
  "src/sample-grid-context-menu.ts",
  "src/mix-file-browser.ts",
  "src/mix-player.ts",
  "src/mix-buffer.ts",
  "src/mix-parser.ts",
] as const;

// Shared list used by both blockingWarmup and server.warmup.clientFiles so they
// stay in sync: app.css must be pre-transformed together with the TS entry points.
const WARMUP_FILES = [...COVERAGE_SOURCE_FILES, "src/app.css"] as const;

const CONTENT_SECURITY_POLICY_PLACEHOLDER = "__EJAY_CONTENT_SECURITY_POLICY__";

const APP_VERSION = (() => {
  try {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
      version?: string;
    };

    return buildDisplayVersion(parsed.version, {
      deploymentCount: process.env.EJAY_GITHUB_DEPLOYMENT_COUNT,
    });
  } catch {
    return "v0.0.0";
  }
})();

const DEV_WEBSOCKET_PORT = (() => {
  const parsedPort = Number.parseInt(process.env.VITE_DEV_SERVER_PORT ?? "3000", 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
})();

function buildContentSecurityPolicy(allowDevWebSocket: boolean): string {
  const connectSrc = allowDevWebSocket ? `'self' ws://127.0.0.1:${DEV_WEBSOCKET_PORT}` : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    `connect-src ${connectSrc}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "form-action 'self'",
  ].join("; ");
}

function injectContentSecurityPolicy(allowDevWebSocket: boolean): Plugin {
  const policy = buildContentSecurityPolicy(allowDevWebSocket);

  return {
    name: "inject-content-security-policy",
    transformIndexHtml(html) {
      return html.replace(CONTENT_SECURITY_POLICY_PLACEHOLDER, policy);
    },
  };
}

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
      const respondWithReadError = (absolutePath: string, error: unknown, res: NodeJS.WritableStream & { statusCode: number; writableEnded?: boolean; end(chunk?: string): void; }): void => {
        server.config.logger.warn(`[serve-mix-files] Failed to read ${absolutePath}: ${String(error)}`);
        if (res.writableEnded) return;
        res.statusCode = 500;
        res.end("Internal error");
      };

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

      const emitCategoryConfigUpdated = (): void => {
        server.ws.send({
          type: "custom",
          event: CATEGORY_CONFIG_UPDATED_EVENT,
          data: null,
        });
      };

      const handleWatchedConfigChange = (filePath: string): void => {
        if (resolve(filePath) !== configPath) return;
        emitCategoryConfigUpdated();
      };

      server.watcher.add(configPath);
      server.watcher.on("add", handleWatchedConfigChange);
      server.watcher.on("change", handleWatchedConfigChange);
      server.watcher.on("unlink", handleWatchedConfigChange);

      server.middlewares.use(createCategoryConfigMiddleware(
        configPath,
        emitCategoryConfigUpdated,
        (msg) => server.config.logger.warn(msg),
      ));
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
      // Copy user-created mixes from archive/_userdata subfolders.
      for (const entry of buildUserdataMixLibrary(archiveRoot)) {
        // entry.id = "_userdata/<relPath>" — split to build the dest directory.
        const idParts = entry.id.split("/");
        const srcDir = resolve(archiveRoot, ...idParts);
        const destDir = resolve(outDir, ...idParts);
        let hasFiles = false;
        for (const mix of entry.mixes) {
          const src = resolve(srcDir, mix.filename);
          try {
            if (!statSync(src).isFile()) continue;
          } catch {
            continue;
          }
          if (!hasFiles) {
            mkdirSync(destDir, { recursive: true });
            hasFiles = true;
          }
          copyFileSync(src, resolve(destDir, mix.filename));
        }
      }
    },
  };
}

/**
 * Dev-server endpoint for moving a sample from one category/subcategory to another.
 * Moves the WAV file on disk and patches output/metadata.json in place.
 */
function manageSampleMetadata(outputRoot: string): Plugin {
  return {
    name: "manage-sample-metadata",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/__sample-move") {
          next();
          return;
        }

        if (req.method !== "PUT") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Method not allowed");
          return;
        }

        const MAX_BODY_BYTES = 1_048_576; // 1 MiB
        let body = "";
        let bodyTooLarge = false;
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) {
            bodyTooLarge = true;
            res.statusCode = 413;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Request entity too large");
            req.destroy();
          }
        });
        req.on("end", () => {
          if (bodyTooLarge) return;
          try {
            const parsed = JSON.parse(body) as unknown;
            if (
              typeof parsed !== "object" || parsed === null ||
              typeof (parsed as Record<string, unknown>).filename !== "string" ||
              typeof (parsed as Record<string, unknown>).oldCategory !== "string" ||
              typeof (parsed as Record<string, unknown>).newCategory !== "string"
            ) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Invalid request body");
              return;
            }

            const { filename, oldCategory, oldSubcategory, newCategory, newSubcategory } = parsed as SampleMoveRequest;

            // Security: validate all path components and enforce containment within
            // outputRoot before touching the filesystem.
            const validationError = validateSampleMovePaths(
              outputRoot, filename, oldCategory, oldSubcategory, newCategory, newSubcategory,
            );
            if (validationError !== null) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end(validationError);
              return;
            }

            // Build source and destination paths (already validated above)
            const oldParts = [outputRoot, oldCategory, ...(oldSubcategory ? [oldSubcategory] : []), filename];
            const newParts = [outputRoot, newCategory, ...(newSubcategory ? [newSubcategory] : []), filename];
            const oldWav = resolve(...(oldParts as [string, ...string[]]));
            const newWav = resolve(...(newParts as [string, ...string[]]));
            const newDir = resolve(outputRoot, newCategory, ...(newSubcategory ? [newSubcategory] : []));

            // Move the WAV file (create target dir if needed)
            if (existsSync(oldWav)) {
              mkdirSync(newDir, { recursive: true });
              renameSync(oldWav, newWav);
            } else {
              server.config.logger.warn(`[manage-sample-metadata] WAV not found at ${oldWav}; metadata will still be updated`);
            }

            // Patch output/metadata.json
            const metaPath = resolve(outputRoot, "metadata.json");
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SampleMetadataManifest;
            applySampleMoveToManifest(meta, {
              filename,
              oldCategory,
              oldSubcategory,
              newCategory,
              newSubcategory,
            });
            writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");

            server.ws.send({ type: "custom", event: SAMPLE_METADATA_UPDATED_EVENT, data: null });
            res.statusCode = 204;
            res.end();
          } catch (error) {
            server.config.logger.warn(`[manage-sample-metadata] Error: ${String(error)}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal error");
          }
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  appType: "spa",
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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
    injectContentSecurityPolicy(command === "serve"),
    manageCategoryConfig(resolve(process.cwd(), "output")),
    manageSampleMetadata(resolve(process.cwd(), "output")),
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
}));
