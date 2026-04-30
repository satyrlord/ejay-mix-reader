# Refactor & Milestone 3 Completion Plan

> Single source of truth for the remaining Milestone 3 (MIX playback)
> reverse-engineering work and the two outstanding maintainability
> refactors (Issue 13: `src/main.ts`, Issue 15: `vite.config.ts`).
>
> Sequenced so that the plan can be started immediately. Steps are
> grouped into phases that can run in parallel where noted; within a
> phase, steps must be done in order.

## 0. Current State (verified April 2026)

### Milestone 3 — MIX playback

| Area | File(s) | Status |
|------|---------|--------|
| Format detection | [`src/mix-parser.ts`](../src/mix-parser.ts) `detectFormat` | Done |
| Format A grid (Gen 1) | `parseFormatA` | **Done** (deterministic dual 8×351 uint16 LE grid + `0x0A08` trailer at `0x2BE2`) |
| Format A lane count = 8 | `lanesForMix` | **Done** |
| Format A `loopBeats` from grid | `buildMixPlaybackPlan` | **Done** |
| Format B parser | `parseFormatB`, `parseFormatBTracks` | Parses; **`channelByte` semantics unverified** |
| Format C/D parser | `parseFormatCTracks`, `parseFormatDTracks` | Walks `pxd32p?.tmp` pairs; **always emits `beat: null, channel: null`** |
| `MixPlaybackPlan.lanes` from generation | `src/mix-player.ts` `LANE_COUNT_BY_FORMAT` | **Done** (Gen 1 = 8, Gen 2 = 17, Gen 3+ = 32) |
| `loopBeats: number \| null` + list view fallback | `src/mix-player.ts`, `src/main.ts` | **Done** |
| Diagnostics in mix popup (`Lanes`, `Timeline`) | `src/mix-file-browser.ts`, `MixFileMeta` | **Done** |
| Perf baseline regen | local playback baseline run | Deferred until Format B/C/D timeline lands |

**Open work:** Format B channel byte verification (§1) and Format C/D
beat + channel reverse engineering (§2). 9 of 14 products (all Gen 3+)
currently render as flat list views.

### Refactor — Issue 13 (`src/main.ts`, 1069 lines)

Nothing extracted yet. `src/` still contains only the original modules
(`main.ts`, `mix-player.ts`, `mix-file-browser.ts`, `mix-parser.ts`,
`render.ts`, `render/`, `library.ts`, `data.ts`,
`sample-grid-context-menu.ts`, `player.ts`, `mix-buffer.ts`,
`mix-types.ts`).

### Refactor — Issue 15 (`vite.config.ts`, 450 lines)

All plugin shells extracted. `vite.config.ts` is now a composition root
(imports, constants, `defineConfig` assembly) — under 100 lines. All
plugin logic lives in focused `scripts/dev-server/` modules.

---

## Phase Sequencing Overview

```text
   ┌─────────────────────────────────────────────────────────────┐
   │ Phase A — Format B channel verification (§1)                │
   │ Phase B — Format C/D beat & channel RE (§2)                 │
   │ Phase C — Plumb new fields through plan + UI (§3)           │
   └─────────────────────────────────────────────────────────────┘
                       can run in parallel with
   ┌─────────────────────────────────────────────────────────────┐
   │ Phase D — De-densify vite.config.ts (Issue 15) (§4)         │
   │ Phase E — Break up src/main.ts (Issue 13) (§5)              │
   └─────────────────────────────────────────────────────────────┘
```

Recommended start order:

1. **Phase D** first — lowest risk, smallest blast radius, clears
   ground for later config changes that Phase C may need.
2. **Phase A** in parallel with Phase D — pure analyzer work, no
   runtime changes until findings are confirmed.
3. **Phase B** after Phase A lands (shared analyzer infrastructure).
4. **Phase C** after Phase A and Phase B (or incrementally as each
   format is unblocked).
5. **Phase E** last — depends on transport / playback APIs being
   stable; pulling apart `main.ts` while §3 is in flight risks
   double-touching the same lines.

The quality gate
([`.github/instructions/quality-gate.instructions.md`](../.github/instructions/quality-gate.instructions.md))
applies after every step.

---

## Phase A — Format B channel byte verification

**Goal:** prove or disprove that the byte currently consumed as
`channelByte` in `parseFormatBTracks` is the lane index, and either
keep it or replace it with the correct field.

