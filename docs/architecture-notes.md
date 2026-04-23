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

output/                    ← normalized browser library root: metadata.json,
                              categories.json, and WAV folders grouped by
                              category/subcategory
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

During local development, the Vite server also exposes two project-specific
endpoints:

1. `/mix/<product>/<filename>` — allow-listed access to archived `.mix` files.
2. `PUT /__category-config` — dev-only persistence for `output/categories.json`.

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

The browser shell is split into three stacked regions above the fixed transport
bar:

- **Top editor area** — A `Mix Archive` sidebar placeholder on the left and a
  sequencer/timeline placeholder on the right. The renderer shows the shell,
  but archive browsing and mix editing are not yet wired into the main app.
- **Middle context strip** — Current mix status text plus subcategory tabs,
  sample search input, sample-bubble zoom controls, and the BPM filter.
- **Bottom browser area** — A category sidebar and a lane-based sample grid.
  The sidebar includes regular categories plus system actions such as
  `Unsorted` and `Load JSON`.

Samples are rendered as beat-scaled blocks rather than table rows. The browser
sorts them by descending beat length and then by display name. Search terms are
matched against the display name plus the rendered metadata line.

### Terminology

- In browser-facing UI, `Category` means the extracted sample-group/folder
  classification (shown in the sidebar). `Subcategory` is the finer grouping
  shown as tabs within a category and is sourced from `output/categories.json`
  when available.
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

- **Browser library data lives in `output/`**: `metadata.json`, optional
  `categories.json`, and WAV files organized into category/subcategory
  folders. These are generated by the extraction/normalization scripts and
  should not be hand-edited unless you are intentionally editing the category
  config during local development.
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

## Planned: MIX Sample Resolution Translation Layer

When loading a `.mix` file in the browser, sample references emitted by
`src/mix-parser.ts` (`MixIR.sampleRef`-style entries) are currently resolved
directly against `data/index.json` / `output/<product>/metadata.json`. Some
references fail because the original sample lives under a different product
folder (deduplicated by `scripts/find-duplicates.ts`) or under a renamed
filename (`scripts/rename-samples.ts`). Today these failures silently drop
the voice from playback.

This section captures the plan to introduce a dedicated **sample resolution
translation layer** with a tiered fallback strategy and structured logging.

### Goals

- Centralise *every* sample lookup performed by `src/mix-player.ts` (and any
  future MIX consumer) behind a single resolver API.
- Apply a deterministic chain of fallbacks before declaring a sample missing.
- Emit a machine-readable log of unresolved samples so the catalog and
  duplicate database can be improved over time.
- Keep the resolver pure-by-default and unit-testable without a real
  `AudioContext` or filesystem (mirrors the `mix-player.ts` style).

### Resolution Pipeline

For each `(product, channel, filename)` reference requested by the player:

1. **Primary lookup** — exact match in the in-memory catalog built from
   `data/index.json`. This is the existing behaviour.
2. **Duplicate fallback** — if the primary lookup misses, consult a parsed
   index of `logs/duplicates.csv` (keyed by `(product, channel, filename)`
   and by `hash_prefix`). If any duplicate row exists for the same
   `hash_prefix`, return the first row whose target file is present in the
   catalog.
3. **Catalog-wide fallback** — if duplicates do not yield a hit, perform a
   filename-only search across **all** `output/**/metadata.json` entries
   (already aggregated in `data/index.json`). The first match wins; matches
   with the same channel are preferred over cross-channel matches.
4. **Logged miss** — if all three tiers fail, append a row to
   `logs/log.csv` (created on demand) and return `null` so the player can
   skip the voice without throwing.

### Log Format (`logs/log.csv`)

CSV with a stable header so the file can be opened in tooling and diffed in
git:

```csv
timestamp_iso,mix_path,product,channel,filename,reason
```

- `reason` is one of `not_in_catalog`, `not_in_duplicates`,
  `not_in_any_metadata` — emitted at whichever tier produced the final
  miss (always `not_in_any_metadata` for full-pipeline failures, but the
  field is reserved for future per-tier diagnostics).
- Rows are append-only; the resolver de-duplicates within a single load
  session to avoid log spam from a repeated voice.

### New Files

- `src/sample-resolver.ts` — pure resolver: takes a catalog snapshot, a
  parsed duplicates index, and a logger callback; exports a
  `resolveSample(ref): ResolvedSample | null` function plus small helpers
  (`parseDuplicatesCsv`, `buildDuplicateIndex`, `formatLogRow`).
- `src/duplicates-loader.ts` — browser-side fetch + parse for
  `logs/duplicates.csv`. Returns the structured index consumed by
  `sample-resolver.ts`. Kept separate so the resolver itself stays pure.
- `src/miss-logger.ts` — thin abstraction over the log sink. In the
  browser this POSTs (or buffers + downloads) CSV rows; in tests it is
  replaced with an in-memory collector.
- `src/__tests__/sample-resolver.test.ts` — Vitest unit coverage for the
  three-tier pipeline, duplicate index lookup, and log row formatting.

### Touched Existing Files

- `src/mix-player.ts` — replace direct catalog lookups with calls to
  `resolveSample`. Inject the resolver via constructor/factory so tests
  keep using stubs.
- `src/mix-parser.ts` — no behavioural change; only verify that emitted
  `sampleRef` entries carry enough fields (`product`, `channel`,
  `filename`) for the resolver.
- `src/data.ts` — expose the aggregated `data/index.json` view as a
  catalog snapshot the resolver can consume without re-fetching.
- `index.html` / Vite static-asset config — ensure `logs/duplicates.csv`
  is served at runtime (read-only). `logs/log.csv` is **not** shipped;
  it is a developer-side artifact populated by the miss logger.

### Tooling and Tests

- **Build/serve** — `logs/duplicates.csv` becomes a runtime asset. Add it
  to Vite's `publicDir` allow-list (or copy via a build step) without
  enlarging the production bundle.
- **Unit tests** (`npm run test:unit`) — cover the resolver in isolation:
  primary hit, duplicate fallback, catalog-wide fallback, logged miss,
  duplicate row malformed, empty duplicates file, repeated misses
  de-duplicated within a session.
- **Playwright** (`tests/mix-playback.spec.ts`) — add a regression that
  loads a known-good `.mix` whose voices include at least one
  duplicate-only sample, asserting playback proceeds and no
  `not_in_any_metadata` row is produced.
- **Coverage** — `src/sample-resolver.ts`, `src/duplicates-loader.ts`,
  and `src/miss-logger.ts` must each meet the 80% per-cell threshold
  enforced by `scripts/test-coverage.ts`. Add them to the browser
  include lists in `vite.config.ts`, `.nycrc.json`, and
  `tsconfig.browser.json`.

### Out of Scope

- Editing `logs/duplicates.csv` (read-only input produced by
  `scripts/find-duplicates.ts`).
- Mutating any `output/**/metadata.json` file at runtime.
- Persisting `logs/log.csv` from the browser without a developer-driven
  download/POST step (no silent server writes from the SPA).
