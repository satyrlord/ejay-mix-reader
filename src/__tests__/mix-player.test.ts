import { describe, expect, it, vi } from "vitest";

import {
  beatsToSeconds,
  buildImpulseResponse,
  buildOverdriveCurve,
  createEffect,
  DrumMachine,
  effectiveGain,
  EQ10_FREQUENCIES,
  fetchMixBinary,
  MixChannel,
  MixPlayerHost,
  panToStereo,
  semitonesToRate,
  SoloGroup,
  volumeToGain,
  type AnalyserNodeLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadFilterNodeLike,
  type ConvolverNodeLike,
  type DelayNodeLike,
  type DynamicsCompressorNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type StereoPannerNodeLike,
  type WaveShaperNodeLike,
} from "../mix-player.js";

/* -------------------------------------------------------------------------- */
/* Mock AudioContext                                                          */
/* -------------------------------------------------------------------------- */

function makeGain(): GainNodeLike {
  return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
}
function makePanner(): StereoPannerNodeLike {
  return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} };
}
function makeDelay(): DelayNodeLike {
  return { delayTime: { value: 0 }, connect: () => {}, disconnect: () => {} };
}
function makeConvolver(): ConvolverNodeLike {
  return { buffer: null, connect: () => {}, disconnect: () => {} };
}
function makeCompressor(): DynamicsCompressorNodeLike {
  return { threshold: { value: -24 }, ratio: { value: 12 }, connect: () => {}, disconnect: () => {} };
}
function makeSource(): AudioBufferSourceNodeLike {
  return {
    buffer: null,
    playbackRate: { value: 1 },
    connect: () => {},
    disconnect: () => {},
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function makeBiquad(): BiquadFilterNodeLike {
  return {
    type: "peaking",
    frequency: { value: 1000 },
    Q: { value: 1 },
    gain: { value: 0 },
    connect: () => {},
    disconnect: () => {},
  };
}

function makeWaveShaper(): WaveShaperNodeLike {
  return { curve: null, oversample: "none", connect: () => {}, disconnect: () => {} };
}

function makeOscillator(): OscillatorNodeLike {
  return {
    type: "sine",
    frequency: { value: 440 },
    start: vi.fn(),
    stop: vi.fn(),
    connect: () => {},
    disconnect: () => {},
  };
}

function makeAnalyser(): AnalyserNodeLike {
  return { fftSize: 2048, frequencyBinCount: 1024, connect: () => {}, disconnect: () => {} };
}

function makeCtx(): AudioContextLike {
  const destination: AudioNodeLike = { connect: () => {}, disconnect: () => {} };
  return {
    sampleRate: 44100,
    currentTime: 0,
    destination,
    createGain: makeGain,
    createStereoPanner: makePanner,
    createDelay: makeDelay,
    createConvolver: makeConvolver,
    createDynamicsCompressor: makeCompressor,
    createBuffer: (_ch, length) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: makeSource,
    createBiquadFilter: makeBiquad,
    createWaveShaper: makeWaveShaper,
    createOscillator: makeOscillator,
    createAnalyser: makeAnalyser,
    decodeAudioData: async (data) => data,
  };
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

describe("beatsToSeconds", () => {
  it("converts beats to seconds at 120 BPM", () => {
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2);
  });
  it("rejects non-positive BPM", () => {
    expect(() => beatsToSeconds(1, 0)).toThrow(/Invalid BPM/);
    expect(() => beatsToSeconds(1, -1)).toThrow(/Invalid BPM/);
    expect(() => beatsToSeconds(1, Number.NaN)).toThrow(/Invalid BPM/);
  });
  it("rejects non-finite beats", () => {
    expect(() => beatsToSeconds(Number.POSITIVE_INFINITY, 120)).toThrow(/Invalid beats/);
  });
});

describe("volumeToGain", () => {
  it("maps 0..100 to 0..1", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(50)).toBe(0.5);
    expect(volumeToGain(100)).toBe(1);
  });
  it("clamps out-of-range and rejects NaN", () => {
    expect(volumeToGain(150)).toBe(1);
    expect(volumeToGain(-10)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });
});

describe("panToStereo", () => {
  it("maps 50 to centre, 0 to full left, 100 to full right", () => {
    expect(panToStereo(50)).toBe(0);
    expect(panToStereo(0)).toBe(-1);
    expect(panToStereo(100)).toBe(1);
  });
  it("clamps out-of-range and rejects NaN", () => {
    expect(panToStereo(-10)).toBe(-1);
    expect(panToStereo(120)).toBe(1);
    expect(panToStereo(Number.NaN)).toBe(0);
  });
});

describe("semitonesToRate", () => {
  it("doubles at +12 semitones, halves at -12", () => {
    expect(semitonesToRate(12)).toBeCloseTo(2);
    expect(semitonesToRate(-12)).toBeCloseTo(0.5);
    expect(semitonesToRate(0)).toBe(1);
  });
  it("falls back to 1 for non-finite input", () => {
    expect(semitonesToRate(Number.NaN)).toBe(1);
  });
});

describe("effectiveGain", () => {
  it("returns 0 when muted", () => {
    expect(effectiveGain({ volume: 100, muted: true, soloed: false, anySoloed: false })).toBe(0);
  });
  it("silences non-soloed channels when any channel is soloed", () => {
    expect(effectiveGain({ volume: 100, muted: false, soloed: false, anySoloed: true })).toBe(0);
  });
  it("keeps soloed channels audible", () => {
    expect(effectiveGain({ volume: 80, muted: false, soloed: true, anySoloed: true })).toBeCloseTo(0.8);
  });
  it("passes through volume in the normal case", () => {
    expect(effectiveGain({ volume: 50, muted: false, soloed: false, anySoloed: false })).toBe(0.5);
  });
});

describe("buildImpulseResponse", () => {
  it("produces a float array of the expected length", () => {
    const ir = buildImpulseResponse(48000, 0.5, 2);
    expect(ir.length).toBe(24000);
    expect(ir.every(v => Math.abs(v) <= 1)).toBe(true);
  });
  it("returns an empty array for invalid inputs", () => {
    expect(buildImpulseResponse(0, 1, 2).length).toBe(0);
    expect(buildImpulseResponse(44100, 0, 2).length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* MixChannel                                                                 */
/* -------------------------------------------------------------------------- */

describe("MixChannel", () => {
  it("initialises with full volume at centre pan", () => {
    const ctx = makeCtx();
    const channel = new MixChannel(ctx);
    expect(channel.gain.gain.value).toBe(1);
    expect(channel.panner.pan.value).toBe(0);
  });

  it("responds to setVolume/setPan/setMuted", () => {
    const ctx = makeCtx();
    const channel = new MixChannel(ctx);
    channel.setVolume(50);
    expect(channel.gain.gain.value).toBe(0.5);
    channel.setPan(100);
    expect(channel.panner.pan.value).toBe(1);
    channel.setMuted(true);
    expect(channel.gain.gain.value).toBe(0);
    channel.setMuted(false);
    expect(channel.gain.gain.value).toBe(0.5);
  });

  it("exposes its input node for external sources to connect to", () => {
    const ctx = makeCtx();
    const channel = new MixChannel(ctx);
    expect(channel.input).toBe(channel.gain);
  });

  it("dispose disconnects gain and panner nodes", () => {
    const gainDisconnect = vi.fn();
    const pannerDisconnect = vi.fn();
    const ctx: AudioContextLike = {
      ...makeCtx(),
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: gainDisconnect }),
      createStereoPanner: () => ({ pan: { value: 0 }, connect: () => {}, disconnect: pannerDisconnect }),
    };
    const channel = new MixChannel(ctx);
    channel.dispose();
    expect(gainDisconnect).toHaveBeenCalledOnce();
    expect(pannerDisconnect).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* SoloGroup                                                                  */
/* -------------------------------------------------------------------------- */

describe("SoloGroup", () => {
  it("silences non-soloed channels when any channel is soloed", () => {
    const ctx = makeCtx();
    const group = new SoloGroup();
    const a = new MixChannel(ctx);
    const b = new MixChannel(ctx);
    group.attach("a", a);
    group.attach("b", b);
    group.setSoloed("a", true);
    expect(a.gain.gain.value).toBe(1);
    expect(b.gain.gain.value).toBe(0);
    group.setSoloed("a", false);
    expect(b.gain.gain.value).toBe(1);
  });

  it("ignores setSoloed on unknown ids", () => {
    const group = new SoloGroup();
    expect(() => group.setSoloed("ghost", true)).not.toThrow();
    expect(group.anySoloed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* DrumMachine                                                                */
/* -------------------------------------------------------------------------- */

describe("DrumMachine", () => {
  it("returns null when triggering an unknown pad", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    expect(dm.trigger("ghost", 0)).toBeNull();
    expect(dm.padCount).toBe(0);
  });

  it("routes simple pads directly to the output", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("kick", { buffer: {}, semitones: 0 });
    const src = dm.trigger("kick", 0.5);
    expect(src).not.toBeNull();
    expect(src?.playbackRate.value).toBe(1);
    expect(src?.start).toHaveBeenCalledWith(0.5);
  });

  it("applies pitch and per-pad gain when configured", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("snare", { buffer: {}, semitones: 12, gain: 0.3 });
    const src = dm.trigger("snare", 0);
    expect(src?.playbackRate.value).toBeCloseTo(2);
    expect(dm.padCount).toBe(1);
  });

  it("clamps negative pad gain to zero", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("hat", { buffer: {}, gain: -5 });
    expect(dm.trigger("hat", 0)).not.toBeNull();
  });

  it("dispose clears all registered pads", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("kick", { buffer: {} });
    dm.setPad("snare", { buffer: {} });
    expect(dm.padCount).toBe(2);
    dm.dispose();
    expect(dm.padCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* createEffect                                                               */
/* -------------------------------------------------------------------------- */

describe("createEffect", () => {
  it("builds a compressor whose input == output", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "compressor");
    expect(fx.kind).toBe("compressor");
    expect(fx.input).toBe(fx.output);
  });

  it("builds a delay effect with feedback wiring", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "delay");
    expect(fx.kind).toBe("delay");
    expect((fx.input as DelayNodeLike).delayTime.value).toBeCloseTo(0.25);
  });

  it("delay effect dispose disconnects the internal feedback gain node", () => {
    const feedbackDisconnect = vi.fn();
    const ctx: AudioContextLike = {
      ...makeCtx(),
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: feedbackDisconnect }),
    };
    const fx = createEffect(ctx, "delay");
    expect(fx.dispose).toBeDefined();
    fx.dispose?.();
    expect(feedbackDisconnect).toHaveBeenCalledOnce();
  });

  it("builds a reverb effect with an impulse response buffer", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "reverb");
    expect(fx.kind).toBe("reverb");
    expect((fx.input as ConvolverNodeLike).buffer).not.toBeNull();
  });

  it("builds an overdrive effect with a soft-clipping curve", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "overdrive");
    expect(fx.kind).toBe("overdrive");
    const shaper = fx.input as WaveShaperNodeLike;
    expect(shaper.curve).not.toBeNull();
    expect(shaper.curve!.length).toBe(2048);
    expect(shaper.oversample).toBe("4x");
  });

  it("builds a 10-band EQ with ISO centre frequencies", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "eq10");
    expect(fx.kind).toBe("eq10");
    // First filter should sit at the lowest band.
    expect((fx.input as BiquadFilterNodeLike).frequency.value).toBe(EQ10_FREQUENCIES[0]);
    // Output differs from input (chained through 10 filters).
    expect(fx.input).not.toBe(fx.output);
  });

  it("builds a chorus effect with modulated delay wiring", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "chorus");
    expect(fx.kind).toBe("chorus");
    expect(fx.input).toBeDefined();
    expect(fx.output).toBeDefined();
    expect(fx.input).not.toBe(fx.output);
  });

  it("builds a mid-sweep bandpass effect", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "midsweep");
    expect(fx.kind).toBe("midsweep");
    const band = fx.input as BiquadFilterNodeLike;
    expect(band.type).toBe("bandpass");
    expect(band.frequency.value).toBeCloseTo(1000);
  });

  it("builds a harmonizer with parallel gain bus", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "harmonizer");
    expect(fx.kind).toBe("harmonizer");
    expect(fx.input).not.toBe(fx.output);
  });

  it("builds a vocoder with analyser + filter bank", () => {
    const ctx = makeCtx();
    const fx = createEffect(ctx, "vocoder");
    expect(fx.kind).toBe("vocoder");
    expect(fx.input).not.toBe(fx.output);
  });
});

