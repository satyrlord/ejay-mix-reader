# Sequence-vs-Keys Classification Plan

Follow-up work to refine the `Keys` and `Sequence` categories produced by
[`tools/normalize.ts`](../tools/normalize.ts). In the initial normalize pass
every plucked-or-arp sample is routed to `Keys` and `Sequence/` is left empty.
This document describes how to migrate loop-intended arps and sequences out of
`Keys` into `Sequence` using PCM analysis.

## Goal

Distinguish:

- **Keys** — one-shot plucked instruments (piano stabs, organ chords, synth
  plucks). One audible attack followed by a decay.
- **Sequence** — loop-intended arpeggios, riffs, and sequenced patterns.
  Multiple attacks, tempo-aligned length, seamless head-to-tail loopability.

## Decision stack

Apply gates in this order. A sample is promoted from `Keys` to `Sequence`
only when the recommended combined rule fires.

> **Recommended rule:** `(B) AND ((C) OR (D))`
>
> Use tempo-aligned duration as the primary gate, then require either
> multiple transients or clean loopability to promote to `Sequence`. Fall back
> to `Keys` when in doubt — it is easy to post-hoc move a pluck out of `Keys`,
> harder to explain why an arp landed there.

### Gate A — Duration threshold (cheap first-pass, informational only)

One-shots are typically 0.2–1.5 s. Sequences and arps tend to run ≥ 2 s. Read
the WAV header and compute
`duration = dataSize / (sampleRate * channels * bytesPerSample)`.

- `duration < 1.8 s` — almost certainly a one-shot.
- `duration ≥ 1.8 s` — candidate. Does **not** on its own promote to
  `Sequence`; sustained pads and long-release plucks would be misclassified.

Gate A is used as a cache field only, not as a promotion signal.

### Gate B — Tempo-locked length (primary gate)

eJay samples are nearly always cut to an integer number of bars at the
product's default BPM. Compute `beats = duration * BPM / 60` and check whether
it lands within ±2 % of `{4, 8, 16, 32}`.

- **Requires a BPM table** keyed by product. Approx. 20 products. Place it
  next to `CHANNEL_MAP` in a new `tools/product-bpm.ts` (or inline in
  `tools/normalize.ts` if small). Seed defaults from the tempo fields already
  surfaced in `output/mix-grid-summary.json`.
- **Pass:** `beats ∈ {4, 8, 16, 32}` within tolerance. This is the hard gate
  for `Sequence` promotion.
- **Fail:** keep the sample in `Keys`.

### Gate C — Transient count

Count attack transients inside the sample to catch the "long plucky chord
stab" case that gate B would admit but that is not actually a sequence.

Algorithm:

1. Decode PCM to mono float in `[-1, 1]`.
2. Take the absolute value and RMS-average over ~10 ms windows.
3. Mark a transient wherever the envelope rises above `mean * 3` after being
   below `mean * 1.5`.
4. Count distinct transients separated by at least ~80 ms.

Interpretation:

- `transients == 1` → pluck / one-shot → stay in `Keys`.
- `transients ≥ 3` → arp / sequence → eligible for `Sequence`.
- `transients == 2` → ambiguous, defer to gate D.

### Gate D — Loopability

Check whether the sample is designed to loop seamlessly.

- Compare the first ~50 ms and last ~50 ms PCM windows using cross-correlation
  **or** an RMS + zero-crossing-parity check.
- `head ≈ tail` → clean loop → eligible for `Sequence`.
- Clear discontinuity → one-shot with decay → stay in `Keys`.

Most eJay arps pass this gate; most plucked one-shots have a decaying tail
that does not.

## Implementation sequencing

1. **Add BPM table.** `tools/product-bpm.ts` exporting
   `PRODUCT_BPM: Record<string, number>`. Cross-check against
   `mix-grid-summary.json` and the per-product MIX defaults.
2. **Wire a WAV PCM decoder.** Reuse the decoder already present in the PXD
   pipeline (`tools/pxd-parser.ts`); lift any shared helpers into
   `tools/wav-decode.ts` if needed.
3. **Add `tools/sequence-detect.ts`.** Pure functions: `countTransients`,
   `measureLoopability`, `isTempoAligned`, plus an `analyze(buffer, bpm)`
   wrapper that returns `{ duration, beats, transients, loopable }`.
4. **Extend `output/_normalized/metadata.json`.** Cache analysis results on
   each sample so reruns are instant and thresholds can be retuned without
   re-decoding:

   ```json
   {
     "duration": 4.923,
     "beats": 16,
     "transients": 7,
     "loopable": true
   }
   ```

5. **Add a migration pass in `tools/normalize.ts`** (or a sibling
   `tools/sequence-migrate.ts`) that reads the cached analysis and moves
   qualifying `Keys` samples into `Sequence/`.
6. **Tests.** Cover gate B tolerance bands, transient counting on synthetic
   fixtures, and the combined promotion rule. Target ≥ 80 % coverage per the
   project quality gate.

## Practical budget

Roughly 30 000 samples × a few milliseconds of analysis per sample totals a
few minutes for the initial batch — acceptable as a one-shot migration. Once
the cache is populated, re-running normalize with tuned thresholds is instant.

## Edge cases

### Drum loops vs arps

If a sample lands in `Loop` via prefix detection (`DA`–`DF`, `LA`, `LC`,
`BT`, `HS`, …) it must stay in `Loop` even if its transient/tempo profile
looks arp-like. **Category ordering matters**: resolve drum-loop prefixes
first, then run Sequence detection on whatever is still tagged `Keys`.

### Bass sequences

The same detection could split `Bass` into `Bass/loop` (sequenced basslines)
vs `Bass` (one-shot stabs). Valuable but out of scope for the first pass —
ship `Sequence` for `Keys` first, extend to `Bass` in a follow-up if the
heuristic proves reliable.

### Orchestral sustains

String pads and brass swells are long by nature and will pass gate B and D
even though they are not sequences. **Guard by running the Orchestral
keyword detection before Sequence analysis** — a sample that already carries
the `Orchestral` category is never re-examined for Sequence promotion.

### Other guards

- Skip samples shorter than ~0.5 s outright; they cannot be tempo-aligned
  loops regardless of content.
- Skip stereo-only samples if the decoder has not been verified on stereo
  PXD output yet; fall back to left channel.
- Respect the existing `--dry-run` contract: the migration pass must report
  counts per subcategory and a per-sample decision log before any files
  move.
