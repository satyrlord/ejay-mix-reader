import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { buildIndex, buildMixLibrary, buildSampleIndex, buildUserdataMixLibrary, collectProductMixes, countWavFiles, deriveDisplayName, findMixSubdir, resolveProductArchivePath, resolveProductMixDir, scanMixDir, userdataGroupLabel } from "../build-index.js";

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
    const result = buildIndex(join(tmpdir(), "build-index-missing-xyz"), join(tmpdir(), "build-index-no-archive-xyz"));
    expect(result.categories).toEqual([]);
  });

  it("merges embedded MIX manifest samples into the generated categories", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-embedded-"));
    try {
      mkdirSync(join(root, "Loop"), { recursive: true });
      mkdirSync(join(root, "Unsorted", "embedded mix"), { recursive: true });
      writeFileSync(join(root, "Loop", "loop.wav"), "x");
      writeFileSync(join(root, "Unsorted", "embedded mix", "Kick01.wav"), "x");
      writeFileSync(
        join(root, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "loop.wav", category: "Loop" },
          ],
        }),
      );
      writeFileSync(
        join(root, "Unsorted", "embedded-mix-audio-manifest.json"),
        JSON.stringify({
          outDir: root + "\\Unsorted",
          extractions: [
            {
              mixPath: "D:\\archive\\Needles.mix",
              embeddedPath: "E:\\samples\\Kick01.wav",
              outputPath: join(root, "Unsorted", "embedded mix", "Kick01.wav"),
            },
          ],
        }),
      );

      const result = buildIndex(root, join(root, "archive"));
      expect(result.categories.find((entry) => entry.id === "Loop")).toEqual(
        expect.objectContaining({ sampleCount: 1 }),
      );
      expect(result.categories.find((entry) => entry.id === "Unsorted")).toEqual(
        expect.objectContaining({
          sampleCount: 1,
          subcategories: expect.arrayContaining(["embedded mix", "unsorted"]),
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

      const result = buildIndex(root, join(root, "archive"));
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

      const result = buildIndex(root, join(root, "archive"));
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

      const result = buildIndex(root, join(root, "archive"));
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
          mixes: [expect.objectContaining({ filename: "START.MIX", sizeBytes: 6, format: "A" })],
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

  it("still includes a file when parseMix returns null (truncated gen-2 header)", () => {
    // A Format-B stub: the SKKENNUNG marker is present (passes detectFormat)
    // but the buffer is < 16 bytes so parseGen23Header throws "Invalid Gen 2/3
    // MIX: truncated header", which parseMix converts to null. irToMeta(null)
    // returns null, so meta stays undefined — but the entry must still be
    // returned so the index is not silently truncated.
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-"));
    try {
      // 12 bytes: enough for SKKENNUNG detection, too few for gen-2/3 header.
      writeFileSync(join(root, "stub.mix"), Buffer.from("#SKKENNUNG#:X"));
      const entries = scanMixDir(root);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe("stub.mix");
      expect(entries[0].format).toBe("B");
      expect(entries[0].meta).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards productId to parseMix and still returns meta when productId is omitted", () => {
    // Format A file: Dance_eJay1 app signature (0x0706).
    const root = mkdtempSync(join(tmpdir(), "build-index-scan-pid-"));
    try {
      writeFileSync(join(root, "start.mix"), Buffer.from([0x06, 0x0a, 0, 0, 0, 0]));

      // With explicit productId: parseMix is called with the hint; meta must be populated.
      const withHint = scanMixDir(root, "Dance_eJay1");
      expect(withHint).toHaveLength(1);
      expect(withHint[0]!.meta).toBeDefined();
      expect(withHint[0]!.meta?.format).toBe("A");

      // Without productId: heuristic detection via app signature must produce equivalent meta.
      const withoutHint = scanMixDir(root);
      expect(withoutHint).toHaveLength(1);
      expect(withoutHint[0]!.meta?.format).toBe("A");
      expect(withoutHint[0]!.meta?.bpm).toBe(withHint[0]!.meta?.bpm);
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

  it("accepts recreated archive folder aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-coll-alias-"));
    try {
      mkdirSync(join(root, "Dance eJay 2", "MIX"), { recursive: true });
      writeFileSync(join(root, "Dance eJay 2", "MIX", "START.MIX"), Buffer.from("#SKKENNUNG#:abc"));

      const entries = collectProductMixes("Dance_eJay2", root);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.filename).toBe("START.MIX");
      expect(resolveProductArchivePath("Dance_eJay2", root)).toBe(join(root, "Dance eJay 2"));
      expect(resolveProductMixDir("Dance_eJay2", root)?.mixDir).toBe(join(root, "Dance eJay 2", "MIX"));
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
      expect(rave?.mixes).toEqual([expect.objectContaining({ filename: "a.mix", sizeBytes: 4, format: "A" })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns [] when no archive directory exists", () => {
    expect(buildMixLibrary(join(tmpdir(), "build-index-lib-missing-xyz"))).toEqual([]);
  });

  it("includes _userdata groups after product entries", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-lib-ud-"));
    try {
      // One product archive with a mix.
      mkdirSync(join(root, "Rave", "MIX"), { recursive: true });
      writeFileSync(join(root, "Rave", "MIX", "a.mix"), Buffer.from([0x07, 0x0a, 0, 0]));
      // One _userdata subfolder with a mix.
      mkdirSync(join(root, "_userdata", "mysets"), { recursive: true });
      writeFileSync(join(root, "_userdata", "mysets", "x.mix"), Buffer.from([0x06, 0x0a, 0, 0]));

      const library = buildMixLibrary(root);
      const ids = library.map(e => e.id);
      expect(ids).toContain("Rave");
      expect(ids).toContain("_userdata/mysets");
      // Product entries must precede userdata entries.
      expect(ids.indexOf("Rave")).toBeLessThan(ids.indexOf("_userdata/mysets"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes _user groups after product entries using canonical _userdata ids", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-lib-user-"));
    try {
      mkdirSync(join(root, "Rave", "MIX"), { recursive: true });
      writeFileSync(join(root, "Rave", "MIX", "a.mix"), Buffer.from([0x07, 0x0a, 0, 0]));
      mkdirSync(join(root, "_user", "mysets"), { recursive: true });
      writeFileSync(join(root, "_user", "mysets", "x.mix"), Buffer.from([0x06, 0x0a, 0, 0]));

      const library = buildMixLibrary(root);
      const ids = library.map(e => e.id);
      expect(ids).toContain("Rave");
      expect(ids).toContain("_userdata/mysets");
      expect(ids.indexOf("Rave")).toBeLessThan(ids.indexOf("_userdata/mysets"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("userdataGroupLabel", () => {
  it("prefixes with 'User: ' and humanizes segments", () => {
    expect(userdataGroupLabel(["Dance2"])).toBe("User: Dance 2");
  });

  it("strips leading underscores from segments", () => {
    expect(userdataGroupLabel(["_unsorted"])).toBe("User: unsorted");
  });

  it("applies DMKIT compaction to segments", () => {
    expect(userdataGroupLabel(["_DMKIT2"])).toBe("User: DMKIT2");
  });

  it("joins multiple segments with en-dash", () => {
    expect(userdataGroupLabel(["Dance and House", "Dance3"])).toBe("User: Dance and House \u2013 Dance 3");
  });
});

describe("buildUserdataMixLibrary", () => {
  it("returns [] when _userdata folder does not exist", () => {
    expect(buildUserdataMixLibrary(join(tmpdir(), "build-index-ud-missing-xyz"))).toEqual([]);
  });

  it("returns [] when archive has no _userdata subfolder", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "other"));
      expect(buildUserdataMixLibrary(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers a flat _userdata subfolder with mix files", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "_userdata", "mysets"), { recursive: true });
      writeFileSync(join(root, "_userdata", "mysets", "track.mix"), Buffer.from([0x06, 0x0a, 0, 0]));

      const library = buildUserdataMixLibrary(root);
      expect(library).toHaveLength(1);
      expect(library[0]!.id).toBe("_userdata/mysets");
      expect(library[0]!.name).toBe("User: mysets");
      expect(library[0]!.mixes).toEqual([expect.objectContaining({ filename: "track.mix", format: "A" })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers nested _userdata subfolders and creates separate groups", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "_userdata", "genre", "sub1"), { recursive: true });
      mkdirSync(join(root, "_userdata", "genre", "sub2"), { recursive: true });
      writeFileSync(join(root, "_userdata", "genre", "sub1", "a.mix"), Buffer.from([0x06, 0x0a, 0, 0]));
      writeFileSync(join(root, "_userdata", "genre", "sub2", "b.mix"), Buffer.from([0x07, 0x0a, 0, 0]));

      const library = buildUserdataMixLibrary(root);
      const ids = library.map(e => e.id).sort();
      expect(ids).toEqual(["_userdata/genre/sub1", "_userdata/genre/sub2"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to _user when _userdata is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "_user", "mysets"), { recursive: true });
      writeFileSync(join(root, "_user", "mysets", "track.mix"), Buffer.from([0x06, 0x0a, 0, 0]));

      const library = buildUserdataMixLibrary(root);
      expect(library).toHaveLength(1);
      expect(library[0]!.id).toBe("_userdata/mysets");
      expect(library[0]!.name).toBe("User: mysets");
      expect(library[0]!.mixes).toEqual([expect.objectContaining({ filename: "track.mix", format: "A" })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips subdirs that contain no valid mix files", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "_userdata", "empty"), { recursive: true });
      writeFileSync(join(root, "_userdata", "empty", "notes.txt"), "not a mix");

      expect(buildUserdataMixLibrary(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips the _userdata root itself even if it directly contains mix files", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      mkdirSync(join(root, "_userdata"), { recursive: true });
      writeFileSync(join(root, "_userdata", "direct.mix"), Buffer.from([0x06, 0x0a, 0, 0]));

      // Root-level files are not a named group — no relParts.
      expect(buildUserdataMixLibrary(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("results are sorted alphabetically by relative path", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-ud-"));
    try {
      for (const name of ["zzz", "aaa", "mmm"]) {
        mkdirSync(join(root, "_userdata", name), { recursive: true });
        writeFileSync(join(root, "_userdata", name, "x.mix"), Buffer.from([0x06, 0x0a, 0, 0]));
      }

      const library = buildUserdataMixLibrary(root);
      expect(library.map(e => e.id)).toEqual(["_userdata/aaa", "_userdata/mmm", "_userdata/zzz"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      expect(Object.keys(d1.byGen1Id ?? {})).toHaveLength(0);
      expect(Object.keys(d1.byInternalName)).toHaveLength(0);
      expect(Object.keys(d1.bySampleId)).toHaveLength(0);

      // Dance_eJay2 with subcategory
      const d2 = index.Dance_eJay2;
      expect(d2.byStem["bass01"]).toBe("Bass/Deep/bass01.wav");
      expect(Object.keys(d2.byAlias)).toHaveLength(0);
      expect(Object.keys(d2.byGen1Id ?? {})).toHaveLength(0);
      expect(Object.keys(d2.byInternalName)).toHaveLength(0);
      expect(Object.keys(d2.bySampleId)).toHaveLength(0);
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
      expect(Object.keys(index.P1.byGen1Id ?? {})).toHaveLength(0);
      expect(Object.keys(index.P1.byInternalName)).toHaveLength(0);
      expect(Object.keys(index.P1.bySampleId)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes embedded MIX manifest samples as synthetic catalog entries", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-embedded-"));
    try {
      mkdirSync(join(root, "Unsorted", "embedded mix"), { recursive: true });
      writeFileSync(join(root, "Unsorted", "embedded mix", "Kick01.wav"), "x");
      writeFileSync(
        join(root, "Unsorted", "embedded-mix-audio-manifest.json"),
        JSON.stringify({
          outDir: root + "\\Unsorted",
          extractions: [
            {
              mixPath: "D:\\archive\\Needles.mix",
              embeddedPath: "E:\\samples\\Kick01.wav",
              outputPath: join(root, "Unsorted", "embedded mix", "Kick01.wav"),
            },
          ],
        }),
      );

      const index = buildSampleIndex(root);
      expect(index["Embedded MIX"].byStem["kick01"]).toBe("Unsorted/embedded mix/Kick01.wav");
      expect(index["Embedded MIX"].bySource["e:/samples/kick01.wav"]).toBe("Unsorted/embedded mix/Kick01.wav");
      expect(Object.keys(index["Embedded MIX"].byGen1Id ?? {})).toHaveLength(0);
      expect(Object.keys(index["Embedded MIX"].byInternalName)).toHaveLength(0);
      expect(Object.keys(index["Embedded MIX"].bySampleId)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes internal names and numeric sample ids when metadata provides them", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-extra-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "kick.wav",
            alias: "Kick One",
            category: "Drum",
            product: "Dance_eJay2",
            internal_name: "D5MG539",
            sample_id: 1930,
          },
        ],
      }));

      const index = buildSampleIndex(root);
      expect(index.Dance_eJay2.byInternalName["d5mg539"]).toBe("Drum/kick.wav");
      expect(index.Dance_eJay2.bySampleId["1930"]).toBe("Drum/kick.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads Dance_eJay2 compound aliases from the D_EJAY2 INF path variant", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "build-index-sample-dance2-inf-alias-output-"));
    const archiveRoot = mkdtempSync(join(tmpdir(), "build-index-sample-dance2-inf-alias-archive-"));
    try {
      writeFileSync(join(outputRoot, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "kick.wav",
            category: "Drum",
            product: "Dance_eJay2",
            internal_name: "D5MA066",
          },
        ],
      }));

      const infDir = join(archiveRoot, "Dance eJay 2", "D_EJAY2", "PXD");
      const infPath = join(infDir, "DANCE20.INF");
      mkdirSync(infDir, { recursive: true });
      writeFileSync(
        infPath,
        [
          "[SAMPLES]",
          "1",
          "0",
          '"D5MA066"',
          "0",
          "128",
          '"euro"',
          '"kick5"',
          "0",
          "0",
          "0",
          "0",
          "0",
        ].join("\r\n"),
        "ascii",
      );

      const index = buildSampleIndex(outputRoot, archiveRoot);
      expect(index.Dance_eJay2.byInternalName["eurokick5"]).toBe("Drum/kick.wav");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it("populates byPath with alias / internal_name / stem fallbacks for label lookup", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-bypath-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          { filename: "kick.wav", alias: "Big Kick", category: "Drum", product: "P1" },
          { filename: "snare.wav", internal_name: "D5SN001", category: "Drum", product: "P1" },
          { filename: "pad.wav", category: "Pads", product: "P1" },
          { filename: "oneshot", category: "Extra", product: "P1" },
        ],
      }));

      const index = buildSampleIndex(root);
      expect(index.P1.byPath?.["Drum/kick.wav"]).toBe("Big Kick");
      expect(index.P1.byPath?.["Drum/snare.wav"]).toBe("D5SN001");
      expect(index.P1.byPath?.["Pads/pad.wav"]).toBe("pad");
      expect(index.P1.byPath?.["Extra/oneshot"]).toBe("oneshot");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("populates byPathBeats from valid sample beat metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-bypath-beats-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          { filename: "kick.wav", category: "Drum", product: "P1", beats: 4 },
          { filename: "snare.wav", category: "Drum", product: "P1", beats: 0 },
          { filename: "hat.wav", category: "Drum", product: "P1", beats: -2 },
        ],
      }));

      const index = buildSampleIndex(root);
      expect(index.P1.byPathBeats?.["Drum/kick.wav"]).toBe(4);
      expect(index.P1.byPathBeats?.["Drum/snare.wav"]).toBeUndefined();
      expect(index.P1.byPathBeats?.["Drum/hat.wav"]).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing byPath entry for the same relPath", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-bypath-nooverwrite-"));
    try {
      // Two samples with the same filename and category end up at the same
      // relPath. The first one (alias present) must win; the second must not
      // clobber the existing label.
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          { filename: "kick.wav", alias: "First Kick", category: "Drum", product: "P1" },
          { filename: "kick.wav", internal_name: "Should Not Win", category: "Drum", product: "P1" },
        ],
      }));

      const index = buildSampleIndex(root);
      expect(index.P1.byPath?.["Drum/kick.wav"]).toBe("First Kick");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes source basenames into byStem for catalog fallback matching", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-source-stem-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "Dance_SuperPack__D6BS003.WAV",
            category: "Bass",
            product: "Dance_SuperPack",
            source: "AA/D6BS003.PXD",
          },
        ],
      }));

      const index = buildSampleIndex(root);
      expect(index.Dance_SuperPack.byStem["d6bs003"]).toBe("Bass/Dance_SuperPack__D6BS003.WAV");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes Gen 1 raw ids from MAX catalogs", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-gen1-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "kick.wav",
            category: "Drum",
            product: "Dance_eJay1",
            source: "AA/KICK.PXD",
          },
        ],
      }));

      const archiveDir = join(root, "archive");
      const danceDir = join(archiveDir, "Dance eJay 1", "dance", "EJAY");
      mkdirSync(danceDir, { recursive: true });
      writeFileSync(join(danceDir, "MAX"), ['""', '"AA\\KICK.PXD"', ""].join("\r\n"));

      const index = buildSampleIndex(root, archiveDir);
      expect(index.Dance_eJay1.byGen1Id?.["1"]).toBe("Drum/kick.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers Rave PXD row-id mapping over conflicting MAX ids", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-rave-pxd-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "right.wav",
            category: "Bass",
            product: "Rave",
            source: "BH\\R1BS071.PXD",
          },
          {
            filename: "wrong.wav",
            category: "Voice",
            product: "Rave",
            source: "AA\\WRONG.PXD",
          },
          {
            filename: "low.wav",
            category: "Loop",
            product: "Rave",
            source: "AA\\LOW.PXD",
          },
        ],
      }));

      const archiveDir = join(root, "archive");
      const raveDir = join(archiveDir, "Rave eJay", "eJay", "eJay");
      mkdirSync(raveDir, { recursive: true });

      const maxLines = Array.from({ length: 802 }, () => '""');
      maxLines[1] = '"AA\\LOW.PXD"';
      // Intentionally conflicting MAX mapping: raw id 801 points at WRONG.PXD.
      maxLines[801] = '"AA\\WRONG.PXD"';
      writeFileSync(join(raveDir, "MAX"), maxLines.join("\r\n"));

      const pxdLines: string[] = [];
      for (let i = 0; i <= 70; i += 1) {
        const path = i === 70
          ? "BH\\R1BS071.PXD"
          : `ZZ\\DUMMY${String(i).padStart(3, "0")}.PXD`;
        pxdLines.push(`"${path}"`, '""', '"loop"', '"1"', '"Grp. 1"', '"Vers1"');
      }
      writeFileSync(join(raveDir, "PXD"), pxdLines.join("\r\n"));

      const index = buildSampleIndex(root, archiveDir);
      // 801 = 731 + 70; must resolve via PXD row mapping, not the MAX line.
      expect(index.Rave.byGen1Id?.["801"]).toBe("Bass/right.wav");
      // MAX fallback still applies to low ids not covered by the PXD row offset.
      expect(index.Rave.byGen1Id?.["1"]).toBe("Loop/low.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers Dance eJay 1 transformed Pxddance row-id mapping over conflicting MAX ids", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-dance1-pxddance-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "right.wav",
            category: "Extra",
            product: "Dance_eJay1",
            source: "BI\\ANLF.PXD",
          },
          {
            filename: "wrong.wav",
            category: "Extra",
            product: "Dance_eJay1",
            source: "AH\\BTQR.PXD",
          },
          {
            filename: "low.wav",
            category: "Loop",
            product: "Dance_eJay1",
            source: "AA\\LOW.PXD",
          },
        ],
      }));

      const archiveDir = join(root, "archive");
      const danceDir = join(archiveDir, "Dance eJay 1", "eJay", "eJay");
      mkdirSync(danceDir, { recursive: true });

      const maxLines = Array.from({ length: 1187 }, () => '""');
      maxLines[1] = '"AA\\LOW.PXD"';
      // Intentionally conflicting MAX mapping: raw id 1186 points at AH/BTQR.
      maxLines[1186] = '"AH\\BTQR.PXD"';
      writeFileSync(join(danceDir, "MAX"), maxLines.join("\r\n"));

      const pxdDanceLines: string[] = [];
      for (let i = 0; i <= 455; i += 1) {
        const path = i === 455
          ? "BI\\ANLF.PXD"
          : `ZZ\\DUMMY${String(i).padStart(3, "0")}.PXD`;
        pxdDanceLines.push(`"${path}"`, '""', '"loop"', '"1"', '"Grp. 1"', '"Vers1"');
      }
      writeFileSync(join(danceDir, "Pxddance"), pxdDanceLines.join("\r\n"));

      const index = buildSampleIndex(root, archiveDir);
      // 1186 = 731 + 455; must resolve via transformed Pxddance row mapping.
      expect(index.Dance_eJay1.byGen1Id?.["1186"]).toBe("Extra/right.wav");
      // MAX fallback still applies to low ids outside the transformed window.
      expect(index.Dance_eJay1.byGen1Id?.["1"]).toBe("Loop/low.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers HipHop eJay 1 transformed PXD row-id mapping over conflicting MAX ids", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-hiphop1-pxd-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "right.wav",
            category: "Bass",
            product: "HipHop_eJay1",
            source: "BR\\H1BS006.PXD",
          },
          {
            filename: "wrong.wav",
            category: "Extra",
            product: "HipHop_eJay1",
            source: "AA\\WRONG.PXD",
          },
          {
            filename: "low.wav",
            category: "Loop",
            product: "HipHop_eJay1",
            source: "AA\\LOW.PXD",
          },
        ],
      }));

      const archiveDir = join(root, "archive");
      const hiphopDir = join(archiveDir, "HipHop eJay 1", "HIPHOP", "EJAY");
      mkdirSync(hiphopDir, { recursive: true });

      const maxLines = Array.from({ length: 737 }, () => '""');
      maxLines[1] = '"AA\\LOW.PXD"';
      // Intentionally conflicting MAX mapping: raw id 736 points at WRONG.PXD.
      maxLines[736] = '"AA\\WRONG.PXD"';
      writeFileSync(join(hiphopDir, "MAX"), maxLines.join("\r\n"));

      const pxdLines: string[] = [];
      for (let i = 0; i <= 5; i += 1) {
        const path = i === 5
          ? "BR\\H1BS006.PXD"
          : `ZZ\\DUMMY${String(i).padStart(3, "0")}.PXD`;
        pxdLines.push(`"${path}"`, '""', '"bass"', '"2"', '"Grp. 1"', '"Vers1"');
      }
      writeFileSync(join(hiphopDir, "PXD"), pxdLines.join("\r\n"));

      const index = buildSampleIndex(root, archiveDir);
      // 736 = 731 + 5; must resolve via transformed PXD row mapping.
      expect(index.HipHop_eJay1.byGen1Id?.["736"]).toBe("Bass/right.wav");
      // MAX fallback still applies to low ids outside the transformed window.
      expect(index.HipHop_eJay1.byGen1Id?.["1"]).toBe("Loop/low.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("precomputes SuperPack sample-kit Gen 1 fallbacks", () => {
    const root = mkdtempSync(join(tmpdir(), "build-index-sample-gen1-kit-"));
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({
        samples: [
          {
            filename: "placeholder.wav",
            category: "Loop",
            product: "Dance_SuperPack",
          },
          {
            filename: "kit01.wav",
            category: "Drum",
            product: "SampleKit_DMKIT1",
            source: "dmkit1/kit01.pxd",
          },
        ],
      }));

      const archiveDir = join(root, "archive");
      const superPackDir = join(archiveDir, "Dance_SuperPack", "dance", "EJAY");
      mkdirSync(superPackDir, { recursive: true });
      writeFileSync(join(superPackDir, "MAX"), '""\r\n');
      writeFileSync(join(superPackDir, "kit1.txt"), [
        '"DMKIT1\\KIT01.PXD"',
        '""',
        '"drum"',
        '"1"',
        '"Grp. 1"',
        '"Vers1"',
        '',
      ].join("\r\n"));

      const index = buildSampleIndex(root, archiveDir);
      expect(index.Dance_SuperPack.byGen1Id?.["3400"]).toBe("Drum/kit01.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});