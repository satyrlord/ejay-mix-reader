# Milestone 3 — MIX Playback: Status & Remediation Plan

> Living document. Tracks what was actually built for Milestone 3 ("MIX
> Playback Support"), what is provably broken, and the analysis-first work
> needed before further code changes will produce correct results.

## 1. Where Milestone 3 stands today

The previous agent landed an end-to-end pipeline that is wired through but
under-analysed. Loading a `.mix` file in the dev server **does** produce
audible playback for some files, but the timeline is misinterpreted often
enough that the result cannot be trusted.

### 1.1 What is implemented

| Layer | File(s) | Status |
|-------|---------|--------|
| Format detection | [`src/mix-parser.ts`](../src/mix-parser.ts) `detectFormat` | Works. App-id whitelist + `#SKKENNUNG#` / `MixVolume` / `BOOU` string sniffing. |
| Format A parser | `parseFormatA` | Parses 8-col uint16 grid + header aux. **Boundary heuristic is broken** (see §2.1). |
| Format B parser | `parseFormatB`, `parseFormatBTracks` | Parses header, title, catalogs, ticker text, and emits track placements with `beat` and `channel`. **Channel mapping unverified** (see §2.2). |
| Format C parser | `parseFormatC`, `parseFormatCTracks` | Parses header / title / mixer KV / catalogs and walks `pxd32p?.tmp` temp-path pairs. **Always emits `beat: null`, `channel: null`** (see §2.3). |
| Format D parser | `parseFormatD`, `parseFormatDTracks` | Same as C plus drum-machine KV. **Same null beat/channel problem.** |
| Resolver | [`scripts/mix-resolver.ts`](../scripts/mix-resolver.ts), `data/index.json#sampleIndex` | Functional: looks up by product → catalog hint → fallback → `resolvedPath`. Coverage limited by `sampleIndex` entries. |
| Browser fetch | [`src/mix-file-browser.ts`](../src/mix-file-browser.ts) + Vite `/mix/<product>/<file>` route | Works in DEV and via FSA / `<input>` in PROD. |
| Playback plan | [`src/mix-player.ts`](../src/mix-player.ts) `buildMixPlaybackPlan` | Maps tracks → events keyed by `lane-<n>` or `track-<i>`. **`loopBeats = max(beat)+1` ignores the song's true length and the product lane count.** |
| Web Audio runtime | `src/mix-player.ts` graph helpers | Decodes WAVs on demand, schedules events, applies basic mixer/effects. Fine in isolation. |
| Sequencer UI | [`src/main.ts`](../src/main.ts) `renderMixPlan`, `src/render/home.ts` | **Renders only lanes that contain events.** A song using two lanes shows two rows even when its generation has 8/17/32 lanes. |
| Manifest / index build | `scripts/extract-mix-metadata.ts`, `scripts/build-index.ts` | Functional. `MixFileMeta` populated for every archive `.mix`. |

### 1.2 Symptoms the user is seeing

| Observation | Likely cause |
|-------------|--------------|
| Some Format A mixes (e.g. `THEFLOW.MIX`, `WELCOME.MIX`) render with **only 2 lanes** even though the product (Gen 1) has 8 lanes. | UI renders only event-bearing lanes (§3.5). The Format A grid scan itself is now deterministic (§2.1) so this is purely a UI concern. |
| Some mixes play as a "short one-shot". | `loopBeats = max(beat)+1` — when the parser only recovers a placement at beat 0, the loop is one beat long (§3.4). Affects every Format C / D mix because beat is always `null` → coerced to 0. |
| Other mixes play a longer song but with **misplaced sounds**. | Format B `channel` field is taken from `buf.at(offset)` immediately after the sample id — the byte's semantics are unverified, so samples land on the wrong row (§2.2). |
| Format C / D mixes (Dance 3+/HipHop 3+/Techno 3/Xtreme/HipHop 4/House) collapse to flat unordered samples. | `parseFormatCTracks` / `parseFormatDTracks` deliberately emit `beat: null, channel: null` — beat / lane fields have not yet been located in the binary (§2.3). 9 of 14 products affected. |

## 2. Root-cause analysis (binary side)

### 2.1 Format A — deterministic dual-grid layout (resolved)

The Format A binary layout is now fully deterministic and the parser no
longer relies on a zero-run heuristic for full-size files. As of the
April 2026 update, verified against the decompiled VB6 source and documented in
[`mix-format-analysis.md`](mix-format-analysis.md#format-a--gen-1-binary-grid-dual-8351-uint16-le-matrices):

- File layout is **`uint16 appSig` + Grid 1 (8×351 uint16 LE) + Grid 2
  (8×351 uint16 LE) + optional trailer**, totalling 11,234 grid bytes.
- Trailer presence is detected by reading `uint16 0x0A08` at the fixed
  offset `0x2BE2` (= 11,234), not by zero-run scanning.
- Grid 1 holds the placement IDs; Grid 2 is a sparse, small-valued
  per-cell duration/variant override surfaced on the IR as `formatAGrid2`
  (max ≤ 12 across all sampled mixes; `0` = natural length).
- `locateGridTrailer` is retained as a fallback only for short /
  synthetic test buffers below 11,234 bytes.

The earlier blocker described here ("first ≥ 32-byte zero run
short-circuits the grid scan") and its proposed footer-signature
workaround are no longer applicable. The corpus this section originally
referenced included Dance SuperPack and Generation Pack 1 mixes; both
folders were removed during the April 2026 archive cleanup.

### 2.2 Format B — channel byte is a guess

`parseFormatBTracks`:

```ts
const sampleId = buf.readUInt16LE(offset); offset += 2;
const channelByte = buf.at(offset); offset += 2;   // <-- this byte is unverified
```

The byte is consumed as `track.channel` and surfaces in the UI as
`lane-<channelByte>`. We have no published evidence that this byte is the
channel index. Gen 2 has **17 lanes (16 + user percussion)**, so valid lane
indices are `0..16`; values outside that range almost certainly mean the
field is something else (record flags, sub-record length, audio format
discriminator, …).

**Right fix**: enumerate this byte across the entire Gen 2 corpus
(`Dance 2`, `Techno`, `HipHop 2`), correlate with sample category from the
catalog, and confirm against the `seiten` Soundgruppe table:

- Dance 2 channels: loop, drum, bass, guitar, sequence, layer, rap, voice,
  effect, xtra, groove, wave (12 distinct names but the UI hosts 16
  normal lanes plus 1 user lane).
- HipHop 2: loop, drum, bass, guitar, sequence, layer, scratch, voice,
  effect, xtra.

If the byte is the lane index, sample-category histograms per byte value
should mirror the `seiten` channel names. If it is not, the lane index is
elsewhere in the record (candidates: the second `0x01` tag region, the
unknown 2-byte field after `channelByte`, or implied by the position of the
record relative to per-lane segment markers in the file).

### 2.3 Format C / D — beat & channel never recovered

`parseFormatCTracks` and `parseFormatDTracks` walk `pxd32p?.tmp` temp-path
pairs and produce one placement per sample reference, with
`beat: null, channel: null`. Comments in the source acknowledge this.

This is the **largest blocker** for Milestone 3: 9 of 14 products use
Format C or D. Without timeline recovery, every Gen 3+ mix becomes a
one-shot list.

**Right fix** is a dedicated reverse-engineering pass:

1. Pick a Gen 3 reference file with a known visual layout
   (`archive/Dance_eJay3/Mix/start.mix` is the canonical "demo mix"; its
   layout is also reproducible by loading it in the original eJay 3 binary
   inside a VM if we need ground truth).
2. Map each `pxd32p?.tmp` record start in the file. The ordered set of
   record offsets is already known.
3. Diff records that share a sample but differ in lane / beat to isolate
   which uint8/uint16 fields change in lockstep with each axis.
4. Validate against the analyzer summary (`output/mix-grid-summary.json`
   does not yet cover Gen 3 — extend it).
5. Also examine the "Binary metadata (offset/size related)" 2-byte field
   currently labelled `unknown` at the head of each record, the
   `unresolvedLaneCode` already exposed by `parseFormatCTrackRecord`, and
   the gap between the right temp path and the next record (which may
   carry positional padding).

Until that work is done, every Gen 3 placement should be flagged
`positionKnown: false` in `MixIR.tracks` and surfaced in the UI as a flat
"Sample list" view rather than mounted on the sequencer grid.

## 3. Root-cause analysis (player / UI side)

### 3.1 Lane count comes from events, not from generation

`renderMixPlan` builds its lane map by iterating over events:

```ts
const lanes = new Map<string, MixPlaybackPlan["events"]>();
for (const event of plan.events) { /* group by event.channelId */ }
```

Lanes that never receive an event are never created, so a 2-event mix
renders as 2 lanes regardless of generation. This is the proximate cause
of the "16-lane song shows as 2 lanes" symptom in screenshots.

**Right fix**: the playback plan must carry the canonical lane count for
its generation:

- Gen 1 (Format A, app-id `0x0A06/0A07/0A08`): 8 lanes.
- Gen 2 (Format B): 17 lanes (16 standard + 1 user-percussion).
- Gen 3+ (Format C/D): 32 lanes baseline; HipHop 4 / House additionally
  expose 49 / 25 mixer tracks but the **timeline** stays at 32 visible rows.

Add `MixPlaybackPlan.lanes: { id: string; index: number; label: string }[]`
populated from a `lanesForFormat(format, product)` helper. The renderer
iterates this list and places events into rows by `channelId` — empty
lanes still render. See §4.4.

### 3.2 `loopBeats` is degenerate

`loopBeats = Math.max(1, maxBeat + 1)` collapses to `1` whenever every
event sits at beat 0 (the entire Format C / D corpus today). The transport
loops every 1 beat, which the user perceives as a one-shot.

The true song length depends on the format:

- Format A: number of grid rows scanned (after the §2.1 fix).
- Format B: there is a per-mix beat count in the header / catalog area
  that we have not extracted. Until then, fall back to
  `max(track.beat over all placements) + 1` rounded up to the next bar.
- Format C / D: unknown until §2.3 is done. Until then, render as a flat
  sample list — do **not** schedule a transport loop.

### 3.3 No "song length is unknown" UI state

The transport currently always loops and always shows a beat counter.
There is no way to communicate "we parsed this file but the timeline is
not yet recoverable". Add a "List view (timeline unrecovered)" badge for
mixes with `MixIR.tracks.every(t => t.beat === null)`.

### 3.4 Ordering of follow-up work

A meaningful UI cannot be built until the parser gives it correct
positional data. Order matters:

1. Fix Format A trailer detection — unblocks the entire Gen 1 corpus.
2. Validate / correct Format B channel byte and locate the song's beat
   count.
3. Reverse-engineer Format C / D beat and channel.
4. Plumb the corrected fields through `MixIR` → `MixPlaybackPlan` → the
   renderer, including the canonical lane count.
5. Add fallback "list view" for mixes whose timeline cannot be recovered.

## 4. Action items

> Items are sized so each maps to a focused PR. None of them require new
> dependencies. All scripts run via `tsx`.

### 4.1 Format A trailer detection (resolved)

Resolved by switching to the deterministic 11,234-byte dual-grid layout
plus a `uint16 0x0A08` trailer marker at offset `0x2BE2`. See §2.1 and
[`mix-format-analysis.md`](mix-format-analysis.md#format-a--gen-1-binary-grid-dual-8351-uint16-le-matrices).
No further action required; the legacy zero-run heuristic remains in
`locateGridTrailer` only as a fallback for short / synthetic buffers
below 11,234 bytes.

### 4.2 Format B channel byte verification

- **Where**: new `scripts/mix-format-b-channels.ts` analyzer, then
  `parseFormatBTracks` once findings are validated.
- **Do**:
  - Print `(channelByte, sampleId, resolvedCategory)` for every track
    record across all Gen 2 mixes.
  - Cross-tabulate against the `seiten` Soundgruppe table; reject the
    "channel" hypothesis if a single byte value spans more than one
    catalog category (e.g. drum and voice).
  - If the hypothesis fails, scan adjacent fields and per-lane segment
    markers for a better candidate.
- **Acceptance**: a single-page write-up in `docs/mix-format-analysis.md`
  ("Format B Channel Field — Resolved") backed by the analyzer output;
  parser updated; `mix-golden` fixtures regenerated for Gen 2.

### 4.3 Format C / D beat & channel reverse-engineering

- **Where**: new `scripts/mix-format-cd-records.ts`; eventual updates to
  `parseFormatCTrackRecord` / `parseFormatDTracks`.
- **Do**:
  - Dump every Format C / D track record as labelled hex (record start,
    name field, lane code, unknown 32-bit, data length, left/right paths,
    trailing bytes up to the next record).
  - Group by sample reused across multiple placements within a single
    file and look for the smallest changing field.
  - Record findings under a new "Format C / D Track Records — Recovered
    Fields" section in `docs/mix-format-analysis.md`.
- **Acceptance**: at least 80 % of Format C records in `Dance_eJay3` and
  `Techno_eJay3` produce a non-null `beat` and `channel`; fall back to
  list view for the remainder.

### 4.4 Lane count from generation, not from events

- **Where**: `src/mix-player.ts`, `src/main.ts::renderMixPlan`,
  `src/__tests__/mix-player.test.ts`.
- **Do**:
  - Add a `lanesForFormat(mix: MixIR): LaneDescriptor[]` helper using:
    Gen 1 = 8, Gen 2 = 17 (label the 17th "User Perc."), Gen 3+ = 32.
  - Surface that list as `MixPlaybackPlan.lanes`.
  - In `renderMixPlan`, iterate `plan.lanes` (not the event map) so empty
    lanes render as empty rows.
  - Update existing snapshot / unit tests; expect more lanes in fixtures
    that previously asserted only event-bearing rows.
- **Acceptance**: loading any Gen 1 mix shows 8 lane rows; any Gen 2 mix
  shows 17; any Gen 3+ mix shows 32 — even when only a subset carries
  events.

### 4.5 Honest `loopBeats`

- **Where**: `src/mix-player.ts::buildMixPlaybackPlan`,
  `src/main.ts` transport.
- **Do**:
  - Change `loopBeats` to `null | number`. `null` ⇒ list view, no
    transport loop.
  - Format A: derive from grid row count (after §4.1).
  - Format B: derive from header / catalog beat count once §4.2 is done;
    otherwise from `max(beat) + 1` rounded up to the next bar (4 beats).
  - Format C / D: `null` until §4.3 is done.
- **Acceptance**: no mix renders as a 1-beat loop unless the source
  genuinely has only one beat.

### 4.6 Diagnostics

- **Where**: `src/mix-file-browser.ts` tooltip / metadata popup,
  `logs/mix-playback-performance-baseline.json`.
- **Do**:
  - Surface `format`, `lanes`, `beats`, `resolved/total events`, and
    "timeline recovered / list view only" in the popup.
  - Regenerate the perf baseline once §4.1–§4.5 land so future regressions
    are visible.

## 5. Out of scope for Milestone 3

- Mixer / effect parameter parity beyond what the existing graph already
  approximates. Tracked by Milestone 4.
- Embedded HyperKit audio extraction (already covered by
  `npm run mix:extract-embedded`).
- Save-side support for `.mix` (Milestone 4).
- External library catalogs (Milestone 5).

## 6. Cross-references

- [`docs/mix-format-analysis.md`](mix-format-analysis.md) — on-disk layout,
  lane count table, parser status by field.
- [`docs/file-formats.md`](file-formats.md) — sample-id catalogs and
  channel mapping per product.
- `output/mix-grid-summary.json` — Format A grid analyzer output.
- `logs/mix-resolver-parity-baseline.json` — current resolver parity.
- `logs/mix-playback-performance-baseline.json` — current playback perf.
