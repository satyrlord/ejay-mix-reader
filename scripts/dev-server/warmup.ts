/**
 * dev-server/warmup.ts — Source-file lists for Vite dev-server warmup.
 *
 * Exporting these constants from a dedicated module keeps
 * `vite.config.ts`, `.nycrc.json`, and `tsconfig.browser.json` in sync:
 * all three must reference the same set of browser runtime entry points
 * for coverage instrumentation, warmup gating, and browser type-checking
 * to stay aligned.
 *
 * The `blockingWarmup` Vite plugin that consumes `WARMUP_FILES` lives in
 * `vite.config.ts` until Phase D.2.5.
 *
 * Consumers:
 *   - vite.config.ts (`blockingWarmup`, `server.warmup.clientFiles`,
 *     Istanbul `include` list)
 */

/**
 * Browser runtime TypeScript source files subject to Istanbul
 * instrumentation during coverage runs. Order does not matter.
 */
export const COVERAGE_SOURCE_FILES = [
  "src/main.ts",
  "src/app-controller.ts",
  "src/main-controller-types.ts",
  "src/category-config-controller.ts",
  "src/sample-browser-controller.ts",
  "src/mix-playback-controller.ts",
  "src/main-helpers/filter-sort.ts",
  "src/main-helpers/subcategory-ops.ts",
  "src/main-helpers/sequencer.ts",
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
  "src/product-mode.ts",
] as const;

/**
 * Files that `blockingWarmup` pre-transforms before the dev server allows
 * the first browser request through. Includes `app.css` so Tailwind is
 * compiled alongside the TypeScript entry points.
 */
export const WARMUP_FILES = [...COVERAGE_SOURCE_FILES, "src/app.css"] as const;
