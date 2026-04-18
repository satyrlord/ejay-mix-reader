import { describe, expect, it } from "vitest";

import { sampleAudioPath } from "../data.js";

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