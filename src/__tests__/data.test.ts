import { describe, expect, it } from "vitest";

import { categoryConfigsEqual, humanizeIdentifier, sampleAudioPath, sampleMetadataLine } from "../data.js";

describe("sampleAudioPath", () => {
  it("encodes category, subcategory, and filename segments", () => {
    expect(sampleAudioPath({
      filename: "Come on!.wav",
      category: "Voice",
      subcategory: "rap male",
    })).toBe("output/Voice/rap%20male/Come%20on!.wav");
  });

  it("rejects traversal-like file paths", () => {
    expect(() => sampleAudioPath({
      filename: "../secret.wav",
      category: "Drum",
      subcategory: "kick",
    })).toThrow(/Invalid sample filename/);
  });
});

describe("categoryConfigsEqual", () => {
  it("returns true for identical category configs", () => {
    expect(categoryConfigsEqual(
      {
        categories: [
          { id: "Drum", name: "Drum", subcategories: ["kick", "snare"] },
        ],
      },
      {
        categories: [
          { id: "Drum", name: "Drum", subcategories: ["kick", "snare"] },
        ],
      },
    )).toBe(true);
  });

  it("returns false when category order or contents differ", () => {
    expect(categoryConfigsEqual(
      {
        categories: [
          { id: "Drum", name: "Drum", subcategories: ["kick", "snare"] },
          { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
        ],
      },
      {
        categories: [
          { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
          { id: "Drum", name: "Drum", subcategories: ["kick", "snare"] },
        ],
      },
    )).toBe(false);
  });
});

describe("humanizeIdentifier", () => {
  it("adds spaces around trailing numbers", () => {
    expect(humanizeIdentifier("Dance_eJay1")).toBe("Dance eJay 1");
  });

  it("optionally compacts DMKIT identifiers", () => {
    expect(humanizeIdentifier("SampleKit_DMKIT2", { compactDmkit: true })).toBe("SampleKit DMKIT2");
  });
});

describe("sampleMetadataLine", () => {
  it("joins product, bpm, beats, and detail with middle dots", () => {
    expect(sampleMetadataLine({
      product: "Dance_eJay1",
      bpm: 140,
      beats: 8,
      detail: "Vers10",
    })).toBe("Dance eJay1 \u00B7 140 BPM \u00B7 8b \u00B7 Vers10");
  });

  it("returns empty string when no fields are present", () => {
    expect(sampleMetadataLine({})).toBe("");
  });

  it("omits zero or negative bpm and beats", () => {
    expect(sampleMetadataLine({ product: "Rave", bpm: 0, beats: -1 })).toBe("Rave");
  });

  it("shows only available fields", () => {
    expect(sampleMetadataLine({ bpm: 125 })).toBe("125 BPM");
  });

  it("handles a very long product name without truncation", () => {
    const longName = "A".repeat(200);
    const result = sampleMetadataLine({ product: longName });
    expect(result).toBe(longName);
  });

  it("handles an extremely high BPM value", () => {
    expect(sampleMetadataLine({ bpm: 99999 })).toBe("99999 BPM");
  });

  it("handles a combination of all fields at extreme values", () => {
    expect(sampleMetadataLine({
      product: "X".repeat(100),
      bpm: 9999,
      beats: 64,
      detail: "Z".repeat(100),
    })).toBe(`${"X".repeat(100)} \u00B7 9999 BPM \u00B7 64b \u00B7 ${"Z".repeat(100)}`);
  });

  it("replaces underscores with spaces in product name", () => {
    expect(sampleMetadataLine({ product: "Dance_eJay1" })).toBe("Dance eJay1");
  });
});