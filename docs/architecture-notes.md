# Architecture Notes

## File Structure

```text
index.html                 ← SPA entry point; Vite serves and bundles from here
package.json               ← npm scripts: serve, build, test,
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
src/main.ts                ← browser entry point and app controller; wires the
                              mix browser, sequencer viewport, and playback
                              transport
src/mix-buffer.ts          ← browser Buffer/DataView wrapper for MIX parsing
src/mix-parser.ts          ← canonical browser-side `.mix` parser emitting MixIR
src/mix-player.ts          ← browser playback-plan builder, sample resolver,
                              and Web Audio scheduling helpers
src/player.ts              ← browser audio playback helpers for sample preview
src/render.ts              ← DOM rendering for the browser UI
src/sample-grid-context-menu.ts ← sample-grid right-click controller for
                              move/sort menus and dismiss lifecycle
src/env.d.ts               ← ambient type declarations (CSS modules)
src/mix-file-browser.ts    ← in-app .mix file browser for the archive-tree
                              panel; reads `mixLibrary` from `data/index.json`;
                              hovering a `.mix` file shows a metadata tooltip;
                              clicking opens a floating `.mix-meta-popup`
                              panel.
                              Public API: `initMixFileBrowser`,
                              `showMixMetaPopup`, `dismissMixMetaPopup`,
                              `isMixMetaPopupVisible`, `formatMetaTooltip`,
                              `buildMetaRows`, `MixFileRef`, `MixFileSource`,
                              `MixFileBrowserOptions`

scripts/dev-server/        ← Vite dev-server plugin and helper modules
  csp.ts                   ← pure CSP string builder (no Vite imports)
  csp-plugin.ts            ← `injectContentSecurityPolicy` Vite plugin shell
  warmup.ts                ← warmup file lists and Istanbul include constants
  warmup-plugin.ts         ← `blockingWarmup` Vite plugin shell
  mix-files-plugin.ts      ← `serveMixFiles` Vite plugin shell
  category-config-plugin.ts ← `manageCategoryConfig` Vite plugin shell; watches
                              `output/categories.json` and exposes
                              `PUT /__category-config`
  sample-metadata-plugin.ts ← `manageSampleMetadata` Vite plugin shell; exposes
                              `PUT /__sample-move`
  index.ts                 ← shared pure helpers reused by multiple plugin shells:
                              `resolveMixUrl`, `createCategoryConfigMiddleware`,
                              `validateSampleMovePaths`, `applySampleMoveToManifest`,
                              `buildPerCategorySummary`

scripts/test-coverage.ts   ← Playwright + nyc coverage runner and threshold
                              enforcement
scripts/build-index.ts     ← generates data/index.json from extracted output;
                              also populates MixFileMeta on each MixFileEntry,
                              merges embedded-MIX manifest samples into the
                              browser catalog, and appends `_userdata` mix
                              groups after product archives

scripts/extract-mix-metadata.ts ← standalone script (`npm run mix:meta`) that
                              walks all archive .mix files, parses them, and
                              writes a compact manifest to data/mix-metadata.json;
                              also exports `irToMeta` for reuse
scripts/extract-embedded-mix-audio.ts ← extracts in-band WAV payloads from
                              oversized `.mix` files into
                              output/Unsorted/embedded mix and writes
                              output/Unsorted/embedded-mix-audio-manifest.json
scripts/gen-missing-beats-report.ts ← scans archived `.mix` files for
                              unresolved sample references and writes
                              logs/missing-beats-report.json
scripts/recover-missing-samples.ts ← recovers WAVs named in the missing-beats
                              report from output/ or an external library and
                              appends metadata to output/metadata.json

tests/baseFixtures.ts      ← Playwright fixtures with Istanbul coverage capture
tests/browser.spec.ts      ← browser interaction and regression coverage
tests/mix-playback.spec.ts ← Playwright MIX loading/parsing coverage
tests/smoke.spec.ts        ← browser smoke test

scripts/pxd-parser.ts        ← PXD format parser and packed archive extractor
scripts/reorganize.ts        ← channel folder organizer using INF metadata
scripts/normalize.ts         ← flatten all products into a single channel tree
scripts/enrich-metadata.ts   ← backfill missing BPM/category data in metadata
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
                              categories.json, WAV folders grouped by
                              category/subcategory, and optional
                              Unsorted/embedded-mix-audio-manifest.json
archive/                   ← read-only source data (14 product folders +
                              auxiliary `_userdata/` imports indexed as mix
                              browser groups)
codec/                     ← proprietary DLLs and verification scripts (optional)

dist/                      ← generated Vite build output
coverage/                  ← generated Istanbul HTML/LCOV report
playwright-report/         ← generated Playwright HTML report
test-results/              ← generated Playwright artifacts
.nyc_output/               ← generated raw Istanbul coverage JSON
```