### A.1 Build the analyzer — **Done**

- [x] Created and ran a temporary Format B analyzer script (retired after findings were captured).
- [x] Iterates every `.mix` file in Gen 2 products (`Dance_eJay2`,
  `Techno_eJay`, `HipHop_eJay2`) — 45 files, 453 track placements.
- [x] Records `(channelByte, sampleId, catalogCategory, productId, mixFile)`.
- [x] Captured a per-product channel histogram and verifier output.

### A.2 Cross-tab against `seiten` Soundgruppe table — **Done**

- [x] Analyzer embeds the per-product seiten table and cross-references
  each `channelByte` value against the zero-indexed channel name.
- [x] **Hypothesis test result:** SUPPORTED for all three products —
  each `channelByte` maps to exactly one seiten channel, and the byte
  value equals the channel's 0-based index in the Soundgruppe table.
  Bytes 0–4 (loop, drum, bass, guitar, sequence) are absent from the
  demo-mix corpus because those channels received no placements there.
- [x] Findings written to [`docs/mix-format-analysis.md`](mix-format-analysis.md)
  under "Format B Channel Field — Resolved (April 2026)".

### A.3 Locate real lane field — **Not needed**

The hypothesis passed. `channelByte` is confirmed as the zero-indexed
lane index. No adjacent-field search required.

### A.4 Update parser + tests — **Not needed**

`parseFormatBTracks` already sets `track.channel = channelByte`, which
is correct. No parser change required; existing Gen 2 fixtures remain
valid.

**Acceptance:** met — the current code is correct. Gen 2 mixes already
render sample blocks on the correct row of the 17-lane sequencer.

---

## Phase B — Format C/D beat & channel reverse engineering

**Goal:** recover `beat` and `channel` for Format C / D track records.
This is the **largest remaining blocker** — 9 of 14 products are Gen
3+.

### B.1 Build the record dumper

- [ ] Create `scripts/mix-format-cd-records.ts`.
- [ ] For every Format C / D mix, dump each track record as labelled
  hex: record start, name field, `unresolvedLaneCode`, unknown 32-bit
  field, data length, left/right `pxd32p?.tmp` paths, trailing bytes
  up to next record.
- [ ] Write per-product output to
  `logs/format-cd/<product>/<mix>.txt`.
- [ ] Verify: record offsets match those discovered by
  `parseFormatCTrackRecord`.

### B.2 Diff records sharing a sample

- [ ] In the analyzer, group records by `sampleId` within a single
  file.
- [ ] Emit a side-by-side diff highlighting the smallest changing
  fields.
- [ ] Pick `archive/Dance_eJay3/Mix/start.mix` as the canonical
  reference (matches the eJay 3 demo layout).
- [ ] Verify: at least one field varies in lockstep with the visual
  position in the demo mix.

### B.3 Identify beat field

- [ ] Compare candidate fields against beat positions known from the
  demo mix layout.
- [ ] Validate against a second product (`Techno_eJay3`) to rule out
  per-product encoding.
- [ ] Verify: candidate field maps monotonically to beat for at least
  three independent mixes.

### B.4 Identify channel field

- [ ] Repeat B.3 for the channel axis using the
  `unresolvedLaneCode` field plus any other candidates.
- [ ] Verify: candidate field maps to one of the 32 baseline lanes for
  every record in the demo mix.

### B.5 Update parsers + tests

- [ ] Update `parseFormatCTrackRecord` and `parseFormatDTracks` in
  [`src/mix-parser.ts`](../src/mix-parser.ts) to populate `beat` and
  `channel`.
- [ ] Where a record cannot be confidently positioned, leave
  `beat: null` and surface it via the existing list-view fallback.
- [ ] Update / regenerate Gen 3+ fixtures.
- [ ] Document findings in a new section "Format C / D Track Records
  — Recovered Fields" in
  [`docs/mix-format-analysis.md`](mix-format-analysis.md).
- [ ] Verify: full quality gate.

**Acceptance:** at least 80% of Format C records in `Dance_eJay3` and
`Techno_eJay3` produce a non-null `beat` and `channel`; remainder
falls back to list view without regressing existing playback.

---

## Phase C — Plumb new fields through the plan and UI

Runs incrementally as each format is unblocked in Phase A / B.

### C.1 Per-format `loopBeats` derivation