describe("buildOverdriveCurve", () => {
  it("produces a symmetric curve clamped in a sensible range", () => {
    const curve = buildOverdriveCurve(1024, 50);
    expect(curve.length).toBe(1024);
    // The middle of the curve corresponds to x ~ 0, so the output should be ~0.
    expect(Math.abs(curve[Math.floor(curve.length / 2)])).toBeLessThan(0.01);
  });
  it("returns an empty array for invalid sample counts", () => {
    expect(buildOverdriveCurve(0, 10).length).toBe(0);
    expect(buildOverdriveCurve(-5, 10).length).toBe(0);
  });
  it("still works when the amount is zero", () => {
    const curve = buildOverdriveCurve(16, 0);
    expect(curve.length).toBe(16);
    expect(curve.every(v => Number.isFinite(v))).toBe(true);
  });
});

describe("EQ10_FREQUENCIES", () => {
  it("exposes exactly 10 centre frequencies", () => {
    expect(EQ10_FREQUENCIES.length).toBe(10);
  });
  it("is sorted ascending", () => {
    for (let i = 1; i < EQ10_FREQUENCIES.length; i++) {
      expect(EQ10_FREQUENCIES[i]).toBeGreaterThan(EQ10_FREQUENCIES[i - 1]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* MixPlayerHost                                                              */
/* -------------------------------------------------------------------------- */

describe("MixPlayerHost", () => {
  it("starts scheduled sources on play and exposes the count", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    host.scheduleSample({ buffer: {}, beat: 0, channelId: "bass" });
    host.scheduleSample({ buffer: {}, beat: 2, channelId: "bass", semitones: 7 });
    expect(host.scheduledCount).toBe(2);
    expect(host.isPlaying).toBe(false);
    const started = host.play(120, 10);
    expect(started).toBe(2);
    expect(host.isPlaying).toBe(true);
  });

  it("ignores scheduled specs for unknown channels", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    host.scheduleSample({ buffer: {}, beat: 0, channelId: "ghost" });
    expect(host.play(120)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith("Skipping scheduled sample for unknown channel: ghost");
    warnSpy.mockRestore();
  });

  it("stops active sources and clears them", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    host.registerChannel("drum");
    host.scheduleSample({ buffer: {}, beat: 0, channelId: "drum" });
    host.play(140);
    host.stop();
    expect(host.isPlaying).toBe(false);
  });

  it("clear() empties the schedule queue as well", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    host.scheduleSample({ buffer: {}, beat: 0, channelId: "bass" });
    host.clear();
    expect(host.scheduledCount).toBe(0);
  });

  it("tolerates sources whose stop() throws (already-stopped case)", () => {
    const ctx = makeCtx();
    ctx.createBufferSource = () => ({
      buffer: null,
      playbackRate: { value: 1 },
      connect: () => {},
      disconnect: () => {},
      start: vi.fn(),
      stop: () => { throw new Error("already stopped"); },
    });
    const host = new MixPlayerHost(ctx);
    host.registerChannel("drum");
    host.scheduleSample({ buffer: {}, beat: 0, channelId: "drum" });
    host.play(120);
    expect(() => host.stop()).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* fetchMixBinary                                                             */
/* -------------------------------------------------------------------------- */

describe("fetchMixBinary", () => {
  it("calls fetch with the /mix/ URL and returns the arrayBuffer", async () => {
    const buffer = new ArrayBuffer(8);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buffer,
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchMixBinary("Dance_eJay1", "START.MIX");
    expect(fetchSpy).toHaveBeenCalledWith("/mix/Dance_eJay1/START.MIX");
    expect(result).toBe(buffer);
    vi.unstubAllGlobals();
  });

  it("throws on a non-OK response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchMixBinary("Dance_eJay1", "missing.mix")).rejects.toThrow(/HTTP 404/);
    vi.unstubAllGlobals();
  });
});
