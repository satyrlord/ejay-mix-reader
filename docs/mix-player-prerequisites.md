# MIX Player — Prerequisites

Ordered list of features, tools, and research tasks required before building
an accurate `.mix` playback engine. Each item is either a **blocker** (must
complete first) or a **dependency** (needed by later prerequisites).

See [mix-format-analysis.md](mix-format-analysis.md) for the full format
reverse-engineering notes this list derives from. This document is the
**implementation roadmap**; the analysis doc is the **format reference**.
If the two disagree, this roadmap wins and the analysis doc should be
updated.

---

## 1. Resolve Gen 1 Sample ID Mapping — **COMPLETE** ✅

Format A `.mix` files contain raw sample IDs with no text labels. Verified
that every Gen 1 product ships a plain-text `MAX` (or `MAX.TXT`) catalog
where **line number N is sample ID N** — a direct lookup, not the
hypothesised `bank_index × bank_size + file_index` formula.

**Outcome:**

- Parser `tools/gen1-catalog.ts` handles both quoted (Dance / SuperPack /
  GP1-Dance) and unquoted (Rave / GP1-Rave / GP1-HipHop) dialects; 30 unit
  tests including live-archive spot checks.
- Per-product JSON catalogs written to
  `output/<product>/gen1-catalog.json` for Dance eJay 1, Dance SuperPack,
  Rave, and all three GenerationPack 1 variants (13,914 total entries,
  13,913 populated — one blank slot in both Rave MAX copies).
- Pxddance enrichment (SuperPack / GP1-Dance) and PXD.TXT channel-range
  fallback (Dance eJay 1) supply `category` / `group` / `version` metadata.