Browser runtime code lives in `src/`, TypeScript extraction tools live in
`scripts/`, and build/coverage scripts live in `scripts/`. Vite bundles `src/`
into `dist/assets/` when `npm run build` is executed.

`vite.config.ts` is a composition root only — it wires together constants and
the five plugin shells from `scripts/dev-server/` without containing any plugin
logic itself. The dev-server module layout is:

| File | Responsibility |
|------|----------------|
| `csp.ts` | Pure CSP string builder |
| `csp-plugin.ts` | `injectContentSecurityPolicy` Vite plugin shell |
| `warmup.ts` | Warmup file lists and Istanbul include constants |
| `warmup-plugin.ts` | `blockingWarmup` Vite plugin shell |
| `mix-files-plugin.ts` | `serveMixFiles` plugin shell |
| `category-config-plugin.ts` | `manageCategoryConfig` plugin shell |
| `sample-metadata-plugin.ts` | `manageSampleMetadata` plugin shell |
| `index.ts` | Shared pure helpers reused across plugin shells |

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

`npm run build` regenerates `data/index.json` and writes a local Vite bundle
to `dist/`.

Before Vite bundles the app, `scripts/build-index.ts` regenerates
`data/index.json`. That step merges recovered embedded-MIX samples into the
browser catalog, enriches each `.mix` entry with parsed `MixFileMeta`, and
includes `_userdata` directories after the product archive groups.

Timeline diagnostics strategy (Phase C decision):

- `scripts/extract-mix-metadata.ts::irToMeta` is the canonical mapper from
  `MixIR` to `MixFileMeta` and now includes `laneCount`,
  `timelineRecovered`, and `maxBeat`.
- `scripts/build-index.ts` and `npm run mix:meta` both consume that mapper,
  so `data/index.json` and `data/mix-metadata.json` expose the same
  diagnostics fields.
- `src/mix-file-browser.ts::mixMetaFromIr` remains the runtime fallback for
  selected `.mix` entries that do not include prebuilt index metadata.

During local development, the Vite server also exposes path-aware project
endpoints:

1. `/mix/<product>/<filename>` — allow-listed access to archived `.mix` files
  across configured archive roots.
2. `/output/<path>` — read-only file serving from the configured output root,
  so browser fetches keep using stable `output/...` URLs.
3. `GET /__path-config` — returns the effective path configuration plus
  validation status.
4. `PUT /__path-config` — updates persisted archive/output roots for the local
  machine profile and emits a hot-update event.
5. `PUT /__category-config` — persistence for `output/categories.json`.
6. `PUT /__sample-move` — sample moves between category/subcategory folders;
  patches `output/metadata.json` and emits a hot-update event so the grid
  reloads in place.

Path-config selection supports two environment variables for multi-machine
workflows:

1. `EJAY_PATH_CONFIG` — explicit file path override.
2. `EJAY_PATH_PROFILE` — selects `data/path-config.<profile>.json` when no
  explicit override is set.
3. `EJAY_DEFAULT_ARCHIVE_ROOTS` — fallback archive roots used only when no
  configured path file is present.
4. `EJAY_DEFAULT_OUTPUT_ROOT` — fallback output root used only when no
  configured path file is present.

These values can be provided through process environment variables or a local
`.env.local` file at the repository root.

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

The app is a single-page application that boots directly into the main shell.

### Main App View

The browser shell is split into three stacked regions above the fixed transport
bar:

- **Top editor area** — A live `Mix Archive` browser on the left and a real
  sequencer timeline on the right. The archive tree loads from
  `data/index.json`. Clicking a `.mix` item opens a metadata popup, parses the
  file, and renders a fixed-width beat timeline with a moving playhead and
  horizontal auto-scroll.
- **Middle context strip** — Current mix status text plus subcategory tabs,
  sample search input, sample-bubble zoom controls, and the BPM filter.
- **Bottom browser area** — A category sidebar and a lane-based sample grid.
  The sidebar includes regular categories plus system actions such as
  `Unsorted` and `Load JSON`.

