/**
 * sequence-detect.ts — PCM-based heuristics for distinguishing
 * loop-intended sequences/arpeggios from one-shot plucks.
 *
 * See `docs/sequence-detection-plan.md` for the full rationale. The
 * recommended promotion rule (Keys → Sequence) is:
 *
 *     isTempoAligned(beats) AND (transients >= 3 OR loopable)
 *
 * `transients == 2` is treated as ambiguous: gate D (loopability) decides.
 */

import type { DecodedWav } from "./wav-decode.js";

// ── Tempo alignment (Gate B) ────────────────────────────────

export const TEMPO_TARGET_BEATS = [4, 8, 16, 32] as const;
export const TEMPO_TOLERANCE = 0.02; // ±2 %

/**
 * Check whether a measured beat count lands within ±2 % of an integer
 * loop length in {4, 8, 16, 32}. Pass either an already-rounded `beats`
 * value or the raw `duration * bpm / 60` float; both work.
 */
export function isTempoAligned(beats: number): boolean {
  if (!Number.isFinite(beats) || beats <= 0) return false;
  for (const target of TEMPO_TARGET_BEATS) {
    if (Math.abs(beats - target) / target <= TEMPO_TOLERANCE) return true;
  }
  return false;
}

// ── Transient counting (Gate C) ─────────────────────────────

export interface TransientOptions {
  /** Envelope window length in seconds (default 10 ms). */
  windowSec?: number;
  /** Minimum gap between counted transients in seconds (default 80 ms). */
  minGapSec?: number;
  /** Rise threshold relative to mean envelope (default 3.0). */
  highMul?: number;
  /** Reset threshold relative to mean envelope (default 1.5). */
  lowMul?: number;
}

/**
 * Count attack transients in a mono PCM buffer. Builds an RMS envelope
 * over short windows, then triggers a transient whenever the envelope
 * rises above `mean * highMul` after dropping below `mean * lowMul`.
 * Adjacent transients within `minGapSec` collapse into one.
 */
export function countTransients(wav: DecodedWav, options: TransientOptions = {}): number {
  const { windowSec = 0.01, minGapSec = 0.08, highMul = 3, lowMul = 1.5 } = options;
  const { samples, sampleRate } = wav;
  if (samples.length === 0 || sampleRate <= 0) return 0;

  const windowSize = Math.max(1, Math.floor(sampleRate * windowSec));
  const minGapWindows = Math.max(1, Math.floor(minGapSec / windowSec));
  const envelope = rmsEnvelope(samples, windowSize);
  if (envelope.length === 0) return 0;

  let mean = 0;
  for (const v of envelope) mean += v;
  mean /= envelope.length;
  if (mean <= 0) return 0;

  const high = mean * highMul;
  const low = mean * lowMul;

  let count = 0;
  let armed = true;
  let lastTrigger = -minGapWindows;

  for (let i = 0; i < envelope.length; i++) {
    const v = envelope[i];
    if (armed && v >= high && i - lastTrigger >= minGapWindows) {
      count++;
      armed = false;
      lastTrigger = i;
    } else if (!armed && v < low) {
      armed = true;
    }
  }
  return count;
}

function rmsEnvelope(samples: Float32Array, windowSize: number): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / windowSize));
  for (let w = 0; w < out.length; w++) {
    const start = w * windowSize;
    let sum = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    out[w] = Math.sqrt(sum / windowSize);
  }
  return out;
}

// ── Loopability (Gate D) ─────────────────────────────────────

export interface LoopabilityOptions {
  /** Window length in seconds compared at head and tail (default 50 ms). */
  windowSec?: number;
  /** Maximum allowed RMS difference relative to head RMS (default 0.5). */
  maxRmsDelta?: number;
  /** Maximum allowed normalised cross-correlation distance (default 0.4). */
  maxCorrDistance?: number;
}

export interface Loopability {
  loopable: boolean;
  headRms: number;
  tailRms: number;
  /** Pearson correlation in [-1, 1]; 1 is identical shape. */
  correlation: number;
}

/**
 * Compare the first and last ~50 ms of a sample. A loopable sample has
 * similar RMS energy at both ends and a high cross-correlation between
 * the two short windows.
 */
export function measureLoopability(
  wav: DecodedWav,
  options: LoopabilityOptions = {},
): Loopability {
  const { windowSec = 0.05, maxRmsDelta = 0.5, maxCorrDistance = 0.4 } = options;
  const { samples, sampleRate } = wav;
  const empty: Loopability = { loopable: false, headRms: 0, tailRms: 0, correlation: 0 };
  if (samples.length === 0 || sampleRate <= 0) return empty;

  const windowSize = Math.max(8, Math.floor(sampleRate * windowSec));
  if (samples.length < windowSize * 2) return empty;

  const head = samples.subarray(0, windowSize);
  const tail = samples.subarray(samples.length - windowSize);

  const headRms = rms(head);
  const tailRms = rms(tail);
  if (headRms === 0 && tailRms === 0) {
    // Pure silence at both ends — trivially loopable.
    return { loopable: true, headRms, tailRms, correlation: 1 };
  }

  const reference = Math.max(headRms, tailRms);
  const rmsDelta = reference > 0 ? Math.abs(headRms - tailRms) / reference : 1;
  const corr = pearson(head, tail);
  const corrDistance = 1 - corr;

  const loopable = rmsDelta <= maxRmsDelta && corrDistance <= maxCorrDistance;
  return { loopable, headRms, tailRms, correlation: corr };
}

function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

function pearson(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  return num / den;
}

// ── Combined analysis & promotion ───────────────────────────

export interface SampleAnalysis {
  duration: number;
  beats: number;
  transients: number;
  loopable: boolean;
}

export interface AnalyzeOptions {
  transient?: TransientOptions;
  loopability?: LoopabilityOptions;
}

/**
 * Run the full PCM analysis pipeline and return the cache record that
 * should be written into metadata.json under each sample.
 */
export function analyze(wav: DecodedWav, bpm: number, options: AnalyzeOptions = {}): SampleAnalysis {
  const duration = wav.duration;
  const beats = bpm > 0 ? (duration * bpm) / 60 : 0;
  const transients = countTransients(wav, options.transient);
  const loopable = measureLoopability(wav, options.loopability).loopable;
  return { duration, beats, transients, loopable };
}

/**
 * Apply the recommended promotion rule: tempo-aligned AND
 * (multiple transients OR clean loop). When transients == 2 the call
 * defers entirely to loopability.
 */
export function shouldPromoteToSequence(analysis: SampleAnalysis): boolean {
  if (!isTempoAligned(analysis.beats)) return false;
  if (analysis.transients >= 3) return true;
  if (analysis.transients <= 1) return false;
  return analysis.loopable;
}
