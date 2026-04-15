# MIX Player — Prerequisites

Ordered list of features, tools, and research tasks required before building
an accurate `.mix` playback engine. Each item is either a **blocker** (must
complete first) or a **dependency** (needed by later prerequisites).

See [mix-format-analysis.md](mix-format-analysis.md) for the full format
reverse-engineering notes this list derives from.

---

## 1. Resolve Gen 1 Sample ID Mapping (blocker)

Format A `.mix` files contain raw `uint16` sample IDs with no text labels.
Without a verified ID→WAV lookup table, Gen 1 mixes (Dance 1, Rave, HipHop 1,
SuperPack, Generation Pack 1) cannot be played.

**Tasks:**

- Enumerate every PXD file across all Gen 1 bank directories (AA–BW) for
  each product, recording `(bank, filename, position)` tuples.
- Parse the Pxddance binary catalog
  (`archive/Dance_SuperPack/dance/EJAY/Pxddance`) to extract the official
  `sample_id → (bank, file, category, alias)` mapping.
- Cross-reference the mapping against IDs found in Dance 1 `START.MIX` and
  verify the decoded grid produces recognizable audio.
- Determine whether Rave and HipHop 1 use the same ID scheme or a
  product-specific variant.
- Document the confirmed formula (likely
  `sample_id = bank_index × bank_size + file_index`) in `file-formats.md`.

**Depends on:** nothing (first task).

---

## 2. Verify Format A Grid Dimensions (blocker)

The 16-byte row width (8 × `uint16`) is empirically derived from `0xCF04`
spacing analysis. The total number of columns (channels) and rows (beats)
must be confirmed before playback timing is correct.

**Tasks:**

- Compute expected row count from known song length: Dance 1 demo ≈ 35
  seconds at 140 BPM = ~82 beats. Compare against active data extent
  (`0x052D` ÷ 16 bytes/row = ~83 rows). Confirm alignment.
- Determine column-to-channel assignment (e.g., column 0 = loop,
  column 1 = drum, ...). Cross-reference with the 8-channel layouts in
  `seiten` files and the Pxddance catalog categories.
- Test with at least 3 products (Dance 1, Rave, HipHop 1) to confirm the
  grid layout is consistent across Gen 1.
- Investigate SuperPack Dream.mix (11,413 bytes vs 11,234 standard) for a
  possible Format A variant with an appended catalog section.

**Depends on:** prerequisite 1 (need ID→WAV mapping to verify decoded audio).

---

## 3. Build a MIX Binary Parser (`tools/mix-parser.ts`) (blocker)

A single CLI tool that reads any `.mix` file and emits a normalised MixIR
JSON object. Must handle all four format families.

**Tasks:**

- Implement format auto-detection: read `uint32 LE` at offset 0 for Gen 1
  IDs (`0x0A06`–`0x0A08`), then scan for `#SKKENNUNG#` and `MixVolume`/`BOOU`
  to distinguish B/C/D.
- Write `parseFormatA(buf, productHint)` — binary grid parser with product
  hint for implicit BPM and channel count.
- Write `parseFormatB(buf)` — header + `0x01` tag sections + catalog +
  variable-length track records with PXD filenames.
- Write `parseFormatC(buf)` — extend B with `#°_#...%°_%` mixer state text
  parser (BOOU, DrumEQ, FX controls).
- Write `parseFormatD(buf)` — extend C with full mixer state (MixVolume,
  MixPan, MixMute, MixSolo, MixRec arrays) and drum machine pad state
  (DrumName, DrumVolume, DrumPan, DrumPitch, DrumReverse, DrumFX).
- Skip 2-byte empty files (Dance 4 `.mix`).
- Unit tests against known reference files (STEP.MIX for B, start.mix for
  C/D, START.MIX for A).

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

- Add `archive/` as a static asset directory in `vite.config.ts` (or a
  subset containing only `MIX/` folders) so `.mix` files are accessible
  via HTTP.
- Ensure the MIME type is set to `application/octet-stream` for `.mix`
  files.
- Verify with a curl/fetch test that a known `.mix` file is downloadable
  from the dev server.

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

Automated tests to verify that parsed mixes produce correct playback
timing and sample selection.

**Tasks:**

- Unit tests for each parser (A/B/C/D) against known reference `.mix`
  files, asserting correct BPM, track count, sample references, and
  mixer state values.
- Unit tests for the sample resolver, verifying that known display names
  and IDs resolve to existing WAV files.
- Playwright integration tests that load a `.mix` file in the browser,
  verify the AudioContext is created, and check that the correct number
  of samples are scheduled.
- Add `tools/__tests__/mix-parser.test.ts` and
  `tests/mix-playback.spec.ts`.
- Maintain ≥ 80% coverage on all new files per project conventions.

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
