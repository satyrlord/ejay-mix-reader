import { describe, expect, it } from "vitest";

import { categoryConfigsEqual, humanizeIdentifier, sampleAudioPath } from "../data.js";

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