import { readFileSync } from "fs";
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
import { serveMixFiles } from "./scripts/dev-server/mix-files-plugin.js";
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

    return buildDisplayVersion(parsed.version);
  } catch {
    return "v0.0.0";
  }
})();

const DEV_WEBSOCKET_PORT = resolveDevWebSocketPort(process.env.VITE_DEV_SERVER_PORT, 3000);

export default defineConfig(({ command }) => ({
  appType: "spa",
  base: "/",
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
}));
