import { describe, expect, it, vi } from "vitest";

import {
  beatsToSeconds,
  buildMixPlaybackPlan,
  buildImpulseResponse,
  buildOverdriveCurve,
  createEffect,
  DrumMachine,
  effectiveGain,
  EQ10_FREQUENCIES,
  fetchMixBinary,
  lanesForMix,
  MixChannel,
  MixPlayerHost,
  panToStereo,
  semitonesToRate,
  SoloGroup,
  volumeToGain,
  type AnalyserNodeLike,
  type AudioBufferLike,
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
import type { SampleLookupEntry } from "../data.js";
import type { MixIR } from "../mix-types.js";

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

function makeAudioBuffer(
  channels: number = 1,
  length: number = 44100,
  sampleRate: number = 44100,
): AudioBufferLike {
  return {
    duration: length / sampleRate,
    length,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  };
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
    createBuffer: (channels, length, sampleRate) => makeAudioBuffer(channels, length, sampleRate),
    createBufferSource: makeSource,
    createBiquadFilter: makeBiquad,
    createWaveShaper: makeWaveShaper,
    createOscillator: makeOscillator,
    createAnalyser: makeAnalyser,
    decodeAudioData: async (data) => makeAudioBuffer(1, Math.max(1, data.byteLength)),
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

describe("buildMixPlaybackPlan", () => {
  function makeMix(overrides: Partial<MixIR> = {}): MixIR {
    return {
      format: "B",
      product: "Dance_eJay2",
      appId: 0x00000a19,
      bpm: 140,
      bpmAdjusted: null,
      author: null,
      title: null,
      registration: null,
      mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
      drumMachine: null,
      tickerText: [],
      catalogs: [{ name: "Dance eJay 2.0", idRangeStart: 0, idRangeEnd: 5000 }],
      tracks: [],
      ...overrides,
    };
  }

  it("maps tracks to a schedulable plan and resolves by sample id first", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Dance_eJay2: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: { "1930": "Drum/kick.wav" },
        byGen1Id: {},
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      tracks: [
        {
          beat: 4,
          channel: 2,
          sampleRef: {
            rawId: 1930,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: 1024,
          },
        },
      ],
    }), sampleIndex);

    expect(plan.events).toHaveLength(1);
    expect(plan.resolvedEvents).toBe(1);
    expect(plan.unresolvedEvents).toBe(0);
    // beat 4 → maxBeat+1 = 5 → rounded up to next 4-beat bar = 8.
    expect(plan.loopBeats).toBe(8);
    expect(plan.timelineRecovered).toBe(true);
    expect(plan.lanes).toHaveLength(17); // Format B = Gen 2 = 17 lanes
    expect(plan.channelIds).toEqual(["lane-2"]);
    expect(plan.events[0]).toMatchObject({
      beat: 4,
      channelId: "lane-2",
      audioUrl: "output/Drum/kick.wav",
      resolved: true,
      displayLabel: "#1930",
    });
  });

  it("prefers authoritative parser loopBeats over inferred fallback", () => {
    const plan = buildMixPlaybackPlan(makeMix({
      loopBeats: 13,
      tracks: [
        {
          beat: 4,
          channel: 2,
          sampleRef: {
            rawId: 1930,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: 1024,
          },
        },
      ],
    }));

    // Inferred fallback would be 8 (maxBeat+1 rounded to 4-beat bar),
    // but parser-provided loopBeats must win when available.
    expect(plan.loopBeats).toBe(13);
  });

  it("falls back to internal name and display-name lookup when no sample id match exists", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Dance_eJay3: {
        byAlias: { kick28: "Drum/kick28.wav" },
        bySource: {},
        byStem: { d5mg539: "Drum/internal.wav" },
        byInternalName: { d5mg539: "Drum/internal.wav" },
        bySampleId: {},
        byGen1Id: {},
      },
    };

    const internalPlan = buildMixPlaybackPlan(makeMix({
      format: "C",
      product: "Dance_eJay3",
      appId: 0x00002571,
      tracks: [
        {
          beat: null,
          channel: null,
          sampleRef: {
            rawId: 0,
            internalName: "D5MG539",
            displayName: null,
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(internalPlan.events[0]).toMatchObject({
      channelId: "track-0",
      beat: 0,
      audioUrl: "output/Drum/internal.wav",
      resolved: true,
      displayLabel: "D5MG539",
    });

    const displayPlan = buildMixPlaybackPlan(makeMix({
      format: "C",
      product: "Dance_eJay3",
      appId: 0x00002571,
      tracks: [
        {
          beat: null,
          channel: null,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "kick28",
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(displayPlan.events[0]).toMatchObject({
      audioUrl: "output/Drum/kick28.wav",
      resolved: true,
      displayLabel: "kick28",
    });
  });

  it("uses product fallbacks and keeps unresolved events in the plan", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Dance_eJay3: {
        byAlias: { minrim01: "Drum/minrim01.wav" },
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {},
        byGen1Id: {},
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      format: "C",
      product: "Techno_eJay3",
      appId: 0x00002572,
      catalogs: [{ name: "Techno eJay 3.0", idRangeStart: 0, idRangeEnd: 4000 }],
      tracks: [
        {
          beat: null,
          channel: null,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "minrim01",
            resolvedPath: null,
            dataLength: null,
          },
        },
        {
          beat: null,
          channel: null,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(plan.resolvedEvents).toBe(1);
    expect(plan.unresolvedEvents).toBe(1);
    expect(plan.events[0]?.audioUrl).toBe("output/Drum/minrim01.wav");
    expect(plan.events[1]).toMatchObject({
      audioUrl: null,
      resolved: false,
      displayLabel: "Unknown sample",
    });
  });

  it("resolves Gen 1 raw ids from precomputed catalog mappings and canonical product labels", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Dance_eJay1: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {},
        byGen1Id: { "1": "Drum/gen1.wav" },
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      format: "A",
      product: "Dance_eJay_10",
      appId: 0x02f60006,
      catalogs: [],
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: {
            rawId: 1,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(plan.events[0]).toMatchObject({
      beat: 0,
      channelId: "lane-0",
      audioUrl: "output/Drum/gen1.wav",
      resolved: true,
      displayLabel: "#1",
    });
  });

  it("keeps unknown products unchanged and resolves them from the matching product index", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Custom_Product: {
        byAlias: { custom: "Loop/custom.wav" },
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {},
        byGen1Id: {},
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      product: "Custom_Product",
      catalogs: [],
      tracks: [
        {
          beat: 1,
          channel: 4,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "custom",
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(plan.events[0]).toMatchObject({
      beat: 1,
      channelId: "lane-4",
      audioUrl: "output/Loop/custom.wav",
      resolved: true,
      displayLabel: "custom",
    });
  });

  it("uses catalog hints and filename stems to resolve hinted expansion samples", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Dance_eJay2: {
        byAlias: {},
        bySource: {},
        byStem: {
          lead: "Loop/lead.wav",
          vox: "Voice/vox.wav",
        },
        byInternalName: {},
        bySampleId: {},
        byGen1Id: {},
      },
      SampleKit_DMKIT1: {
        byAlias: {},
        bySource: {},
        byStem: {
          pad: "Pads/pad.wav",
        },
        byInternalName: {},
        bySampleId: {},
        byGen1Id: {},
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      product: "Custom_Product",
      catalogs: [
        { name: "Dance eJay 2", idRangeStart: 0, idRangeEnd: 5000 },
        { name: "DanceMachine Sample Kit Vol. 1", idRangeStart: 0, idRangeEnd: 5000 },
      ],
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "path/to/lead.wav",
            resolvedPath: null,
            dataLength: null,
          },
        },
        {
          beat: 1,
          channel: 1,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "pad.wav",
            resolvedPath: null,
            dataLength: null,
          },
        },
        {
          beat: 2,
          channel: 2,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "vox",
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), sampleIndex);

    expect(plan.events.map((event) => event.audioUrl)).toEqual([
      "output/Loop/lead.wav",
      "output/Pads/pad.wav",
      "output/Voice/vox.wav",
    ]);
    expect(plan.resolvedEvents).toBe(3);
    expect(plan.unresolvedEvents).toBe(0);
  });

  it("normalizes invalid beats and channels and keeps empty indexes unresolved", () => {
    const plan = buildMixPlaybackPlan(makeMix({
      product: "Custom_Product",
      catalogs: [],
      tracks: [
        {
          beat: Number.NaN,
          channel: Number.POSITIVE_INFINITY,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "bad-1",
            resolvedPath: null,
            dataLength: null,
          },
        },
        {
          beat: Number.POSITIVE_INFINITY,
          channel: Number.NaN,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    }), {});

    expect(plan.channelIds).toEqual(["track-0", "track-1"]);
    expect(plan.events).toEqual([
      expect.objectContaining({
        beat: 0,
        channelId: "track-0",
        audioUrl: null,
        resolved: false,
        displayLabel: "bad-1",
      }),
      expect.objectContaining({
        beat: 0,
        channelId: "track-1",
        audioUrl: null,
        resolved: false,
        displayLabel: "Unknown sample",
      }),
    ]);
    expect(plan.resolvedEvents).toBe(0);
    expect(plan.unresolvedEvents).toBe(2);
    // No track has a finite beat → list view, no transport loop.
    expect(plan.loopBeats).toBeNull();
    expect(plan.timelineRecovered).toBe(false);
  });

  it("computes lengthBeats from the gap to the next event on each lane", () => {
    const plan = buildMixPlaybackPlan(makeMix({
      tracks: [
        // Lane 0: events at beats 0, 2, 6 → lengths 2, 4, (loopEnd-6).
        { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: "a", resolvedPath: null, dataLength: null } },
        { beat: 2, channel: 0, sampleRef: { rawId: 2, internalName: null, displayName: "b", resolvedPath: null, dataLength: null } },
        { beat: 6, channel: 0, sampleRef: { rawId: 3, internalName: null, displayName: "c", resolvedPath: null, dataLength: null } },
        // Lane 1: a single event at beat 0 → runs to loopBeats (= 8).
        { beat: 0, channel: 1, sampleRef: { rawId: 4, internalName: null, displayName: "d", resolvedPath: null, dataLength: null } },
      ],
    }));

    expect(plan.loopBeats).toBe(8);
    const lane0 = plan.events.filter((event) => event.channelId === "lane-0");
    expect(lane0.map((event) => event.lengthBeats)).toEqual([2, 4, 2]);
    const lane1 = plan.events.filter((event) => event.channelId === "lane-1");
    expect(lane1[0]?.lengthBeats).toBe(8);
  });

  it("prefers metadata sample beat lengths and clamps to the lane gap", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Rave: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {
          "1": "Loop/a.wav",
          "2": "Loop/b.wav",
        },
        byGen1Id: {},
        byPathBeats: {
          "Loop/a.wav": 2,
          "Loop/b.wav": 8,
        },
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      product: "Rave",
      tracks: [
        { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: "a", resolvedPath: null, dataLength: null } },
        { beat: 6, channel: 0, sampleRef: { rawId: 2, internalName: null, displayName: "b", resolvedPath: null, dataLength: null } },
      ],
    }), sampleIndex);

    expect(plan.loopBeats).toBe(8);
    const lane0 = plan.events.filter((event) => event.channelId === "lane-0");
    // First event uses metadata beats (2) even though next event starts much later.
    // Second event is clamped to lane gap (loop end at beat 8 => gap 2).
    expect(lane0.map((event) => event.lengthBeats)).toEqual([2, 2]);
  });

  it("converts metadata quarter-note beats for Format A and extends loop to 2-bar boundary", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Rave: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {
          "1": "Loop/a.wav",
          "2": "Loop/b.wav",
        },
        byGen1Id: {},
        byPathBeats: {
          "Loop/b.wav": 12,
        },
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      format: "A",
      product: "Rave",
      bpm: 180,
      tracks: [
        { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: "a", resolvedPath: null, dataLength: null } },
        { beat: 114, channel: 0, sampleRef: { rawId: 2, internalName: null, displayName: "b", resolvedPath: null, dataLength: null } },
      ],
    }), sampleIndex);

    // maxBeat+1 = 115; sample b has 12 quarter-note beats -> 3 timeline bars;
    // inferred end becomes 117 and is rounded to the next 2-bar boundary: 118.
    expect(plan.loopBeats).toBe(118);
    const lane0 = plan.events.filter((event) => event.channelId === "lane-0");
    expect(lane0[1]?.lengthBeats).toBe(3);
  });

  it("sets lengthBeats to 1 for each event when loopBeats is null (list-view mode)", () => {
    // Format C/D mixes produce loopBeats = null; last event on each lane must
    // fall back to 1 beat rather than an unbounded duration.
    const plan = buildMixPlaybackPlan({
      format: "C",
      product: "Dance_eJay3",
      appId: 0x00002571,
      bpm: 130,
      bpmAdjusted: null,
      author: null,
      title: null,
      registration: null,
      mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
      drumMachine: null,
      tickerText: [],
      catalogs: [],
      tracks: [
        { beat: null, channel: null, sampleRef: { rawId: 1, internalName: null, displayName: "kick", resolvedPath: null, dataLength: null } },
        { beat: null, channel: null, sampleRef: { rawId: 2, internalName: null, displayName: "bass", resolvedPath: null, dataLength: null } },
      ],
    });

    expect(plan.loopBeats).toBeNull();
    expect(plan.events.every((event) => event.lengthBeats === 1)).toBe(true);
  });

  it("uses the alias from byPath as the displayLabel for resolved events", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Rave: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {},
        byGen1Id: { "1593": "Extra/R1HG0099.wav" },
        byPath: { "Extra/R1HG0099.wav": "Hyper Gate 99" },
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      format: "A",
      product: "Rave",
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: { rawId: 1593, internalName: null, displayName: null, resolvedPath: null, dataLength: null },
        },
        // Unresolved event keeps the raw-id fallback label.
        {
          beat: 4,
          channel: 1,
          sampleRef: { rawId: 99999, internalName: null, displayName: null, resolvedPath: null, dataLength: null },
        },
      ],
    }), sampleIndex);

    expect(plan.events[0]).toMatchObject({
      audioUrl: "output/Extra/R1HG0099.wav",
      resolved: true,
      displayLabel: "Hyper Gate 99",
    });
    expect(plan.events[1]).toMatchObject({
      audioUrl: null,
      resolved: false,
      displayLabel: "#99999",
    });
  });

  it("keeps unresolved fallback label when sampleIndex is undefined", () => {
    const plan = buildMixPlaybackPlan(makeMix({
      product: "Rave",
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: {
            rawId: 42,
            internalName: null,
            displayName: "Lead Vox",
            resolvedPath: "Voice/lead-vox.wav",
            dataLength: null,
          },
        },
      ],
    }));

    expect(plan.events[0]).toMatchObject({
      audioUrl: null,
      resolved: false,
      displayLabel: "Lead Vox",
    });
  });

  it("falls back to sampleLabel when no product in lookup order has a byPath label", () => {
    const sampleIndex: Record<string, SampleLookupEntry> = {
      Rave: {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: { "1593": "Extra/R1HG0099.wav" },
        byGen1Id: {},
        // Intentionally omit byPath for this relPath to exercise the null
        // branch in resolveSampleLabel.
      },
    };

    const plan = buildMixPlaybackPlan(makeMix({
      format: "A",
      product: "Rave",
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: { rawId: 1593, internalName: null, displayName: null, resolvedPath: null, dataLength: null },
        },
      ],
    }), sampleIndex);

    expect(plan.events[0]).toMatchObject({
      audioUrl: "output/Extra/R1HG0099.wav",
      resolved: true,
      displayLabel: "#1593",
    });
  });
});

