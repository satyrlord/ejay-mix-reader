import { describe, expect, it } from "vitest";

import type { Sample } from "../data.js";
import { computeSampleBrowserResult } from "../sample-browser-controller.js";

const samples: Sample[] = [
  { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4, product: "Dance_eJay1" },
  { filename: "snare.wav", alias: "Snare", category: "Drum", subcategory: "snare", bpm: 140, beats: 4, product: "Rave" },
  { filename: "riff.wav", alias: "Riff", category: "Bass", subcategory: "riff", bpm: 140, beats: 4, product: "Rave" },
];

describe("sample-browser-controller", () => {
  it("filters samples by category/subcategory/search and sorts", () => {
    const result = computeSampleBrowserResult({
      samples,
      categoryId: "Drum",
      subcategory: "kick",
      bpm: 140,
      availableSubcategories: ["kick", "snare"],
      searchQuery: "kic",
      gridSortKey: "name",
      gridSortDir: "asc",
      allowedProducts: null,
    });

    expect(result.visibleSamples).toHaveLength(1);
    expect(result.visibleSamples[0].filename).toBe("kick.wav");
  });

  it("applies product-mode filtering when allowed products are provided", () => {
    const result = computeSampleBrowserResult({
      samples,
      categoryId: "Drum",
      subcategory: "snare",
      bpm: 140,
      availableSubcategories: ["kick", "snare"],
      searchQuery: "",
      gridSortKey: "name",
      gridSortDir: "asc",
      allowedProducts: new Set(["Dance_eJay1"]),
    });

    expect(result.visibleSamples).toHaveLength(0);
  });
});