- Full layout and parser usage documented in
  [file-formats.md — Gen 1 Sample-ID Catalogs](file-formats.md#gen-1-sample-id-catalogs-max-pxddance-pxdtxt).

**Follow-up (addressed in prerequisite 2):**

- The uint8-cell hypothesis for Rave / GP1-HipHop was refuted by the
  Prereq 2 grid analyzer — all Gen 1 products use uint16 LE cells; the
  earlier "max id ≈ 254" observation came from reading ASCII trailer
  bytes as cells.
- Dance eJay 1 `.mix` files reference IDs up to ~1,989, exceeding the
  Dance 1 MAX catalog (1,352). The resolver (prerequisite 5) must fall
  back to the SuperPack MAX (2,845).

---

## 2. Verify Format A Grid Dimensions — **COMPLETE** ✅

The 16-byte row width (8 × `uint16`) and the 4-byte header were
confirmed empirically across 83 Gen 1 `.mix` files (every `.mix` under
`Dance_eJay1`, `Dance_SuperPack`, `Rave`, and the three GenerationPack 1
directories) by [`tools/mix-grid-analyzer.ts`](../tools/mix-grid-analyzer.ts).

**Outcome:**

- `tools/mix-grid-analyzer.ts` (27 unit tests, 99% stmt / 98% branch
  coverage) parses the Format A header (uint16 app sig at `0x00`,
  uint16 aux at `0x02`), locates the grid / trailer boundary via a
  forward scan for the first ≥ 32-byte zero run, extracts uint16 LE
  sample IDs with row/column coordinates, and exposes the trailer
  bytes / ASCII strings.
- Aggregate report is committed to `output/mix-grid-summary.json`
  (regenerate with `npx tsx tools/mix-grid-analyzer.ts --all --out
  output/mix-grid-summary.json`).
- **Cell width is uint16 LE for every Gen 1 product.** The previous
  uint8 hypothesis for Rave / HipHop was refuted — the high u16 values
  (e.g. 25974, 28783) came from ASCII trailer bytes (`"ve"`, `"op"`)
  being misread as grid cells. With the forward-scan gridEnd detection
  these disappear from the cell set entirely.
- **Row count varies per song** (20–227 rows observed); the earlier
  "~83 rows" figure was an artefact of `Dance 1 START.MIX` being a
  short demo. Full profile in the `activeRowCount` column of
  `output/mix-grid-summary.json`.
- **Trailer block characterised** — ~70 % of Gen 1 mixes carry a
  structured trailer after the zero gap containing a product
  signature (`"Dance eJay 1.01"`, `"Rave eJay 1.01"`,
  `"HipHop eJay 1.01"`), a sample-pack label (`"DanceMachine
  Sample-Kit Vol. 2"`, `"gung -SAMPLE BOX- [Space Sounds]"`),
  occasionally a user-imported WAV path
  (`c:\raveejay\hypersav\scool004.wav` in Rave `NODRUGS.MIX`), and
  always the 8-byte `01 00 00 08 00 01 00 02` terminator.
- **Rave HyperKit (`c:\raveejay\hypersav\*.wav`)** — These are **user-
  recorded sounds**, not a commercial sample kit. The `.mix` player
  should treat any `hypersav` path reference as an unresolvable user
  sample and silently skip it (log a warning, play silence for that
  cell). Do not attempt to locate or substitute these files.
- **SuperPack `dream.mix`** (11,413 bytes) is NOT a Format A variant
  with an appended catalog; it is Format A with a longer trailer. All
  file-size variation (11,234 / 11,277 / 11,326 / 11,333 / 11,413) is
  accounted for by different trailer lengths.

Full layout and verification details live in
[mix-format-analysis.md — Format A](mix-format-analysis.md#format-a--gen-1-binary-grid-no-header).

**Follow-ups (deferred):**

- **Column-to-channel assignment** (which of the 8 columns corresponds
  to loop / drum / bass / …) cannot be derived from the binary alone.
  Needs either cross-referencing each cell's column with the PXD.TXT /
  Pxddance category of its resolved sample, or observing the original
  engine at playback time. Deferred to prerequisites 5 (resolver) and
  8 (player prototype).
- **HipHop / SuperPack ID overflow** — GP1-HipHop mixes cite ids up to
  2071 (catalog size 1381); SuperPack `softvox.mix` cites ids up to
  4727 (catalog size 2845). Rebuilt raw extraction disproves the
  simple "extra raw files" explanation: GP1-HipHop MAX already covers
  1341 `.pxd` entries plus 40 `H1SC###.wav` scratch entries, the
  `SCRATCH` catalog aliases those same physical files, and the only
  separate GP1 bank beyond MAX is `Special/` (101 WAVs). Overflow also
  appears across the full row range in representative files, not just
  late rows. Prerequisite 5 still needs a second catalog or remapping
  hypothesis.
  - **Update:** The missing expansion kits that supply the overflow IDs
    are now represented in the workspace as:
    - `archive/Dance_SuperPack/eJay SampleKit/DMKIT1/` — DanceMachine
      Sample-Kit Vol. 1 (= gung SAMPLE BOX 1) source installer content;
      extracted output lives under `output/SampleKit_DMKIT1/`.
    - `archive/Dance_SuperPack/eJay SampleKit/DMKIT2/` — DanceMachine
      Sample-Kit Vol. 2 (= gung SAMPLE BOX 2) source installer content;
      extracted output lives under `output/SampleKit_DMKIT2/`.
    - `output/SampleKit_DMKIT3/` — gung SAMPLE BOX Space Sounds, staged as
      417 playback-ready WAV files in 4 channel folders (FX, Keys,
      Spaceships, Xtra).
    The resolver must build a combined catalog by appending each kit's
    sample list after the base product MAX to cover the overflow range.
- **`headerAux` (uint16 at `0x02`) semantics** — zero in most files,
  non-zero and file-specific otherwise. Candidate interpretations
  (checksum, sub-variant id, implicit BPM override) to be revisited by
  prerequisite 3 (binary parser).
- **Dance 1 → SuperPack fallback** — Dance eJay 1 mixes cite IDs up to
  ~1,989, exceeding the Dance 1 MAX catalog (1,352). The resolver
  (prerequisite 5) must fall back to the SuperPack MAX (2,845) for
  Dance 1 playback.

---

## 3. Build a MIX Binary Parser (`tools/mix-parser.ts`) — **COMPLETE** ✅

`tools/mix-parser.ts` now parses all four `.mix` format families into the
shared MixIR shape and exposes both a reusable API and a CLI.

**Outcome:**

- Format auto-detection is implemented via the Gen 1 app signatures
  (`0x0A06`–`0x0A08`) plus `#SKKENNUNG#` / mixer-marker detection for
  Formats B/C/D.
- `parseFormatA()` reads the Gen 1 binary grid, applies the verified
  4-byte header + 16-byte row layout, and skips trailer bytes after the
  first ≥ 32-byte zero gap.
- `parseFormatB()` handles the shared Gen 2 header, title section,
  catalog block, variable-length track records with internal PXD names,
  and ticker-text extraction.
- `parseFormatC()` handles the shared Gen 3 header, `#°_#...%°_%` mixer
  state block, early Gen 3 placement records across both temp-path
  dialects (`C:\WINDOWS\TEMP\...` and the `DOKUME~1\...\Temp\...`
  variant), and strips the Xtreme-specific `VideoMix` payload so the
  parser stays audio-only.
- `parseFormatD()` extends the Gen 3 parser with full late-mixer state,
  drum machine pad/effects extraction, and length-prefixed path-pair
  placement parsing.
- The parser skips `.mix` files smaller than 4 bytes, covering the
  2-byte `archive/Dance_eJay4/Mix/.mix` placeholder.
- Convenience entry points are in place for `detectFormat()`, `parseMix()`,
  `parseFile()`, `listMixFiles()`, and the CLI `main()` entry.
- `tools/__tests__/mix-parser.test.ts` now covers helper behavior,
  synthetic edge cases, CLI branches, and live archive fixtures for
  Format A (`Dance_eJay1/MIX/START.MIX`), Format B
  (`Dance_eJay2/MIX/STEP.MIX`), multiple Format C dialects
  (`Dance_eJay3/MIX/start.mix`, `HipHop 3/MIX/start.mix`,
  `Xtreme_eJay/mix/start.mix` as an audio-only/no-track case), and Format D
  (`HipHop 4/MIX/start.mix`).
- Full unit coverage currently reports `mix-parser.ts` at 92.70% statements,
  81.86% branches, 100% functions, and 97.52% lines, with the repository-wide
  unit coverage gate passing.

**Known caveats:**

- Format C/D placement records now emit stable placement counts and display
  names where present, but some low-level numeric fields in Gen 3 track
  records remain only partially understood. In particular, late Gen 3 files
  do not currently yield reliable per-placement display aliases. Xtreme's
  `VideoMix` payload is now intentionally ignored because the player only
  renders audio.

**Depends on:** prerequisites 1, 2 (Format A needs the ID mapping and grid
dimensions).

---

## 4. Define the MixIR TypeScript Schema (blocker)

A shared set of TypeScript interfaces that all parsers emit and the player
consumes. Must be importable from both `tools/` and `src/`.

**Tasks:**

- Define `MixIR`, `TrackPlacement`, `SampleRef`, `MixerState`,
  `ChannelState`, `CompressorState`, `DrumMachineState`, `DrumPad`,
  `DrumEffectsChain`, and `CatalogEntry` interfaces (see
  [mix-format-analysis.md](mix-format-analysis.md) for the full schema).
- Place in a shared location (e.g., `src/mix-types.ts` or
  `tools/mix-types.ts` with a `src/` re-export).
- Ensure the schema covers all four formats without format-specific
  sub-types — one unified IR.

**Depends on:** nothing (can be done in parallel with prerequisite 1).

---

## 5. Build a Sample Resolution Layer (`tools/mix-resolver.ts`) (blocker)

Maps each `SampleRef` in a parsed MixIR to an actual WAV file path under
`output/`.

**Tasks:**

- **Gen 1 resolver:** Use the ID→WAV lookup table from prerequisite 1.
- **Gen 2 resolver:** Match track entry PXD filenames (e.g., `humn.9`)
  against `metadata.json[].source` internal filenames.
- **Gen 3 resolver:** Match display names (e.g., `kick28`) against
  `metadata.json[].alias`. Handle case-insensitive and partial matches.
- **Cross-product resolution:** Parse the MixIR `catalogs` array to
  determine which products are referenced. Search across multiple
  `output/*/metadata.json` files.
- **Missing sample fallback:** Log a warning and set `resolvedPath: null`
  for samples that cannot be found. Never crash on unresolved refs.
- Extend `data/index.json` and `scripts/build-index.ts` with a per-product
  sample lookup index keyed by alias, ID, and internal name for fast
  resolution.

**Depends on:** prerequisites 1, 3, 4.

---

## 6. Extend `data/index.json` with MIX File Inventory (dependency)

The build index currently lists products and their sample counts. It needs
to also list available `.mix` files per product so the browser UI can offer
a mix file picker.

**Tasks:**

- Update `scripts/build-index.ts` to scan `archive/*/MIX/` (and case
  variants `Mix/`, `mix/`) for `.mix` files.
- Add a `mixes` array to each product entry in `data/index.json` with
  fields: `filename`, `sizeBytes`, `format` (A/B/C/D).
- Filter out empty/invalid files (< 4 bytes).
- Run `npm run build` to regenerate the index.

**Depends on:** prerequisite 3 (needs the parser for format detection).

---

## 7. Serve MIX Files via Vite Dev Server (dependency)

The browser playback engine needs to `fetch()` raw `.mix` files from the
archive at runtime.

**Tasks:**

- Expose only the `archive/*/MIX/` (and case-variant `Mix/`, `mix/`)
  folders as static assets in `vite.config.ts`. **Do not serve the full
  `archive/` tree** — PXD/INF/DLL content is read-only source data that
  should not leak through the dev server.
- Ensure the MIME type is `application/octet-stream` for `.mix` files.
- For production (`npm run build`) decide whether `.mix` files are
  bundled into `dist/` or fetched from a separate asset path; document
  the choice in `architecture-notes.md`.
- Verify with a `fetch()` from the dev server that a known `.mix` file is
  downloadable and byte-identical to the source.

**Depends on:** nothing (infrastructure task).

---

## 8. Web Audio API Playback Prototype (dependency)

A minimal proof-of-concept that loads WAV samples and plays them on a
beat-synced timeline. This validates the core scheduling approach before
adding full MixIR support.

**Tasks:**

- Create `src/mix-player.ts` with an `AudioContext`, sample preloading
  via `fetch()` + `decodeAudioData()`, and `AudioBufferSourceNode.start(when)`
  scheduling.
- Implement a basic transport: play, pause, stop, seek-to-beat.
- Verify beat-accurate playback at 140 BPM with a simple 4-beat loop of
  known WAV files (manual test, no MixIR needed yet).
- Add the file to `vite.config.ts`, `.nycrc.json`, and
  `tsconfig.browser.json` per project conventions.

**Depends on:** nothing (can prototype independently).

---

## 9. Per-Channel Mixer Routing (dependency)

Each timeline track needs its own volume and pan control routed through
Web Audio nodes.

**Tasks:**

- Per-channel graph: `AudioBufferSourceNode` → `GainNode` (volume) →
  `StereoPannerNode` (pan) → master `GainNode` →
  `AudioContext.destination`.
- Map BOOU/MixVolume values to gain (normalise product-specific ranges
  to 0.0–1.0).
- Map pan values (0–100 in MixIR) to StereoPannerNode range (-1.0–1.0).
- Implement mute (gain = 0) and solo (mute all non-solo channels).

**Depends on:** prerequisites 4, 8.

---

## 10. Drum Machine Playback (Format D only) (dependency)

HipHop 4 (16 pads) and House (10 pads) mixes include per-pad sample state
that needs its own trigger path.

**Tasks:**

- Load drum pad samples by resolving `DrumName{N}` references via the
  sample resolver.
- Apply per-pad `playbackRate` for pitch shift (semitone → rate
  conversion: `rate = 2^(semitones / 12)`).
- Pre-reverse `AudioBuffer` data for pads with `DrumReverse = active`.
- Route each pad through its own gain/pan chain.
- Schedule drum hits at the correct beat positions on the timeline.

**Depends on:** prerequisites 5, 8, 9.

---

## 11. Effects Chain Implementation (progressive, not blocking)

Effects are enhancement features. Implement in priority order after core
playback works. Each effect can be added independently.

| Priority | Effect | Web Audio Approach |
|----------|--------|--------------------|
| P4 | Compressor | `DynamicsCompressorNode` (built-in) |
| P4 | Echo/Delay | `DelayNode` + `GainNode` feedback loop |
| P4 | Reverb | `ConvolverNode` with synthetic impulse response |
| P5 | Overdrive | `WaveShaperNode` + `BiquadFilterNode` |
| P5 | 10-band EQ | Bank of `BiquadFilterNode`s (peaking type) |
| P5 | Chorus | `OscillatorNode`-modulated `DelayNode` |
| P5 | Mid-sweep | Swept `BiquadFilterNode` (bandpass) |
| P6 | Harmonizer | Pitch-shifted parallel `AudioBufferSourceNode`s |
| P6 | Vocoder | `AnalyserNode` + filter bank (very complex) |

**Depends on:** prerequisites 8, 9 (need working audio graph first).

---

## 12. MIX File Picker UI Component (dependency)

The browser needs a way to select and load a `.mix` file for playback.

**Tasks:**

- Add a product-scoped mix file selector to the Sound Browser UI.
- Fetch the selected `.mix` file as an `ArrayBuffer`.
- Pass the buffer through the parser → resolver → player pipeline.
- Display the mix title, author, and BPM from the MixIR.
- Show a transport bar (play/pause/stop, beat position, total beats).

**Depends on:** prerequisites 3, 5, 6, 8.

---

## 13. Playback Validation Test Suite (dependency)

End-to-end tests that verify parsed mixes produce correct playback timing
and sample selection. Individual parsers/resolvers already ship unit tests
in their own prerequisites (3, 5); this step adds integration coverage.

**Tasks:**

- Playwright integration tests that load a `.mix` file in the browser,
  verify the AudioContext is created, and check that the correct number
  of samples are scheduled within a bounded time window.
- Golden-file tests: snapshot the parsed MixIR for one reference mix per
  format (A/B/C/D) and diff on future parser changes.
- Add `tests/mix-playback.spec.ts`.
- Maintain ≥ 80% coverage on all new files per the quality gate.

**Depends on:** prerequisites 3, 5, 8.

---

## Dependency Graph

```text
1. Gen 1 ID Mapping ──────┐
                           ├─► 2. Grid Dimensions ──┐
                           │                         ├─► 3. MIX Parser ──┐
4. MixIR Schema ───────────┤                         │                   │
                           ├─────────────────────────┘                   │
                           │                                             │
                           └─► 5. Sample Resolver ◄──────────────────────┘
                                       │
7. Serve MIX via Vite ────┐            │
                          ├─► 6. Index Extension
                          │            │
8. Audio Prototype ───────┤            │
         │                ├─► 12. File Picker UI
         │                │            │
         ├─► 9. Mixer ────┤            │
         │        │       └─► 13. Test Suite
         │        │
         │        └─► 10. Drum Machine
         │
         └─► 11. Effects Chain (progressive)
```

---

## Recommended Build Order

| Phase | Prerequisites | Outcome |
|-------|---------------|---------|
| **Research** | 1, 2 | Gen 1 sample mapping confirmed, grid layout locked |
| **Schema** | 4 | Shared MixIR types available for all code |
| **Parsers** | 3 | All 231 `.mix` files parseable to MixIR |
| **Resolution** | 5, 6 | Every sample ref maps to an output WAV |
| **Prototype** | 7, 8 | Beat-synced WAV playback in browser |
| **Mixer** | 9, 10 | Volume, pan, mute, solo, drum pads working |
| **Polish** | 11, 12, 13 | Effects, UI, automated validation |