describe("lanesForMix", () => {
  function makeBare(format: "A" | "B" | "C" | "D"): MixIR {
    return {
      format,
      product: "Test",
      appId: 0,
      bpm: 120,
      bpmAdjusted: null,
      author: null,
      title: null,
      registration: null,
      mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
      drumMachine: null,
      tickerText: [],
      catalogs: [],
      tracks: [],
    };
  }

  it("returns 8 lanes for Format A (Gen 1)", () => {
    const lanes = lanesForMix(makeBare("A"));
    expect(lanes).toHaveLength(8);
    expect(lanes[0]).toEqual({ id: "lane-0", index: 0, label: "Lane 1" });
    expect(lanes[7]).toEqual({ id: "lane-7", index: 7, label: "Lane 8" });
  });

  it("returns 17 lanes for Format B with the 17th labelled User Perc.", () => {
    const lanes = lanesForMix(makeBare("B"));
    expect(lanes).toHaveLength(17);
    expect(lanes[16]).toEqual({ id: "lane-16", index: 16, label: "User Perc." });
  });

  it("returns 32 lanes for Format C and Format D (Gen 3+)", () => {
    expect(lanesForMix(makeBare("C"))).toHaveLength(32);
    expect(lanesForMix(makeBare("D"))).toHaveLength(32);
  });
});

