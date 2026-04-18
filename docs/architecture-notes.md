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
tsconfig.config.json       ← TypeScript project for root config files
.nycrc.json                ← nyc coverage reporting config

src/app.css                ← shared stylesheet (Tailwind import, DaisyUI theme,
                              custom component CSS)
src/data.ts                ← data loading and product/sample catalog access
src/library.ts             ← library/domain helpers used by the browser UI
src/main.ts                ← browser entry point and app renderer
src/mix-buffer.ts          ← browser Buffer/DataView wrapper for MIX parsing
src/mix-parser.ts          ← browser-side `.mix` parser emitting MixIR
src/mix-player.ts          ← browser MIX loader and Web Audio helpers
src/player.ts              ← browser audio playback helpers for sample preview
src/render.ts              ← DOM rendering for the browser UI
src/env.d.ts               ← ambient type declarations (CSS modules)

scripts/test-coverage.ts   ← Playwright + nyc coverage runner and threshold
                              enforcement
scripts/build-index.ts     ← generates data/index.json from extracted output

tests/baseFixtures.ts      ← Playwright fixtures with Istanbul coverage capture
tests/browser.spec.ts      ← browser interaction and regression coverage
tests/mix-playback.spec.ts ← Playwright MIX loading/parsing coverage
tests/smoke.spec.ts        ← browser smoke test

scripts/pxd-parser.ts        ← PXD format parser and packed archive extractor
scripts/reorganize.ts        ← channel folder organizer using INF metadata
scripts/normalize.ts         ← flatten all products into a single channel tree
scripts/enrich-metadata.ts   ← backfill missing BPM/category data in metadata
scripts/find-duplicates.ts   ← duplicate sample detection by PCM hash
scripts/gen1-catalog.ts      ← Gen 1 MAX/Pxddance/PXD.TXT catalog parser
scripts/mix-grid-analyzer.ts ← Gen 1 `.mix` grid and trailer analyzer
scripts/mix-parser.ts        ← unified `.mix` parser emitting MixIR
scripts/mix-resolver.ts      ← MixIR sample-reference resolver against output/
scripts/mix-types.ts         ← shared MixIR TypeScript interfaces
scripts/rename-samples.ts    ← filename normalisation and renumbering
scripts/reconstruct-top-level-metadata.ts ← rebuild metadata.json from WAV layout
scripts/sequence-detect.ts   ← PCM-based heuristics for sequence/loop detection
scripts/sequence-migrate.ts  ← promote loop-intended Keys samples to Sequence
scripts/wav-decode.ts        ← minimal WAV reader for sequence/loop analysis

docs/file-formats.md       ← sample/archive/container format reference
docs/mix-format-analysis.md ← canonical `.mix` format reference

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
`scripts/`, and build/coverage scripts live in `scripts/`. Vite bundles `src/`
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

`npm run typecheck` checks all four TypeScript projects separately:
`tsconfig.json` (Node/tools), `tsconfig.browser.json` (browser runtime in
`src/`), `tsconfig.config.json` (root config files), and `tsconfig.test.json`
(test files).

`npm run validate` runs typecheck, Vitest unit tests with coverage, and
markdownlint.

## Browser UI Contract

The app is a single-page application with two states:

### Home Page

- Centered hero with app logo, title (`eJay Sound Browser`), description,
  folder-picker button, and optional dev-library shortcut.
- A **BPM filter** dropdown sits at the bottom-right of the home area
  (persists into the main view once a library is loaded).

### Main App View (after loading a library)

The product-list and table-based sample views are replaced by a single
sequencer-inspired layout:

- **Left sidebar** — A vertical two-column grid of **category buttons**
  (one button per top-level channel such as Bass, Drum, Effect, etc.).
  Clicking a category button selects it and populates the subcategory
  tabs and sample grid.
- **Top tab bar** — A horizontal row of **subcategory tabs** scoped to
  the active category. A `+` button at the end allows adding or
  importing new subcategory groupings.
- **Main grid** — A sequencer-style grid of **sample blocks** arranged
  in rows. Each row represents a channel/lane; each block represents
  a sample that can be previewed or placed.
- **BPM filter** — A dropdown control for filtering samples by tempo.

### Terminology

- In browser-facing UI, `Category` means the extracted sample-group/folder
  classification (shown in the sidebar). `Subcategory` is the finer
  grouping shown as tabs within a category.
- Audio `channels` still refers to mono/stereo metadata in `metadata.json`.

## Language Constraints

- **TypeScript for browser and build tooling** — all `src/`, `scripts/`, and
  `tests/` code is `.ts`.
- **TypeScript for offline tooling** — the `scripts/` directory contains batch
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
  files in channel subfolders. These are generated by `scripts/pxd-parser.ts` and
  `scripts/reorganize.ts` — do not hand-edit.
- **Source data is read-only**: never modify files under `archive/`.
- **Keep MIX format detail in the dedicated reference**:
  `docs/mix-format-analysis.md` is the low-level `.mix` format reference.
  Keep MIX-specific format notes there rather than duplicating them in broader
  project docs.
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
