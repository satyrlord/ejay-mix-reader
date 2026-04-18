import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { buildIndex, buildMixLibrary, buildSampleIndex, collectProductMixes, countWavFiles, deriveDisplayName, findMixSubdir, scanMixDir } from "../build-index.js";

describe("countWavFiles", () => {
  it("counts nested wav files recursively", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      mkdirSync(join(root, "Drum", "Perc"), { recursive: true });
      writeFileSync(join(root, "Drum", "kick.wav"), "a");
      writeFileSync(join(root, "Drum", "Perc", "shaker.wav"), "b");
      writeFileSync(join(root, "Drum", "Perc", "note.txt"), "c");

      expect(countWavFiles(root)).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 0 for missing directories", () => {
    expect(countWavFiles(join(tmpdir(), "build-index-does-not-exist-xyz"))).toBe(0);
  });
});

describe("deriveDisplayName", () => {
  it("converts underscores to spaces", () => {
    expect(deriveDisplayName("Dance_eJay1")).toBe("Dance eJay 1");
  });

  it("preserves DMKIT compaction", () => {
    expect(deriveDisplayName("SampleKit_DMKIT2")).toBe("SampleKit DMKIT2");
  });

  it("trims and collapses whitespace", () => {
    expect(deriveDisplayName("__Some_Name__")).toBe("Some Name");
  });
});

