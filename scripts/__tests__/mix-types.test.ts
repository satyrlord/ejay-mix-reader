import { describe, expect, it } from "vitest";

import type {
  CatalogEntry,
  ChannelState,
  CompressorState,
  DrumEffectsChain,
  DrumMachineState,
  DrumPad,
  MixerState,
  MixFormat,
  MixIR,
  SampleRef,
  TrackPlacement,
} from "../mix-types.js";

// Re-import through the browser re-export to prove src/ can consume the
// shared schema without reaching into scripts/. If the paths ever drift,
// this file will fail to typecheck before the tests even run.
import type { MixIR as BrowserMixIR } from "../../src/mix-types.js";

describe("MixIR schema", () => {
  it("is a unified IR — one fully populated literal satisfies every interface", () => {
    const catalog: CatalogEntry = {
      name: "Dance eJay 2.0",
      idRangeStart: 0,
      idRangeEnd: 2844,
    };

    const sampleRef: SampleRef = {
      rawId: 42,
      internalName: "humn.9",
      displayName: "kick28",
      resolvedPath: "output/Dance_eJay2/Drum/kick28.wav",
      dataLength: 12345,
    };

    const placement: TrackPlacement = {
      beat: 0,
      channel: 3,
      sampleRef,
    };

    const channel: ChannelState = {
      index: 0,
      volume1: 100,
      volume2: 100,
      pan: 50,
      eq: 64,
      muted: false,
      solo: false,
    };

    const compressor: CompressorState = {
      drive: 40,
      gain: 60,
      speed: 20,
      enabled: true,
    };

    const mixer: MixerState = {
      channels: [channel],
      eq: [64, 64, 64, 64, 64, 64, 64, 64, 64, 64],
      compressor,
      stereoWide: 0,
      raw: { BOOU1: "100", MixPan: "50" },
    };

    const drumPad: DrumPad = {
      index: 1,
      name: "kick",
      volume: 100,
      pan: 50,
      pitch: 0,
      reversed: false,
      fx: "passive",
    };

    const drumEffects: DrumEffectsChain = {
      chorus: { drive: 0, speed: 0, enabled: false },
      echo: { time: 0, feedback: 0, volume: 0, enabled: false },
      eq: { low: 0, mid: 0, high: 0, enabled: false },
      overdrive: { drive: 0, filter: 0, enabled: false },
      reverb: { preDelay: 0, time: 0, volume: 0, enabled: false },
    };

    const drum: DrumMachineState = {
      pads: [drumPad],
      effects: drumEffects,
      masterVolume: 100,
    };

    const mix: MixIR = {
      format: "D" satisfies MixFormat,
      product: "HipHop_eJay4",
      appId: 0x0a08,
      bpm: 90,
      bpmAdjusted: null,
      author: "Test",
      title: "Demo",
      registration: "SK-TEST",
      tracks: [placement],
      mixer,
      drumMachine: drum,
      tickerText: ["hello"],
      catalogs: [catalog],
    };

    // Every field should round-trip through the browser re-export.
    const browser: BrowserMixIR = mix;
    expect(browser.format).toBe("D");
    expect(browser.tracks[0].sampleRef.resolvedPath).toContain("kick28");
    expect(browser.mixer.channels).toHaveLength(1);
    expect(browser.drumMachine?.pads).toHaveLength(1);
    expect(browser.catalogs[0].name).toBe("Dance eJay 2.0");
  });

  it("supports the minimal Format A shape (Gen 1 — no title/author/mixer detail)", () => {
    const minimal: MixIR = {
      format: "A",
      product: "Dance_eJay1",
      appId: 0x0a06,
      bpm: 140,
      bpmAdjusted: null,
      author: null,
      title: null,
      registration: null,
      tracks: [
        {
          beat: 0,
          channel: 0,
          sampleRef: {
            rawId: 7,
            internalName: null,
            displayName: null,
            resolvedPath: null,
            dataLength: null,
          },
        },
      ],
      mixer: {
        channels: [],
        eq: [],
        compressor: null,
        stereoWide: null,
        raw: {},
      },
      drumMachine: null,
      tickerText: [],
      catalogs: [],
    };

    expect(minimal.drumMachine).toBeNull();
    expect(minimal.author).toBeNull();
    expect(minimal.tracks[0].sampleRef.internalName).toBeNull();
  });

  it("accepts all four format discriminants", () => {
    const formats: MixFormat[] = ["A", "B", "C", "D"];
    expect(formats).toHaveLength(4);
  });
});