Samples are rendered as beat-scaled blocks rather than table rows. The browser
matches search terms against the display name plus the rendered metadata line.
The default sort is descending beat length and then display name, but
right-clicking empty grid space opens a sort menu for name, BPM, sample
length, product, detail, subcategory, and source. Right-clicking a sample
block opens a `Move to` menu, persisted through `PUT /__sample-move`.

### Terminology

- In browser-facing UI, `Category` means the extracted sample-group/folder
  classification (shown in the sidebar). `Subcategory` is the finer grouping
  shown as tabs within a category and is sourced from `output/categories.json`
  when available.
- Audio `channels` still refers to mono/stereo metadata in `metadata.json`.

## MIX Playback Contract

The browser runtime treats `.mix` playback as a three-stage flow:

1. `src/mix-file-browser.ts` emits a `MixFileRef` with a canonical `productId`
  plus a `/mix/` URL byte source.
2. `src/main.ts` reads the bytes, calls `parseMixBrowser(...)`, and converts the
   resulting `MixIR` into a `MixPlaybackPlan` via `buildMixPlaybackPlan(...)`.
3. The sequencer renders that plan as a horizontally scrollable DAW-style
   viewport. Pressing Play lazily creates or resumes `AudioContext`, fetches
   and decodes resolved WAVs, schedules them through `MixPlayerHost`, and keeps
   the playhead moving even when some or all events are still silent.

The plan contract is intentionally small and browser-safe:

- `beat` maps to a zero-based beat offset. When a format does not expose a
  recoverable beat, the browser falls back to beat `0`.
- `channel` maps to `lane-<index>` when known; otherwise the browser falls back
  to `track-<placement index>` so every parsed event still gets a visible row.
- `loopBeats` is `max(event.beat) + 1`, clamped to at least `1`.
- Missing sample references remain visible as dashed timeline blocks and play
  silence rather than aborting the load.

### Browser Sample Resolution

`data/index.json` carries a browser-ready `sampleIndex` keyed by product id.
Each product entry contains five lookup maps:

- `bySampleId` for Gen 2/3 numeric sample ids.
- `byInternalName` for PXD stems such as `D5MG539`.
- `byAlias` for human labels such as `kick28`.
- `byStem` for filename-stem fallback.
- `bySource` for Gen 1 source-path lookups and diagnostics.

The browser lookup order is: primary product, catalog-derived product hints,
product fallbacks, then any already-populated `resolvedPath`. Older checked-in
indexes may omit `bySampleId` and `byInternalName`; the runtime tolerates that
shape and degrades to the older alias/stem path.

### Preload Strategy

The current browser uses **on-demand fetch and decode**, not eager preload.

- Selecting a `.mix` parses bytes and renders the timeline only.
- Pressing Play fetches only the distinct resolved `audioUrl` entries needed by
  the current plan.
- Decoded buffers are cached in-memory for the life of the page so repeat plays
  do not re-fetch or re-decode the same WAVs.

This keeps the initial editor response fast for long mixes and avoids decoding
silent or unresolved events up front. The tradeoff is that the first Play on a
mix still pays the decode cost for whichever events resolve successfully.

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
- **Recovered embedded-MIX provenance lives beside the output library**:
  `output/Unsorted/embedded-mix-audio-manifest.json` is generated by
  `npm run mix:extract-embedded`, and `scripts/build-index.ts` merges it back
  into the browser catalog as synthetic `Embedded MIX` samples.
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
folder (after library cleanup/reorganization) or under a renamed
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
  and by `hash_prefix`) when that report is available. If any duplicate row
  exists for the same `hash_prefix`, return the first row whose target file
  is present in the catalog.
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
  optional `logs/duplicates.csv` input. Returns the structured index consumed by
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
- `index.html` / Vite static-asset config — `logs/duplicates.csv` is an
  optional developer-provided input and is not required to be checked in.
  `logs/log.csv` is **not** shipped; it is a developer-side artifact
  populated by the miss logger.

### Tooling and Tests

- **Build/serve** — keep resolver fallback behavior deterministic when
  `logs/duplicates.csv` is absent (skip duplicate tier, continue to
  catalog-wide fallback and miss logging).
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

- Editing legacy `logs/duplicates.csv` files (if present).
- Mutating any `output/**/metadata.json` file at runtime.
- Persisting `logs/log.csv` from the browser without a developer-driven
  download/POST step (no silent server writes from the SPA).
