import { describe, expect, it } from "vitest";

import {
  activeSortKeys,
  categoryConfigsEqual,
  embeddedMixSamplesFromManifest,
  gridSortKeyLabel,
  humanizeIdentifier,
  mergeSamplesByAudioPath,
  sampleAudioPath,
  sampleDisambiguationLine,
  sampleMatchesSearchQuery,
  sampleMetadataLine,
  sampleTooltip,
  sortSamplesByKey,
} from "../data.js";

describe("sampleAudioPath", () => {
  it("encodes category, subcategory, and filename segments", () => {
    expect(sampleAudioPath({
      filename: "Come on!.wav",
      category: "Voice",
      subcategory: "rap male",
    })).toBe("output/Voice/rap%20male/Come%20on!.wav");
  });

  it("encodes & and + in path segments", () => {
    expect(sampleAudioPath({
      filename: "Drum&Bass_160bpm_SNTHBASS001_D+B_160_C_ST.wav",
      category: "Bass",
    })).toBe("output/Bass/Drum%26Bass_160bpm_SNTHBASS001_D%2BB_160_C_ST.wav");
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

describe("sampleDisambiguationLine", () => {
  it("joins internal name and sample id for duplicate-name disambiguation", () => {
    expect(sampleDisambiguationLine({ internal_name: "D5MA060", sample_id: 1512 })).toBe("D5MA060 \u00B7 #1512");
  });

  it("omits missing provenance fields", () => {
    expect(sampleDisambiguationLine({ sample_id: 42 })).toBe("#42");
  });
});

describe("sampleTooltip", () => {
  it("includes provenance lines after the main metadata summary", () => {
    expect(sampleTooltip({
      filename: "D5MA060.wav",
      alias: "Kick 3",
      product: "Dance_eJay2",
      bpm: 140,
      beats: 4,
      detail: "euro",
      internal_name: "D5MA060",
      sample_id: 1512,
      source: "DANCE20/D5MA060",
    })).toBe([
      "Kick 3",
      "Dance eJay2 \u00B7 140 BPM \u00B7 4b \u00B7 euro",
      "Internal: D5MA060",
      "Sample ID: 1512",
      "Source: DANCE20/D5MA060",
    ].join("\n"));
  });

  it("summarizes deduped embedded MIX provenance", () => {
    expect(sampleTooltip({
      filename: "Kick01.wav",
      product: "Embedded MIX",
      detail: "2 mix sources",
      source: "E:\\samples\\_eJay\\Kick01.wav",
      source_mix: "Needles - Dance3.mix",
      source_mixes: ["Needles - Dance3.mix", "Waterworld Full - Dance3.mix"],
      embedded_paths: [
        "E:\\samples\\_eJay\\Kick01.wav",
        "D:\\eJay\\Dance3\\MIXWAVES\\Kick01.wav",
        "C:\\Temp\\Kick01.wav",
        "F:\\Backup\\Kick01.wav",
      ],
      dedupe_count: 2,
    })).toBe([
      "Kick01",
      "Embedded MIX \u00B7 2 mix sources",
      "Source: E:\\samples\\_eJay\\Kick01.wav",
      "Mixes: Needles - Dance3.mix; Waterworld Full - Dance3.mix",
      "Embedded Paths: E:\\samples\\_eJay\\Kick01.wav; D:\\eJay\\Dance3\\MIXWAVES\\Kick01.wav; C:\\Temp\\Kick01.wav (+1 more)",
      "Embedded Copies: 2",
    ].join("\n"));
  });
});

describe("embeddedMixSamplesFromManifest", () => {
  it("groups multiple manifest entries by canonical output path", () => {
    const samples = embeddedMixSamplesFromManifest({
      outDir: "D:\\dev\\eJay\\output\\Unsorted",
      extractions: [
        {
          mixPath: "D:\\archive\\Needles - Dance3.mix",
          embeddedPath: "E:\\samples\\_eJay\\Kick01.wav",
          outputPath: "D:\\dev\\eJay\\output\\Unsorted\\embedded mix\\Kick01.wav",
          sampleRate: 44100,
          channels: 2,
          bitDepth: 16,
          duration: 1.5,
          dedupeKept: true,
        },
        {
          mixPath: "D:\\archive\\Waterworld Full - Dance3.mix",
          embeddedPath: "D:\\eJay\\Dance3\\MIXWAVES\\Kick01.wav",
          outputPath: "D:\\dev\\eJay\\output\\Unsorted\\embedded mix\\Kick01.wav",
          sampleRate: 44100,
          channels: 2,
          bitDepth: 16,
          duration: 1.5,
        },
      ],
    });

    expect(samples).toEqual([
      expect.objectContaining({
        filename: "Kick01.wav",
        alias: "Kick01",
        category: "Unsorted",
        subcategory: "embedded mix",
        product: "Embedded MIX",
        detail: "2 mix sources",
        source: "E:\\samples\\_eJay\\Kick01.wav",
        source_mix: "Needles - Dance3.mix",
        source_mixes: ["Needles - Dance3.mix", "Waterworld Full - Dance3.mix"],
        embedded_paths: [
          "E:\\samples\\_eJay\\Kick01.wav",
          "D:\\eJay\\Dance3\\MIXWAVES\\Kick01.wav",
        ],
        dedupe_count: 2,
        sample_rate: 44100,
        channels: 2,
        bit_depth: 16,
        // duration_sec and beats are computed from the manifest duration field
        duration_sec: 1.5,
        beats: 4, // Math.round(1.5 * 140 / 60) = 4
      }),
    ]);
  });

  it("computes beats proportional to duration using 140 BPM", () => {
    const makeExtraction = (duration: number, outputPath: string) => ({
      mixPath: "D:\\archive\\test.mix",
      embeddedPath: `E:\\samples\\${outputPath}`,
      outputPath: `D:\\dev\\eJay\\output\\Unsorted\\embedded mix\\${outputPath}`,
      duration,
      dedupeKept: true,
    });

    const samples = embeddedMixSamplesFromManifest({
      outDir: "D:\\dev\\eJay\\output\\Unsorted",
      extractions: [
        makeExtraction(3.4286, "loop8b.wav"),   // 8 beats @ 140 BPM
        makeExtraction(6.8571, "loop16b.wav"),  // 16 beats @ 140 BPM
        makeExtraction(13.7143, "loop32b.wav"), // 32 beats @ 140 BPM
      ],
    });

    expect(samples.find(s => s.filename === "loop8b.wav")?.beats).toBe(8);
    expect(samples.find(s => s.filename === "loop16b.wav")?.beats).toBe(16);
    expect(samples.find(s => s.filename === "loop32b.wav")?.beats).toBe(32);
  });

  it("leaves beats undefined when duration is absent", () => {
    const samples = embeddedMixSamplesFromManifest({
      outDir: "D:\\dev\\eJay\\output\\Unsorted",
      extractions: [
        {
          mixPath: "D:\\archive\\test.mix",
          embeddedPath: "E:\\samples\\nodur.wav",
          outputPath: "D:\\dev\\eJay\\output\\Unsorted\\embedded mix\\nodur.wav",
          dedupeKept: true,
        },
      ],
    });

    expect(samples[0]?.beats).toBeUndefined();
    expect(samples[0]?.duration_sec).toBeUndefined();
  });
});

describe("mergeSamplesByAudioPath", () => {
  it("overlays manifest provenance onto an existing scanned sample entry", () => {
    const merged = mergeSamplesByAudioPath(
      [{
        filename: "Kick01.wav",
        category: "Unsorted",
        subcategory: "embedded mix",
        alias: "Kick 01",
      }],
      [{
        filename: "Kick01.wav",
        category: "Unsorted",
        subcategory: "embedded mix",
        product: "Embedded MIX",
        detail: "2 mix sources",
      }],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        filename: "Kick01.wav",
        alias: "Kick 01",
        product: "Embedded MIX",
        detail: "2 mix sources",
      }),
    ]);
  });
});

describe("sampleMatchesSearchQuery", () => {
  const sample = {
    filename: "bass-loop.wav",
    alias: "D+B Bass Loop",
    category: "Bass",
    product: "GenerationPack1_Rave",
    bpm: 180,
    beats: 4,
    detail: "Drum&Bass",
  };

  it("returns true for empty and blank queries", () => {
    expect(sampleMatchesSearchQuery(sample, "")).toBe(true);
    expect(sampleMatchesSearchQuery(sample, "   ")).toBe(true);
  });

  it("matches a single term against the display name", () => {
    expect(sampleMatchesSearchQuery(sample, "loop")).toBe(true);
  });

  it("matches multiple terms across the display name and metadata", () => {
    expect(sampleMatchesSearchQuery(sample, "bass 180")).toBe(true);
    expect(sampleMatchesSearchQuery(sample, "drum&bass generationpack1")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(sampleMatchesSearchQuery(sample, "D+B RAVE")).toBe(true);
  });

  it("handles special characters and rejects missing terms", () => {
    expect(sampleMatchesSearchQuery(sample, "d+b")).toBe(true);
    expect(sampleMatchesSearchQuery(sample, "d+b techno")).toBe(false);
  });
});

describe("gridSortKeyLabel", () => {
  it("returns human-readable labels for all known keys", () => {
    expect(gridSortKeyLabel("name")).toBe("Name");
    expect(gridSortKeyLabel("bpm")).toBe("BPM");
    expect(gridSortKeyLabel("beats")).toBe("Sample Length");
    expect(gridSortKeyLabel("product")).toBe("Product");
    expect(gridSortKeyLabel("detail")).toBe("Detail");
    expect(gridSortKeyLabel("subcategory")).toBe("Subcategory");
    expect(gridSortKeyLabel("source")).toBe("Source");
  });
});

describe("sortSamplesByKey", () => {
  const a = { filename: "a.wav", alias: "Alpha", category: "Drum", product: "Rave", bpm: 140, beats: 8, detail: "kick", subcategory: "kick", source: "SRC_A" };
  const b = { filename: "b.wav", alias: "Beta", category: "Drum", product: "Dance", bpm: 90, beats: 4, detail: "snare", subcategory: "snare", source: "SRC_B" };
  const c = { filename: "c.wav", alias: "Gamma", category: "Bass", product: "HipHop", bpm: 180, beats: 16, detail: "bass", subcategory: "bass", source: "SRC_C" };

  it("sorts by name ascending", () => {
    const sorted = sortSamplesByKey([c, a, b], "name", "asc");
    expect(sorted.map(s => s.alias)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("sorts by name descending", () => {
    const sorted = sortSamplesByKey([a, b, c], "name", "desc");
    expect(sorted.map(s => s.alias)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("sorts by bpm ascending", () => {
    const sorted = sortSamplesByKey([a, b, c], "bpm", "asc");
    expect(sorted.map(s => s.bpm)).toEqual([90, 140, 180]);
  });

  it("sorts by beats descending", () => {
    const sorted = sortSamplesByKey([a, b, c], "beats", "desc");
    expect(sorted.map(s => s.beats)).toEqual([16, 8, 4]);
  });

  it("sorts by product ascending", () => {
    const sorted = sortSamplesByKey([c, a, b], "product", "asc");
    expect(sorted.map(s => s.product)).toEqual(["Dance", "HipHop", "Rave"]);
  });

  it("sorts by detail ascending", () => {
    const sorted = sortSamplesByKey([a, b, c], "detail", "asc");
    expect(sorted.map(s => s.detail)).toEqual(["bass", "kick", "snare"]);
  });

  it("sorts by subcategory ascending", () => {
    const sorted = sortSamplesByKey([a, b, c], "subcategory", "asc");
    expect(sorted.map(s => s.subcategory)).toEqual(["bass", "kick", "snare"]);
  });

  it("sorts by source ascending", () => {
    const sorted = sortSamplesByKey([c, b, a], "source", "asc");
    expect(sorted.map(s => s.source)).toEqual(["SRC_A", "SRC_B", "SRC_C"]);
  });

  it("falls back to name when primary key values are equal", () => {
    const x = { filename: "x.wav", alias: "Zebra", category: "Drum", product: "Rave", bpm: 140, beats: 8, detail: "kick", source: "SRC" };
    const y = { filename: "y.wav", alias: "Apple", category: "Drum", product: "Rave", bpm: 140, beats: 8, detail: "kick", source: "SRC" };
    const sorted = sortSamplesByKey([x, y], "bpm", "asc");
    expect(sorted.map(s => s.alias)).toEqual(["Apple", "Zebra"]);
  });

  it("treats missing bpm as -1 for sorting purposes", () => {
    const noBpm = { filename: "n.wav", alias: "NoBpm", category: "Drum", product: "X", beats: 4, detail: "", source: "" };
    const withBpm = { filename: "w.wav", alias: "WithBpm", category: "Drum", product: "X", bpm: 50, beats: 4, detail: "", source: "" };
    const sorted = sortSamplesByKey([withBpm, noBpm], "bpm", "asc");
    expect(sorted[0].alias).toBe("NoBpm");
  });

  it("does not mutate the input array", () => {
    const input = [c, a, b];
    sortSamplesByKey(input, "name", "asc");
    expect(input.map(s => s.alias)).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});

describe("activeSortKeys", () => {
  it("always includes 'name'", () => {
    expect(activeSortKeys([])).toContain("name");
  });

  it("includes 'bpm' when at least one sample has a positive bpm", () => {
    const keys = activeSortKeys([{ filename: "a.wav", category: "Drum", product: "X", bpm: 140, beats: 4, detail: "", source: "" }]);
    expect(keys).toContain("bpm");
  });

  it("excludes 'bpm' when no sample has a positive bpm", () => {
    const keys = activeSortKeys([{ filename: "a.wav", category: "Drum", product: "X", bpm: 0, beats: 4, detail: "", source: "" }]);
    expect(keys).not.toContain("bpm");
  });

  it("includes 'beats' when at least one sample has a positive beats value", () => {
    const keys = activeSortKeys([{ filename: "a.wav", category: "Drum", product: "X", bpm: 0, beats: 8, detail: "", source: "" }]);
    expect(keys).toContain("beats");
  });

  it("includes 'product', 'detail', 'subcategory', and 'source' when populated", () => {
    const sample = { filename: "a.wav", category: "Drum", subcategory: "kick", product: "Rave", bpm: 0, beats: 0, detail: "euro", source: "SRC" };
    const keys = activeSortKeys([sample]);
    expect(keys).toContain("product");
    expect(keys).toContain("detail");
    expect(keys).toContain("subcategory");
    expect(keys).toContain("source");
  });
});