- [ ] Once Phase A lands, derive Format B `loopBeats` from the header
  /catalog beat count if discovered there; otherwise from
  `max(beat) + 1` rounded up to the next bar (multiple of 4).
- [ ] Once Phase B lands, do the same for Format C / D.
- [ ] Verify: no mix renders as a 1-beat loop unless the source genuinely
  has only one beat.

### C.2 Switch list-view → grid as recovery improves

- [ ] In `src/main.ts::renderMixPlan`, mixes whose tracks now carry
  finite beats automatically take the grid path (existing
  `timelineRecovered` flag already handles this — confirm it still
  fires).
- [ ] Verify: previously-list-view Gen 3+ mixes now render on the
  32-lane grid.

### C.3 Regenerate diagnostics + perf baseline

- [ ] Regenerate `data/mix-metadata.json` via `npm run mix:meta` so
  `MixFileMeta.timelineRecovered` and `maxBeat` reflect the new
  parsers.
- [ ] Re-run the local mix playback performance baseline capture.
- [ ] Verify: tooltip / popup shows `Timeline: recovered (N beats)`
  for Gen 2/3+ files where appropriate.

---

## Phase D — De-densify `vite.config.ts` (Issue 15)

**Goal:** reduce `vite.config.ts` to a composition root. Move plugin
implementations and helper logic into focused modules under
`scripts/dev-server/`.

### D.1 Pure helpers first — **Done**

- [x] D.1.1 Created `scripts/dev-server/csp.ts`.
- [x] D.1.2 Created `scripts/dev-server/mix-files.ts`.
- [x] D.1.3 Created `scripts/dev-server/warmup.ts`.
- [x] Verified: `npm run lint`, `npm run test:unit`,
  `npm run test:unit:coverage` all pass.

### D.2 Plugin shell extraction — **Done**

- [x] D.2.1 `injectContentSecurityPolicy` extracted to
  `scripts/dev-server/csp-plugin.ts`. Takes `devWebSocketPort` as an
  explicit parameter; 6 unit tests.
- [x] D.2.2 `blockingWarmup` extracted to
  `scripts/dev-server/warmup-plugin.ts`; 13 unit tests.
- [x] D.2.3 `manageCategoryConfig` extracted to
  `scripts/dev-server/category-config-plugin.ts`; 12 unit tests.
- [x] D.2.4 `manageSampleMetadata` extracted to
  `scripts/dev-server/sample-metadata-plugin.ts`; 12 unit tests.
  Added explicit `JSON.parse` error handling so malformed bodies
  return 400 rather than 500.
- [x] D.2.5 `serveMixFiles` + `copyMixFilesPlugin` extracted to
  `scripts/dev-server/mix-files-plugin.ts`; 12 unit tests (ESM
  `vi.mock("fs")` pattern used instead of `vi.spyOn` for
  `createReadStream`).
- [x] Verified after each: `npm run serve` still loads the app;
  `npm test` (Playwright) still passes; `npm run build` still copies
  `.mix` files.

### D.3 Composition cleanup — **Done**

- [x] D.3.1 `vite.config.ts` reduced to imports, constants, and
  `defineConfig` assembly; all plugin bodies removed.
- [x] D.3.2 Plugin imports grouped by responsibility (HTML transforms,
  dev-server endpoints, asset serving, coverage tooling). Plugin order
  preserved.

### D.4 Test hardening — **Done**

- [x] D.4.1 Unit tests for all five plugin shells added (55 tests
  total across `vite-csp-plugin.test.ts`, `vite-warmup-plugin.test.ts`,
  `vite-mix-files-plugin.test.ts`, `vite-category-config-plugin.test.ts`,
  `vite-sample-metadata-plugin.test.ts`). All `scripts/dev-server/` files
  meet the ≥ 80% per-cell coverage threshold.
- [x] D.4.2 `docs/architecture-notes.md` updated with the new
  dev-server module layout and responsibility table.
- [x] Verified: 850 unit tests passing; all coverage thresholds met;
  Playwright non-regressive.

### D.5 Rollback plan

If extraction breaks dev-server middleware or build output:

1. Revert the latest plugin-shell extraction commit only; keep
   pure-helper moves that already have passing tests.
2. Restore the previous plugin order in `vite.config.ts` before
   re-running the dev server.
3. Confirm `index.html` still receives CSP replacement in both serve
   and build flows before retrying.

---

## Phase E — Break up `src/main.ts` (Issue 13)

