import { describe, expect, it } from "vitest";

import {
  TEMPO_TARGET_BEATS,
  analyze,
  countTransients,
  isTempoAligned,
  measureLoopability,
  shouldPromoteToSequence,
} from "../sequence-detect.js";
import type { DecodedWav } from "../wav-decode.js";

function makeWav(samples: number[] | Float32Array, sampleRate = 8000): DecodedWav {
  const arr = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  return {
    sampleRate,
    channels: 1,
    bitDepth: 16,
    samples: arr,
    duration: arr.length / sampleRate,
  };
}

function pulseTrain(opts: {
  sampleRate?: number;
  pulses: number;
  pulseSec?: number;
  gapSec?: number;
  amplitude?: number;
  trailingSilenceSec?: number;
}): Float32Array {
  const sampleRate = opts.sampleRate ?? 8000;
  const pulseLen = Math.floor(sampleRate * (opts.pulseSec ?? 0.02));
  const gapLen = Math.floor(sampleRate * (opts.gapSec ?? 0.2));
  const trail = Math.floor(sampleRate * (opts.trailingSilenceSec ?? 0));
  const total = (pulseLen + gapLen) * opts.pulses + trail;
  const out = new Float32Array(total);
  const amp = opts.amplitude ?? 0.8;
  for (let p = 0; p < opts.pulses; p++) {
    const start = p * (pulseLen + gapLen);
    for (let i = 0; i < pulseLen; i++) {
      // Square-ish pulse with alternating sign to give RMS energy.
      out[start + i] = i % 2 === 0 ? amp : -amp;
    }
  }
  return out;
}

describe("isTempoAligned", () => {
  it("accepts integer beat counts in {4, 8, 16, 32}", () => {
    for (const b of TEMPO_TARGET_BEATS) {
      expect(isTempoAligned(b)).toBe(true);
    }
  });

  it("accepts values within ±2 % of a target", () => {
    expect(isTempoAligned(8.1)).toBe(true);
    expect(isTempoAligned(7.9)).toBe(true);
    expect(isTempoAligned(15.7)).toBe(true);
    expect(isTempoAligned(16.3)).toBe(true);
  });

  it("rejects values outside the tolerance and bad inputs", () => {
    expect(isTempoAligned(6)).toBe(false);
    expect(isTempoAligned(8.5)).toBe(false);
    expect(isTempoAligned(0)).toBe(false);
    expect(isTempoAligned(-4)).toBe(false);
    expect(isTempoAligned(Number.NaN)).toBe(false);
  });
});

describe("countTransients", () => {
  it("returns zero for silence", () => {
    expect(countTransients(makeWav(new Float32Array(2000)))).toBe(0);
  });

  it("returns zero for an empty or zero-rate buffer", () => {
    expect(countTransients(makeWav([]))).toBe(0);
    expect(countTransients({ ...makeWav([0.1, 0.2]), sampleRate: 0 })).toBe(0);
  });

  it("counts a sequence of well-separated pulses", () => {
    const wav = makeWav(pulseTrain({ pulses: 6, gapSec: 0.2, trailingSilenceSec: 0.1 }));
    expect(countTransients(wav)).toBeGreaterThanOrEqual(5);
  });

  it("returns 1 for a single attack with decay", () => {
    const sampleRate = 8000;
    const len = sampleRate * 1; // 1 s
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (sampleRate * 0.15));
      out[i] = (i % 2 === 0 ? 1 : -1) * env;
    }
    const wav = makeWav(out, sampleRate);
    expect(countTransients(wav)).toBe(1);
  });
});

describe("measureLoopability", () => {
  it("returns silence-loop result when both ends are zero", () => {
    const result = measureLoopability(makeWav(new Float32Array(8000)));
    expect(result.loopable).toBe(true);
    expect(result.correlation).toBe(1);
  });

  it("flags a steady tone with matching head/tail as loopable", () => {
    const sampleRate = 8000;
    const len = sampleRate; // 1 s
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }
    const result = measureLoopability(makeWav(out, sampleRate));
    expect(result.loopable).toBe(true);
    expect(result.headRms).toBeGreaterThan(0);
    expect(result.tailRms).toBeGreaterThan(0);
  });

  it("rejects a sample with a loud head and silent tail", () => {
    const sampleRate = 8000;
    const len = sampleRate; // 1 s
    const out = new Float32Array(len);
    for (let i = 0; i < sampleRate * 0.05; i++) {
      out[i] = i % 2 === 0 ? 0.9 : -0.9;
    }
    // Tail (last 50 ms) is silence.
    const result = measureLoopability(makeWav(out, sampleRate));
    expect(result.loopable).toBe(false);
  });

  it("returns the empty result for zero-length / zero-rate input", () => {
    expect(measureLoopability(makeWav([])).loopable).toBe(false);
    expect(measureLoopability({ ...makeWav([0.1, 0.2]), sampleRate: 0 }).loopable).toBe(false);
  });

  it("returns the empty result when the buffer is shorter than two windows", () => {
    expect(measureLoopability(makeWav(new Float32Array(64))).loopable).toBe(false);
  });
});

describe("analyze + shouldPromoteToSequence", () => {
  it("promotes a tempo-aligned multi-transient loop", () => {
    // 4 pulses at 0.5 s spacing → 2 s total. At 120 BPM that's 4 beats.
    const sampleRate = 8000;
    const out = pulseTrain({
      sampleRate,
      pulses: 4,
      pulseSec: 0.05,
      gapSec: 0.45,
    });
    const wav = makeWav(out, sampleRate);
    const result = analyze(wav, 120);
    expect(result.transients).toBeGreaterThanOrEqual(3);
    expect(isTempoAligned(result.beats)).toBe(true);
    expect(shouldPromoteToSequence(result)).toBe(true);
  });

  it("does not promote a one-shot pluck even if tempo-aligned", () => {
    const sampleRate = 8000;
    const len = sampleRate * 2; // 2 s → 4 beats at 120 BPM
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (sampleRate * 0.2));
      out[i] = (i % 2 === 0 ? 1 : -1) * env;
    }
    const wav = makeWav(out, sampleRate);
    const result = analyze(wav, 120);
    expect(result.transients).toBe(1);
    expect(shouldPromoteToSequence(result)).toBe(false);
  });

  it("does not promote a non-tempo-aligned sample regardless of content", () => {
    const sampleRate = 8000;
    // 5 pulses at 0.3 s spacing → 1.5 s. At 120 BPM that's 3 beats — not in {4,8,16,32}.
    const out = pulseTrain({ sampleRate, pulses: 5, pulseSec: 0.05, gapSec: 0.25 });
    const wav = makeWav(out, sampleRate);
    const result = analyze(wav, 120);
    expect(isTempoAligned(result.beats)).toBe(false);
    expect(shouldPromoteToSequence(result)).toBe(false);
  });

  it("defers to loopability when transient count is exactly 2", () => {
    const base = { duration: 4, beats: 8, transients: 2, loopable: true };
    expect(shouldPromoteToSequence(base)).toBe(true);
    expect(shouldPromoteToSequence({ ...base, loopable: false })).toBe(false);
  });

  it("returns zero beats when bpm is unknown", () => {
    const wav = makeWav(pulseTrain({ pulses: 3 }));
    const result = analyze(wav, 0);
    expect(result.beats).toBe(0);
    expect(shouldPromoteToSequence(result)).toBe(false);
  });
});