describe("buildIndex", () => {
  it("returns empty categories when outputDir does not exist", () => {
    const result = buildIndex(join(tmpdir(), "build-index-missing-xyz"));
    expect(result.categories).toEqual([]);
  });

  it("builds the normalized category list from the root metadata catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      mkdirSync(join(root, "Drum", "kick"), { recursive: true });
      mkdirSync(join(root, "Bass"), { recursive: true });
      writeFileSync(join(root, "Drum", "kick", "kick.wav"), "x");
      writeFileSync(join(root, "Bass", "deep.wav"), "x");
      writeFileSync(
        join(root, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "kick.wav", category: "Drum", subcategory: "kick" },
            { filename: "deep.wav", category: "Bass" },
          ],
        }),
      );

      const result = buildIndex(root);
      expect(result.categories[0].id).toBe("Loop");
      expect(result.categories.find((entry) => entry.id === "Drum")).toEqual(
        expect.objectContaining({
          sampleCount: 1,
          subcategories: ["kick", "snare", "clap", "toms", "crash", "hi-hats", "perc", "misc"],
        }),
      );
      expect(result.categories.find((entry) => entry.id === "Bass")).toEqual(
        expect.objectContaining({ sampleCount: 1, subcategories: ["unsorted"] }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to normalized category folder scanning when the root metadata is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      mkdirSync(join(root, "Drum", "kick"), { recursive: true });
      mkdirSync(join(root, "Voice", "misc"), { recursive: true });
      writeFileSync(join(root, "Drum", "kick", "a.wav"), "x");
      writeFileSync(join(root, "Drum", "kick", "b.wav"), "x");
      writeFileSync(join(root, "Voice", "misc", "vox.wav"), "x");

      const result = buildIndex(root);
      expect(result.categories.find((entry) => entry.id === "Drum")).toEqual(
        expect.objectContaining({ sampleCount: 2 }),
      );
      expect(result.categories.find((entry) => entry.id === "Voice")).toEqual(
        expect.objectContaining({ sampleCount: 1 }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores legacy per-product folders when scanning normalized categories", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      const legacyProduct = join(root, "Dance_eJay1");
      mkdirSync(join(legacyProduct, "Drum"), { recursive: true });
      writeFileSync(join(legacyProduct, "Drum", "legacy.wav"), "x");
      writeFileSync(join(legacyProduct, "metadata.json"), JSON.stringify({ samples: [{ filename: "legacy.wav" }] }));

      mkdirSync(join(root, "Bass"), { recursive: true });
      writeFileSync(join(root, "Bass", "bass.wav"), "x");

      const result = buildIndex(root);
      expect(result.categories.find((entry) => entry.id === "Bass")).toEqual(
        expect.objectContaining({ sampleCount: 1 }),
      );
      expect(result.categories.some((entry) => entry.id === "Dance_eJay1" && entry.sampleCount > 0)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("attaches a mixes[] array populated from the archive directory", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      const outputDir = join(root, "output");
      mkdirSync(join(outputDir, "Loop"), { recursive: true });
      writeFileSync(join(outputDir, "Loop", "loop.wav"), "x");
      writeFileSync(
        join(outputDir, "metadata.json"),
        JSON.stringify({ samples: [{ filename: "loop.wav", category: "Loop", product: "Dance_eJay1" }] }),
      );

      const archiveDir = join(root, "archive");
      const mixDir = join(archiveDir, "Dance_eJay1", "MIX");
      mkdirSync(mixDir, { recursive: true });
      const dance1Header = Buffer.from([0x06, 0x0a, 0x00, 0x00, 0x00, 0x00]);
      writeFileSync(join(mixDir, "START.MIX"), dance1Header);
      writeFileSync(join(mixDir, ".mix"), Buffer.from([0x00, 0x00])); // stub
      writeFileSync(join(mixDir, "garbage.mix"), Buffer.from("junk")); // unrecognised

      const result = buildIndex(outputDir, archiveDir);
      expect(result.categories.find((entry) => entry.id === "Loop")).toEqual(
        expect.objectContaining({ sampleCount: 1 }),
      );
      expect(result.mixLibrary).toEqual([
        {
          id: "Dance_eJay1",
          name: "Dance eJay 1",
          mixes: [{ filename: "START.MIX", sizeBytes: 6, format: "A" }],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits products from mixLibrary when the archive path is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      const outputDir = join(root, "output");
      mkdirSync(join(outputDir, "Bass"), { recursive: true });
      writeFileSync(join(outputDir, "Bass", "k.wav"), "x");

      const result = buildIndex(outputDir, join(root, "archive"));
      expect(result.categories.find((entry) => entry.id === "Bass")).toEqual(
        expect.objectContaining({ sampleCount: 1 }),
      );
      expect(result.mixLibrary).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a populated mixLibrary even when the output dir is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-"));
    try {
      const archiveDir = join(root, "archive");
      const mixDir = join(archiveDir, "Rave", "MIX");
      mkdirSync(mixDir, { recursive: true });
      writeFileSync(join(mixDir, "r.mix"), Buffer.from([0x07, 0x0a, 0, 0]));

      const result = buildIndex(join(root, "no-output"), archiveDir);
      expect(result.categories).toEqual([]);
      expect(result.mixLibrary.map(m => m.id)).toEqual(["Rave"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("findMixSubdir", () => {
  it("matches any case variant", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-mix-"));
    try {
      mkdirSync(join(root, "Mix"), { recursive: true });
      expect(findMixSubdir(root)).toBe(join(root, "Mix"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no mix folder is present", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-mix-"));
    try {
      mkdirSync(join(root, "Samples"), { recursive: true });
      expect(findMixSubdir(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for unreadable paths", () => {
    expect(findMixSubdir(join(tmpdir(), "build-index-no-such-dir-xyz"))).toBeNull();
  });

  it("ignores non-directory entries named mix", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-mix-"));
    try {
      writeFileSync(join(root, "MIX"), "not a folder");
      expect(findMixSubdir(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scanMixDir", () => {
  function writeMix(dir: string, name: string, appSigLowByte: number): void {
    writeFileSync(join(dir, name), Buffer.from([appSigLowByte, 0x0a, 0, 0, 0, 0]));
  }

  it("classifies Format A files by app signature and sorts by filename", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-"));
    try {
      writeMix(root, "z.mix", 0x07); // Rave
      writeMix(root, "a.mix", 0x06); // Dance 1
      const entries = scanMixDir(root);
      expect(entries.map(e => e.filename)).toEqual(["a.mix", "z.mix"]);
      expect(entries.every(e => e.format === "A")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects Format B/C/D via SKKENNUNG markers", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-"));
    try {
      // Format B: just SKKENNUNG, no mixer markers.
      writeFileSync(join(root, "b.mix"), "\x00\x00\x00\x00#SKKENNUNG#:abc");
      // Format C: BOOU present.
      writeFileSync(join(root, "c.mix"), "\x00\x00\x00\x00#SKKENNUNG#BOOU1");
      // Format D: MixVolume present.
      writeFileSync(join(root, "d.mix"), "\x00\x00\x00\x00#SKKENNUNG#MixVolume");
      const entries = scanMixDir(root);
      const byName = Object.fromEntries(entries.map(e => [e.filename, e.format]));
      expect(byName).toEqual({ "b.mix": "B", "c.mix": "C", "d.mix": "D" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips tiny files, non-mix entries, and unrecognised formats", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-"));
    try {
      writeFileSync(join(root, "tiny.mix"), Buffer.from([0x06, 0x0a])); // 2 bytes
      writeFileSync(join(root, "notes.txt"), "ignored");
      writeFileSync(join(root, "bad.mix"), Buffer.from("junkdata!")); // no sig, no SKKENNUNG
      writeMix(root, "good.mix", 0x08); // HipHop 1
      const entries = scanMixDir(root);
      expect(entries.map(e => e.filename)).toEqual(["good.mix"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty for missing directories", () => {
    expect(scanMixDir(join(tmpdir(), "build-index-scan-missing-xyz"))).toEqual([]);
  });

  it("skips subdirectories named *.mix", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-"));
    try {
      mkdirSync(join(root, "folder.mix"));
      const entries = scanMixDir(root);
      expect(entries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("collectProductMixes", () => {
  it("returns [] for products without a registered archive layout", () => {
    expect(collectProductMixes("Not_A_Real_Product", "/tmp/archive")).toEqual([]);
  });

  it("returns [] when the registered archive path is absent", () => {
    expect(collectProductMixes("Dance_eJay1", join(tmpdir(), "no-archive-xyz"))).toEqual([]);
  });

  it("returns [] when the product directory exists but the MIX sub-folder does not", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-coll-"));
    try {
      mkdirSync(join(root, "Dance_eJay1", "samples"), { recursive: true });
      expect(collectProductMixes("Dance_eJay1", root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildMixLibrary", () => {
  it("omits products with empty or missing MIX folders", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-lib-"));
    try {
      // Only Rave and HipHop_eJay2 get populated; everything else is missing.
      mkdirSync(join(root, "Rave", "MIX"), { recursive: true });
      writeFileSync(join(root, "Rave", "MIX", "a.mix"), Buffer.from([0x07, 0x0a, 0, 0]));
      mkdirSync(join(root, "HipHop 2", "MIX"), { recursive: true });
      writeFileSync(join(root, "HipHop 2", "MIX", "h.mix"), Buffer.from([0x08, 0x0a, 0, 0]));
      // Empty MIX dir for House_eJay — should be omitted entirely.
      mkdirSync(join(root, "House_eJay", "Mix"), { recursive: true });

      const library = buildMixLibrary(root);
      expect(library.map(e => e.id).sort()).toEqual(["HipHop_eJay2", "Rave"]);
      const rave = library.find(e => e.id === "Rave");
      expect(rave?.name).toBe("Rave");
      expect(rave?.mixes).toEqual([{ filename: "a.mix", sizeBytes: 4, format: "A" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns [] when no archive directory exists", () => {
    expect(buildMixLibrary(join(tmpdir(), "build-index-lib-missing-xyz"))).toEqual([]);
  });
});

describe("buildSampleIndex", () => {
  it("returns empty object when metadata.json is missing", () => {
    expect(buildSampleIndex(join(tmpdir(), "build-index-sample-missing-xyz"))).toEqual({});
  });

  it("returns empty object when metadata.json is corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-"));
    try {
      writeFileSync(join(root, "metadata.json"), "NOT JSON");
      expect(buildSampleIndex(root)).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty object when samples array is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({ tracks: [] }));
      expect(buildSampleIndex(root)).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds per-product lookups from metadata.json", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-"));
    try {
      const meta = {
        samples: [
          { filename: "kick.wav", alias: "Big Kick", category: "Drum", product: "Dance_eJay1", source: "dance\\kick.pxd" },
          { filename: "bass01.wav", category: "Bass", subcategory: "Deep", product: "Dance_eJay2" },
          { filename: "pad.wav", category: "Pads", product: "Dance_eJay1" },
          // Sample with no product — should be skipped
          { filename: "orphan.wav", category: "Loop" },
          // Sample with no filename — should be skipped
          { product: "Dance_eJay1", category: "Loop" },
          // Sample with no category — should be skipped
          { filename: "nocat.wav", product: "Dance_eJay1" },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(meta));

      const index = buildSampleIndex(root);
      expect(Object.keys(index)).toEqual(["Dance_eJay1", "Dance_eJay2"]);

      // Dance_eJay1
      const d1 = index.Dance_eJay1;
      expect(d1.byAlias["big kick"]).toBe("Drum/kick.wav");
      expect(d1.bySource["dance/kick.pxd"]).toBe("Drum/kick.wav");
      expect(d1.byStem["kick"]).toBe("Drum/kick.wav");
      expect(d1.byStem["pad"]).toBe("Pads/pad.wav");

      // Dance_eJay2 with subcategory
      const d2 = index.Dance_eJay2;
      expect(d2.byStem["bass01"]).toBe("Bass/Deep/bass01.wav");
      expect(Object.keys(d2.byAlias)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing stem entries (first-wins)", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-"));
    try {
      const meta = {
        samples: [
          { filename: "kick.wav", category: "Drum", product: "P1" },
          { filename: "kick.wav", category: "Loop", product: "P1" },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(meta));

      const index = buildSampleIndex(root);
      expect(index.P1.byStem["kick"]).toBe("Drum/kick.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});