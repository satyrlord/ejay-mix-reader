import { describe, expect, it } from "vitest";

import { mixMetaFromIr } from "../mix-file-browser.js";
import type { MixIR } from "../../scripts/mix-types.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function makeMixIR(overrides: Partial<MixIR> = {}): MixIR {
  return {
    format: "A",
    product: "Dance_eJay1",
    appId: 0x10000001,
    bpm: 140,
    bpmAdjusted: null,
    author: null,
    title: null,
    registration: null,
    tracks: [],
    mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
    drumMachine: null,
    tickerText: [],
    catalogs: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* mixMetaFromIr                                                              */
/* -------------------------------------------------------------------------- */

describe("mixMetaFromIr", () => {
  it("returns undefined when ir is null", () => {
    expect(mixMetaFromIr(null)).toBeUndefined();
  });

  it("sets laneCount to 8 for Format A", () => {
    const meta = mixMetaFromIr(makeMixIR({ format: "A" }));
    expect(meta?.laneCount).toBe(8);
  });

  it("sets laneCount to 17 for Format B", () => {
    const meta = mixMetaFromIr(makeMixIR({ format: "B" }));
    expect(meta?.laneCount).toBe(17);
  });

  it("sets laneCount to 32 for Format C", () => {
    const meta = mixMetaFromIr(makeMixIR({ format: "C" }));
    expect(meta?.laneCount).toBe(32);
  });

  it("sets laneCount to 32 for Format D", () => {
    const meta = mixMetaFromIr(makeMixIR({ format: "D" }));
    expect(meta?.laneCount).toBe(32);
  });

  it("sets timelineRecovered to true when at least one track has a finite beat", () => {
    const meta = mixMetaFromIr(makeMixIR({
      tracks: [
        { beat: null, channel: null, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        { beat: 4, channel: 0, sampleRef: { rawId: 2, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
      ],
    }));
    expect(meta?.timelineRecovered).toBe(true);
  });

  it("sets timelineRecovered to false when all tracks have null beats", () => {
    const meta = mixMetaFromIr(makeMixIR({
      tracks: [
        { beat: null, channel: null, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        { beat: null, channel: null, sampleRef: { rawId: 2, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
      ],
    }));
    expect(meta?.timelineRecovered).toBe(false);
  });

  it("sets timelineRecovered to false when tracks is empty", () => {
    const meta = mixMetaFromIr(makeMixIR({ tracks: [] }));
    expect(meta?.timelineRecovered).toBe(false);
  });

  it("sets maxBeat to the highest finite beat when timeline is recovered", () => {
    const meta = mixMetaFromIr(makeMixIR({
      tracks: [
        { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        { beat: 12, channel: 1, sampleRef: { rawId: 2, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        { beat: 7, channel: 0, sampleRef: { rawId: 3, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
      ],
    }));
    expect(meta?.maxBeat).toBe(12);
  });

  it("does not set maxBeat when timeline is not recovered", () => {
    const meta = mixMetaFromIr(makeMixIR({
      tracks: [
        { beat: null, channel: null, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
      ],
    }));
    expect(meta?.maxBeat).toBeUndefined();
  });
});
