import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
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

import { injectContentSecurityPolicy } from "./scripts/dev-server/csp-plugin.js";
import { resolveDevWebSocketPort } from "./scripts/dev-server/csp.js";
import { manageCategoryConfig } from "./scripts/dev-server/category-config-plugin.js";
import { serveMixFiles, copyMixFilesPlugin } from "./scripts/dev-server/mix-files-plugin.js";
import { manageSampleMetadata } from "./scripts/dev-server/sample-metadata-plugin.js";
import { blockingWarmup } from "./scripts/dev-server/warmup-plugin.js";
import { COVERAGE_SOURCE_FILES, WARMUP_FILES as _WARMUP_FILES } from "./scripts/dev-server/warmup.js";
import { buildDisplayVersion } from "./scripts/version.js";

export { applySampleMoveToManifest, resolveMixUrl, validateSampleMovePaths } from "./scripts/dev-server/index.js";
export { buildPerCategorySummary } from "./scripts/dev-server/index.js";

// Shared list used by both blockingWarmup and server.warmup.clientFiles so they
// stay in sync: app.css must be pre-transformed together with the TS entry points.
const WARMUP_FILES = _WARMUP_FILES;

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

const DEV_WEBSOCKET_PORT = resolveDevWebSocketPort(process.env.VITE_DEV_SERVER_PORT, 3000);
// Optional build flag: include archive `.mix` files in `dist/mix/`.
// Keep this off for normal browser-only builds to reduce bundle output size.
const INCLUDE_MIX_FILES_IN_DIST = process.env.EJAY_INCLUDE_MIX_IN_DIST === "true";

// Ensure runtime metadata (`data/index.json`) is available in production builds
// even when mix archive copying is disabled.
function copyRuntimeIndexPlugin(): Plugin {
  return {
    name: "copy-runtime-index",
    apply: "build",
    closeBundle() {
      const source = resolve(process.cwd(), "data", "index.json");
      if (!existsSync(source)) return;

      const destination = resolve(process.cwd(), "dist", "data", "index.json");
      mkdirSync(resolve(process.cwd(), "dist", "data"), { recursive: true });
      copyFileSync(source, destination);
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
    injectContentSecurityPolicy(command === "serve", DEV_WEBSOCKET_PORT),
    manageCategoryConfig(resolve(process.cwd(), "output")),
    manageSampleMetadata(resolve(process.cwd(), "output")),
    serveMixFiles(resolve(process.cwd(), "archive")),
    copyRuntimeIndexPlugin(),
    ...(INCLUDE_MIX_FILES_IN_DIST ? [copyMixFilesPlugin(resolve(process.cwd(), "archive"))] : []),
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