describe("buildMixPlaybackPlan list-view fallback", () => {
  it("emits a plan with null loopBeats and 32 canonical lanes for a Format C mix with no beats", () => {
    const plan = buildMixPlaybackPlan({
      format: "C",
      product: "Dance_eJay3",
      appId: 0x00002571,
      bpm: 130,
      bpmAdjusted: null,
      author: null,
      title: null,
      registration: null,
      mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
      drumMachine: null,
      tickerText: [],
      catalogs: [],
      tracks: [
        {
          beat: null,
          channel: null,
          sampleRef: {
            rawId: 0,
            internalName: null,
            displayName: "kick28",
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
    });

    expect(plan.loopBeats).toBeNull();
    expect(plan.timelineRecovered).toBe(false);
    expect(plan.lanes).toHaveLength(32);
    expect(plan.events).toHaveLength(1);
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
    dm.setPad("kick", { buffer: makeAudioBuffer(), semitones: 0 });
    const src = dm.trigger("kick", 0.5);
    expect(src).not.toBeNull();
    expect(src?.playbackRate.value).toBe(1);
    expect(src?.start).toHaveBeenCalledWith(0.5);
  });

  it("applies pitch and per-pad gain when configured", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("snare", { buffer: makeAudioBuffer(), semitones: 12, gain: 0.3 });
    const src = dm.trigger("snare", 0);
    expect(src?.playbackRate.value).toBeCloseTo(2);
    expect(dm.padCount).toBe(1);
  });

  it("clamps negative pad gain to zero", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("hat", { buffer: makeAudioBuffer(), gain: -5 });
    expect(dm.trigger("hat", 0)).not.toBeNull();
  });

  it("dispose clears all registered pads", () => {
    const ctx = makeCtx();
    const dm = new DrumMachine(ctx, ctx.destination);
    dm.setPad("kick", { buffer: makeAudioBuffer() });
    dm.setPad("snare", { buffer: makeAudioBuffer() });
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
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "bass" });
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 2, channelId: "bass", semitones: 7 });
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
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "ghost" });
    expect(host.play(120)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith("Skipping scheduled sample for unknown channel: ghost");
    warnSpy.mockRestore();
  });

  it("stops active sources and clears them", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    host.registerChannel("drum");
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "drum" });
    host.play(140);
    host.stop();
    expect(host.isPlaying).toBe(false);
  });

  it("clear() empties the schedule queue as well", () => {
    const ctx = makeCtx();
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "bass" });
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
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "drum" });
    host.play(120);
    expect(() => host.stop()).not.toThrow();
  });

  it("does not call stop() when durationBeats is omitted so sources play to natural end", () => {
    const ctx = makeCtx();
    const sources: AudioBufferSourceNodeLike[] = [];
    ctx.createBufferSource = () => {
      const src: AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => {},
        disconnect: () => {},
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(src);
      return src;
    };
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    // No durationBeats → source should start but never be hard-stopped.
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "bass" });
    host.play(120, 0);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.start).toHaveBeenCalledOnce();
    expect(sources[0]?.stop).not.toHaveBeenCalled();
  });

  it("schedules a hard stop when durationBeats is provided so lanes stay monophonic", () => {
    const ctx = makeCtx();
    const sources: AudioBufferSourceNodeLike[] = [];
    ctx.createBufferSource = () => {
      const src: AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => {},
        disconnect: () => {},
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(src);
      return src;
    };
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    // 120 BPM → 1 beat = 0.5s. Schedule at beat 4 with a 2-beat length;
    // expect stop() to be called at startAt + 4*0.5 + 2*0.5 = 13s.
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 4, channelId: "bass", durationBeats: 2 });
    host.play(120, 10);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.start).toHaveBeenCalledWith(12);
    expect(sources[0]?.stop).toHaveBeenCalledWith(13);
  });

  it("ignores stop-scheduling errors when truncating with durationBeats", () => {
    const ctx = makeCtx();
    ctx.createBufferSource = () => ({
      buffer: null,
      playbackRate: { value: 1 },
      connect: () => {},
      disconnect: () => {},
      start: vi.fn(),
      stop: () => { throw new Error("scheduled stop unsupported"); },
    });
    const host = new MixPlayerHost(ctx);
    host.registerChannel("bass");
    host.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "bass", durationBeats: 1 });
    expect(() => host.play(120, 0)).not.toThrow();
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