**Goal:** reduce `src/main.ts` to a bootstrap / composition module.
Move major behavior slices into narrower controllers.

### E.1 Stable boundaries

- [ ] E.1.1 Define a small controller-facing state model for the mix
  transport and sample browser (interfaces only, no behavior changes).
- [ ] E.1.2 Extract pure helpers first: sequencer row rendering
  inputs, subcategory-operation guards, filter / sort input builders.
  Place under `src/main-helpers/` or fold into existing `src/render/`
  modules where they fit.
- [ ] E.1.3 Define explicit controller APIs: `start`, `stop`,
  `dispose`, and event hooks.
- [ ] Verify after each: `src/main.ts` compiles; targeted unit tests
  for extracted helpers pass.

### E.2 Mix playback controller extraction

- [ ] E.2.1 Create `src/mix-playback-controller.ts`. Move
  mix-specific state (`activeMixPlan`, `mixPlaybackHost`, decode
  cache, animation frame, timeout ids) behind it.
- [ ] E.2.2 Move mix UI sync helpers (`getMixUi`, `syncMixUi`,
  `renderMixPlan`, playhead updates) behind the controller boundary.
- [ ] E.2.3 Keep `MixPlayerHost` and parser integration in
  `src/mix-player.ts` and `src/mix-parser.ts`. **Do not** import
  parser / player modules from render code.
- [ ] Verify after each: existing mix playback unit tests pass; add
  controller-only stop/play transition tests; Playwright covering mix
  selection, playback start / stop, and lane rendering still passes.

### E.3 Category and sample browser controller extraction

- [ ] E.3.1 Create `src/category-config-controller.ts`. Move category
  config watch / refresh / save logic behind it.
- [ ] E.3.2 Create `src/sample-browser-controller.ts`. Move
  filtering / search / sort / zoom wiring behind it.
- [ ] E.3.3 Leave `src/render/*.ts` as view helpers — no `Library` or
  filesystem awareness.
- [ ] Verify: focused tests for add / remove subcategory, refresh
  coalescing, save error handling, BPM filtering, search clear, zoom
  controls all pass.

### E.4 Bootstrap reduction and cleanup

- [ ] E.4.1 Shrink `src/main.ts` to app startup, top-level
  composition, and unload disposal only. Target ≤ 200 lines.
- [ ] E.4.2 Remove duplicate state plumbing and inline helpers left
  behind after extraction.
- [ ] Verify: full quality gate including
  `npm run test:coverage` (≥ 80% per cell on every reported file).

### E.5 Rollback plan

If the refactor destabilizes playback or browser startup:

1. Revert the controller extraction commit for the affected sub-phase
   only.
2. Keep pure-helper extractions already covered by passing tests.
3. Re-run targeted playback and browser tests before retrying the next
   slice.

### E.6 Risks

- Playback timing regressions if transport state and DOM updates are
  split without clear ownership.
- Hidden coupling between category refresh and current-tab selection
  may surface once logic moves out of `src/main.ts`.
- Browser coverage on `src/main.ts` may shift as guards move; monitor
  thresholds during each sub-phase.
- New browser runtime modules **must** be added to the include lists
  in [`vite.config.ts`](../vite.config.ts), [`.nycrc.json`](../.nycrc.json),
  and [`tsconfig.browser.json`](../tsconfig.browser.json).

---

## Out of scope

Tracked under future milestones:

- Mixer / effect parameter parity beyond the existing approximations
  (Milestone 4).
- Embedded HyperKit audio extraction (already covered by
  `npm run mix:extract-embedded`).
- Save-side support for `.mix` files (Milestone 4).
- External library catalogs (Milestone 5).

## Cross-references

- [`docs/mix-format-analysis.md`](mix-format-analysis.md) — on-disk
  layout, lane count table, parser status by field.
- [`docs/file-formats.md`](file-formats.md) — sample-id catalogs and
  channel mapping per product.
- [`scripts/mix-grid-analyzer.ts`](../scripts/mix-grid-analyzer.ts) —
  Format A grid analyzer source (emits summary artifacts when run).
- [`logs/mix-resolver-parity-baseline.json`](../logs/mix-resolver-parity-baseline.json)
  — current resolver parity.
- [`.github/instructions/quality-gate.instructions.md`](../.github/instructions/quality-gate.instructions.md)
  — checklist to run after every TS / Markdown edit.
