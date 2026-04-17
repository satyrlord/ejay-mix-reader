# Architecture Notes

## File Structure

```text
index.html                 ← SPA entry point; Vite serves and bundles from here
package.json               ← npm scripts: serve, build, preview, test,
                              test:unit, test:unit:coverage, test:coverage,
                              typecheck, lint:md, validate
vite.config.ts             ← Vite config: Tailwind/DaisyUI integration,
                              Istanbul instrumentation
playwright.config.ts       ← Playwright config with auto-started Vite web server
tsconfig.json              ← Node/tooling TypeScript project
tsconfig.browser.json      ← Browser-runtime TypeScript project
.nycrc.json                ← nyc coverage reporting config

src/app.css                ← shared stylesheet (Tailwind import, DaisyUI theme,
                              custom component CSS)
src/data.ts                ← data loading and product/sample catalog access
src/library.ts             ← library/domain helpers used by the browser UI
src/main.ts                ← browser entry point and app renderer
src/player.ts              ← browser audio playback helpers for sample preview
src/render.ts              ← DOM rendering for the browser UI
src/env.d.ts               ← ambient type declarations (CSS modules)

scripts/test-coverage.ts   ← Playwright + nyc coverage runner and threshold
                              enforcement
scripts/build-index.ts     ← generates data/index.json from extracted output

tests/baseFixtures.ts      ← Playwright fixtures with Istanbul coverage capture
tests/browser.spec.ts      ← browser interaction and regression coverage
tests/smoke.spec.ts        ← browser smoke test

tools/pxd-parser.ts        ← PXD format parser and packed archive extractor
tools/reorganize.ts        ← channel folder organizer using INF metadata
tools/find-duplicates.ts   ← duplicate sample detection by PCM hash
tools/gen1-catalog.ts      ← Gen 1 MAX/Pxddance/PXD.TXT catalog parser
tools/mix-grid-analyzer.ts ← Gen 1 `.mix` grid and trailer analyzer
tools/mix-parser.ts        ← unified `.mix` parser emitting MixIR
tools/mix-types.ts         ← shared MixIR TypeScript interfaces
tools/rename-samples.ts    ← filename normalisation and renumbering

docs/file-formats.md       ← sample/archive/container format reference
docs/mix-format-analysis.md ← canonical `.mix` format reference
docs/mix-player-prerequisites.md ← ordered `.mix` implementation roadmap

output/<product>/          ← extracted WAV files + metadata.json per product
archive/                   ← read-only source data (14 product folders +
                              auxiliary `_userdata/` imports)
codec/                     ← proprietary DLLs and verification scripts (optional)

dist/                      ← generated Vite production build
coverage/                  ← generated Istanbul HTML/LCOV report
playwright-report/         ← generated Playwright HTML report
test-results/              ← generated Playwright artifacts
.nyc_output/               ← generated raw Istanbul coverage JSON
```

Browser runtime code lives in `src/`, TypeScript extraction tools live in
`tools/`, and build/coverage scripts live in `scripts/`. Vite bundles `src/`
into `dist/assets/` for production.

## Root-Level Contract

- **The HTML entry file is part of the runtime contract**: `index.html` is
  referenced by `vite.config.ts`, Playwright tests, and the browser runtime.
  Moving or renaming it is a route change.
- **Toolchain configs belong at the root**: `package.json`, `vite.config.ts`,
  `playwright.config.ts`, `tsconfig.json`, `tsconfig.browser.json`, and
  `.nycrc.json` are loaded from the workspace root by their respective tools.
- **Generated artifact folders are disposable**: `dist/`, `coverage/`,
  `playwright-report/`, `test-results/`, and `.nyc_output/` are not
  hand-maintained source folders.
- **Generated artifact locations are hard-coded**: moving them requires
  coordinated edits in `.gitignore`, `.nycrc.json`, `playwright.config.ts`,
  `scripts/test-coverage.ts`, and `tests/baseFixtures.ts`.

## Build and Runtime Flow

`npm run serve` starts the Vite dev server on `http://127.0.0.1:3000/`.

`npm run build` runs the Vite production build to `dist/`.

`npm run test` runs Playwright tests against `http://127.0.0.1:3000/`.
If that Vite dev server is already running, Playwright reuses it; otherwise it
starts Vite itself on port 3000 with `--strictPort`.

`npm run test:coverage` executes `scripts/test-coverage.ts`, which:

1. Cleans `.nyc_output/` and `coverage/`.
2. Runs Playwright tests with `VITE_COVERAGE=true` to enable Istanbul
   instrumentation via `vite-plugin-istanbul`.
3. Generates nyc coverage reports (text, HTML, LCOV, JSON summary).
4. Enforces per-file coverage thresholds (currently 80%).

`npm run typecheck` checks both TypeScript projects separately:
`tsconfig.json` (Node/scripts/tests) and `tsconfig.browser.json` (browser
runtime in `src/`).

`npm run validate` runs typecheck + markdownlint.

## Browser UI Contract

- On the product list, the header title remains `eJay Sound Browser`.
- On a product page, the header title switches to the selected product name.
- The sample table columns are: play control, `Name`, `Category`, `Beats`, and
  `Duration`.
- The `Name` cell uses `<Category> - <Name>` when a category exists.
- Sort controls live in the table header. `Name` and `Category` sort
  alphabetically; `Beats` and `Duration` sort numerically.
- The filter group is labeled `Category filters`.
- In browser-facing UI, `Category` means the extracted sample-group/folder
  classification. Audio `channels` still refers to mono/stereo metadata in
  `metadata.json`.

## Language Constraints

- **TypeScript for browser and build tooling** — all `src/`, `scripts/`, and
  `tests/` code is `.ts`.
- **TypeScript for offline tooling** — the `tools/` directory contains batch
  extraction, catalog, analysis, and MIX-parser utilities run via `tsx`. These
  files are not part of the browser runtime or build pipeline.
- **No runtime database** — extracted audio metadata is served as static JSON
  files from `output/`.

## UI and Style Documentation

See [style-guide.md](style-guide.md) for the DaisyUI theme tokens, channel
color palette, typography, component anatomy, layout rules, and responsive
behavior.

The live source of truth is the code in `src/app.css` and the renderer modules
under `src/`. If documentation drifts, the code wins and the style guide should
be updated.

## Editing Guidelines

- **Extracted data lives in `output/<product>/`**: `metadata.json` plus WAV
  files in channel subfolders. These are generated by `tools/pxd-parser.ts` and
  `tools/reorganize.ts` — do not hand-edit.
- **Source data is read-only**: never modify files under `archive/`.
- **MIX documentation is split by purpose**:
  `docs/mix-format-analysis.md` is the low-level `.mix` format reference and
  `docs/mix-player-prerequisites.md` is the implementation roadmap. Keep MIX
  specifics there rather than duplicating them in broader project docs.
- **Techno eJay 3 has a verified product-specific override**: the original
  `seiten` file defines a `Sphere` tab, and the `SRC*` bank in `rave30.inf`
  belongs there rather than under `Scratch`.
- **When adding a new browser runtime file**, update the browser file lists in
  `vite.config.ts` (Istanbul `include`), `.nycrc.json` (coverage `include`),
  and `tsconfig.browser.json` (`include`) so instrumentation, reporting, and
  browser type-checking remain aligned.
- **Generated report/temp directories are disposable**: do not treat
  `coverage/`, `playwright-report/`, `test-results/`, `.nyc_output/`, or
  `dist/` as hand-maintained source folders.
