import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  backfillWavDuration,
  dance1Category,
  enrichProduct,
  extractSubCode,
  findManifests,
  hiphopCategory,
  parseStudioFilename,
  parsePxddanceCatalog,
  raveCategory,
  reconstructStudioMetadata,
  studioBpmFromBank,
  studioCategoryFromSource,
} from "../enrich-metadata.js";
import { buildSilentPcmWav } from "./wav-test-utils.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ejay-enrich-"));
}

describe("parsePxddanceCatalog", () => {
  it("parses six-line records and ignores unusable categories", () => {
    const tmp = createTempDir();
    try {
      const catalogPath = join(tmp, "Pxddance");
      writeFileSync(
        catalogPath,
        [
          '"banks/BS01.PXD"',
          '"0"',
          '"bass"',
          '"variant"',
          '"group"',
          '"version"',
          '"banks/IGNORE.PXD"',
          '"0"',
          '"http://example.invalid/category"',
          '"variant"',
          '"group"',
          '"version"',
        ].join("\n"),
        "utf-8",
      );

      const parsed = parsePxddanceCatalog(catalogPath);
      expect(parsed.get("BS01")).toBe("bass");
      expect(parsed.has("IGNORE")).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("helper parsers", () => {
  it("extracts subcodes from supported internal names", () => {
    expect(extractSubCode("R1BS100")).toBe("BS");
    expect(extractSubCode("H1SC001")).toBe("SC");
    expect(extractSubCode("INVALID")).toBeNull();
  });

  it("parses studio BPM and category hints", () => {
    expect(studioBpmFromBank("Drum&Bass_160bpm")).toBe(160);
    expect(studioBpmFromBank("OneShots")).toBeNull();
    expect(studioCategoryFromSource("Drum&Bass_160bpm/Bass/FILE.WAV")).toBe("Bass");
    expect(studioCategoryFromSource("FILE.WAV")).toBeNull();
  });
});

describe("category resolvers", () => {
  it("resolves Rave categories and special cases", () => {
    expect(raveCategory("R1BS100.PXD", "")).toBe("Bass");
    expect(raveCategory("R1HG0001.PXD", "")).toBe("Hyper");
    expect(raveCategory("INTRO.PXD", "INTRO.PXD")).toBeNull();
  });

  it("resolves HipHop and Dance 1 categories", () => {
    expect(hiphopCategory("H1SC001.PXD")).toBe("Scratch");
    expect(hiphopCategory("HXLOOP01.PXD")).toBe("Loop");
    expect(hiphopCategory("H1BS001.PXD")).toBe("Bass");
    expect(hiphopCategory("UNKNOWN.PXD")).toBeNull();

    const pxddanceMap = new Map<string, string>([["VOICE01", "voice"]]);
    expect(dance1Category("folder/VOICE01.PXD", pxddanceMap)).toBe("Voice");
    expect(dance1Category("folder/UNKNOWN.PXD", pxddanceMap)).toBeNull();
  });
});

describe("findManifests", () => {
  it("prefers the top-level metadata manifest when present", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "nested"), { recursive: true });
      writeFileSync(join(tmp, "metadata.json"), "{}", "utf-8");
      writeFileSync(join(tmp, "nested", "metadata.json"), "{}", "utf-8");

      expect(findManifests(tmp)).toEqual([join(tmp, "metadata.json")]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to nested manifests when no top-level metadata exists", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "nested"), { recursive: true });
      writeFileSync(join(tmp, "nested", "metadata.json"), "{}", "utf-8");

      expect(findManifests(tmp)).toEqual([join(tmp, "nested", "metadata.json")]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("enrichProduct", () => {
  it("returns null when no manifests are available", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "Dance_eJay2");
      mkdirSync(productDir, { recursive: true });

      expect(enrichProduct(productDir, false, null)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("enriches eJay Studio samples from bank/source metadata and recomputes beats", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "eJay_Studio");
      mkdirSync(productDir, { recursive: true });
      writeFileSync(
        join(productDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [
            {
              filename: "kick.wav",
              source: "Drum&Bass_160bpm/Bass/kick.wav",
              bank: "Drum&Bass_160bpm",
              duration_sec: 3,
              beats: 7,
            },
          ],
        }),
        "utf-8",
      );

      const stats = enrichProduct(productDir, false, null);
      const manifest = JSON.parse(readFileSync(join(productDir, "metadata.json"), "utf-8"));

      expect(stats).toMatchObject({
        product: "eJay_Studio",
        bpmAdded: 1,
        categoryFixed: 1,
        beatsRecomputed: 1,
        totalSamples: 1,
      });
      expect(manifest.samples[0].bpm).toBe(160);
      expect(manifest.samples[0].category).toBe("Bass");
      expect(manifest.samples[0].beats).toBe(8);
      expect(manifest.total_samples).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses product-specific resolvers for Rave and Dance eJay 1 samples", () => {
    const tmp = createTempDir();
    try {
      const raveDir = join(tmp, "Rave");
      mkdirSync(raveDir, { recursive: true });
      writeFileSync(
        join(raveDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{ filename: "R1BS100.wav", source: "R1BS100.PXD" }],
        }),
        "utf-8",
      );

      const danceDir = join(tmp, "Dance_eJay1");
      mkdirSync(danceDir, { recursive: true });
      writeFileSync(
        join(danceDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{ filename: "VOICE01.wav", source: "banks/VOICE01.PXD" }],
        }),
        "utf-8",
      );

      enrichProduct(raveDir, false, null);
      enrichProduct(danceDir, false, new Map<string, string>([["VOICE01", "voice"]]));

      const raveManifest = JSON.parse(readFileSync(join(raveDir, "metadata.json"), "utf-8"));
      const danceManifest = JSON.parse(readFileSync(join(danceDir, "metadata.json"), "utf-8"));

      expect(raveManifest.samples[0].bpm).toBe(180);
      expect(raveManifest.samples[0].category).toBe("Bass");
      expect(danceManifest.samples[0].bpm).toBe(140);
      expect(danceManifest.samples[0].category).toBe("Voice");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses the existing channel when category is missing but channel metadata is present", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "Dance_eJay2");
      mkdirSync(productDir, { recursive: true });
      writeFileSync(
        join(productDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "VC01.wav",
            internal_name: "VC01",
            channel: "Voice",
          }],
        }),
        "utf-8",
      );

      const stats = enrichProduct(productDir, false, null);
      const manifest = JSON.parse(readFileSync(join(productDir, "metadata.json"), "utf-8"));

      expect(stats).toMatchObject({
        product: "Dance_eJay2",
        bpmAdded: 1,
        categoryFixed: 1,
        totalSamples: 1,
      });
      expect(manifest.samples[0].category).toBe("Voice");
      expect(manifest.samples[0].bpm).toBe(140);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses channel fallback for alias-like categories and leaves files untouched in dry-run mode", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "Dance_eJay2");
      mkdirSync(productDir, { recursive: true });
      const manifestPath = join(productDir, "metadata.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "BS01.wav",
            internal_name: "BS01",
            category: "My Alias",
            channel: "Bass",
          }],
        }),
        "utf-8",
      );
      const before = readFileSync(manifestPath, "utf-8");

      const stats = enrichProduct(productDir, true, null);
      const after = readFileSync(manifestPath, "utf-8");

      expect(stats).toMatchObject({
        product: "Dance_eJay2",
        bpmAdded: 1,
        categoryFixed: 1,
        totalSamples: 1,
      });
      expect(after).toBe(before);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses HipHop subcode enrichment when source metadata is present", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "GenerationPack1_HipHop");
      mkdirSync(productDir, { recursive: true });
      writeFileSync(
        join(productDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{ filename: "H1SC001.wav", source: "H1SC001.PXD" }],
        }),
        "utf-8",
      );

      const stats = enrichProduct(productDir, false, null);
      const manifest = JSON.parse(readFileSync(join(productDir, "metadata.json"), "utf-8"));

      expect(stats).toMatchObject({
        product: "GenerationPack1_HipHop",
        bpmAdded: 1,
        categoryFixed: 1,
        totalSamples: 1,
      });
      expect(manifest.samples[0].bpm).toBe(90);
      expect(manifest.samples[0].category).toBe("Scratch");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("marks short Rave clips as one-shots and preserves explicit zero-beat hits", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "Rave");
      mkdirSync(productDir, { recursive: true });
      writeFileSync(
        join(productDir, "metadata.json"),
        JSON.stringify({
          total_samples: 3,
          samples: [
            {
              filename: "R1BS100.wav",
              source: "R1BS100.PXD",
              duration_sec: 2 / 3,
              beats: 2,
            },
            {
              filename: "R1BS101.wav",
              source: "R1BS101.PXD",
              duration_sec: 1,
              beats: 0,
            },
            {
              filename: "R1BS102.wav",
              source: "R1BS102.PXD",
              duration_sec: 4 / 3,
              beats: 3,
            },
          ],
        }),
        "utf-8",
      );

      const stats = enrichProduct(productDir, false, null);
      const manifest = JSON.parse(readFileSync(join(productDir, "metadata.json"), "utf-8"));

      expect(stats).not.toBeNull();
      if (!stats) {
        throw new Error("Expected enrichProduct to return stats for Rave metadata");
      }
      expect(stats.product).toBe("Rave");
      expect(stats.beatsRecomputed).toBe(2);
      expect(manifest.samples[0].bpm).toBe(180);
      expect(manifest.samples[0].beats).toBe(0);
      expect(manifest.samples[1].beats).toBe(0);
      expect(manifest.samples[2].beats).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("recomputes GenerationPack1_Rave beats that were derived from the old 140 BPM default", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "GenerationPack1_Rave");
      mkdirSync(productDir, { recursive: true });
      writeFileSync(
        join(productDir, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [
            {
              filename: "R1BS100.wav",
              source: "R1BS100.PXD",
              duration_sec: 1,
              beats: 2,
            },
          ],
        }),
        "utf-8",
      );

      const stats = enrichProduct(productDir, false, null);
      const manifest = JSON.parse(readFileSync(join(productDir, "metadata.json"), "utf-8"));

      expect(stats).not.toBeNull();
      if (!stats) {
        throw new Error("Expected enrichProduct to return stats for GenerationPack1_Rave metadata");
      }
      expect(stats).toMatchObject({
        product: "GenerationPack1_Rave",
        bpmAdded: 1,
        categoryFixed: 1,
        beatsRecomputed: 1,
        totalSamples: 1,
      });
      expect(manifest.samples[0].bpm).toBe(180);
      expect(manifest.samples[0].beats).toBe(3);
      expect(manifest.samples[0].category).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// backfillWavDuration
// ---------------------------------------------------------------------------

describe("backfillWavDuration", () => {
  it("adds duration_sec and beats from WAV headers for samples missing duration", () => {
    const tmp = createTempDir();
    try {
      // Create output structure: <tmp>/Bass/sample.wav
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "sample.wav"), buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 44100,
      }));

      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "sample.wav",
            category: "Bass",
            subcategory: null,
            bpm: 140,
          }],
        }),
        "utf-8",
      );

      const stats = backfillWavDuration(tmp, false);
      const manifest = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));

      expect(stats.durationAdded).toBe(1);
      expect(stats.beatsAdded).toBe(1);
      expect(stats.errors).toBe(0);
      expect(manifest.samples[0].duration_sec).toBeCloseTo(1.0, 2);
      expect(manifest.samples[0].beats).toBe(Math.round(140 / 60));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips samples that already have duration_sec", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "sample.wav",
            category: "Bass",
            duration_sec: 2.5,
            beats: 6,
            bpm: 140,
          }],
        }),
        "utf-8",
      );

      const stats = backfillWavDuration(tmp, false);
      expect(stats.durationAdded).toBe(0);
      expect(stats.beatsAdded).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles missing WAV files gracefully", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "missing.wav",
            category: "Bass",
            bpm: 140,
          }],
        }),
        "utf-8",
      );

      const stats = backfillWavDuration(tmp, false);
      expect(stats.durationAdded).toBe(0);
      expect(stats.errors).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("respects dry-run mode", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "sample.wav"), buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 44100,
      }));

      const original = JSON.stringify({
        total_samples: 1,
        samples: [{
          filename: "sample.wav",
          category: "Bass",
          bpm: 140,
        }],
      });
      writeFileSync(join(tmp, "metadata.json"), original, "utf-8");

      const stats = backfillWavDuration(tmp, true);
      expect(stats.durationAdded).toBe(1);

      const after = readFileSync(join(tmp, "metadata.json"), "utf-8");
      expect(after).toBe(original);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles subcategory paths correctly", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Drum", "kick"), { recursive: true });
      writeFileSync(join(tmp, "Drum", "kick", "kick01.wav"), buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 22050,
      }));

      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "kick01.wav",
            category: "Drum",
            subcategory: "kick",
            bpm: 140,
          }],
        }),
        "utf-8",
      );

      const stats = backfillWavDuration(tmp, false);
      const manifest = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));

      expect(stats.durationAdded).toBe(1);
      expect(manifest.samples[0].duration_sec).toBeCloseTo(0.5, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseStudioFilename", () => {
  it("parses BPM-style filenames", () => {
    const result = parseStudioFilename("Drum&Bass_160bpm_SNTHBASS001_D+B_160_C_ST.wav");
    expect(result).toEqual({ detail: "Drum&Bass", internalName: "SNTHBASS001" });
  });

  it("parses BPM-style filenames with (L)/(R) suffix", () => {
    const result = parseStudioFilename("Trance_140bpm_SYNTH005_TRNCE_125_A_ST(L).wav");
    expect(result).toEqual({ detail: "Trance", internalName: "SYNTH005" });
  });

  it("parses the space edge case (A ST instead of A_ST)", () => {
    const result = parseStudioFilename("HipHop_90bpm_STRING006_HPHOP_90_A ST.wav");
    expect(result).toEqual({ detail: "HipHop", internalName: "STRING006" });
  });

  it("parses DrumSpezial filenames", () => {
    const result = parseStudioFilename("DrumSpezial_KICK042_ST.wav");
    expect(result).toEqual({ detail: "DrumSpezial", internalName: "KICK042" });
  });

  it("returns null for unrecognized filenames", () => {
    expect(parseStudioFilename("random_file.wav")).toBeNull();
  });
});

describe("reconstructStudioMetadata", () => {
  it("adds detail, internal_name, and audio props from filename + WAV header", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(
        join(tmp, "Bass", "House_125bpm_SNTHBASS001_HOUSE_125_A_ST.wav"),
        buildSilentPcmWav({ sampleRate: 44100, channels: 2, bitDepth: 16, numFrames: 44100 }),
      );

      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "House_125bpm_SNTHBASS001_HOUSE_125_A_ST.wav",
            product: "eJay_Studio",
            category: "Bass",
            bpm: 125,
          }],
        }),
      );

      const stats = reconstructStudioMetadata(tmp, false);
      expect(stats.detailAdded).toBe(1);
      expect(stats.internalNameAdded).toBe(1);
      expect(stats.sampleRateAdded).toBe(1);
      expect(stats.errors).toBe(0);

      const manifest = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      const s = manifest.samples[0];
      expect(s.detail).toBe("House");
      expect(s.internal_name).toBe("SNTHBASS001");
      expect(s.sample_rate).toBe(44100);
      expect(s.channels).toBe(2);
      expect(s.bit_depth).toBe(16);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips non-eJay_Studio samples", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "DE1_R1LA100.wav",
            product: "Dance_eJay1",
            category: "Loop",
          }],
        }),
      );

      const stats = reconstructStudioMetadata(tmp, false);
      expect(stats.totalStudio).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips samples that already have all fields", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "House_125bpm_SNTHBASS001_HOUSE_125_A_ST.wav",
            product: "eJay_Studio",
            category: "Bass",
            detail: "House",
            internal_name: "SNTHBASS001",
            sample_rate: 44100,
            channels: 2,
            bit_depth: 16,
          }],
        }),
      );

      const stats = reconstructStudioMetadata(tmp, false);
      expect(stats.totalStudio).toBe(1);
      expect(stats.detailAdded).toBe(0);
      expect(stats.internalNameAdded).toBe(0);
      expect(stats.sampleRateAdded).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("respects dry-run mode", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Drum", "perc"), { recursive: true });
      writeFileSync(
        join(tmp, "Drum", "perc", "DrumSpezial_CLAP001_ST.wav"),
        buildSilentPcmWav({ sampleRate: 44100, channels: 1, bitDepth: 16, numFrames: 44100 }),
      );

      const original = JSON.stringify({
        total_samples: 1,
        samples: [{
          filename: "DrumSpezial_CLAP001_ST.wav",
          product: "eJay_Studio",
          category: "Drum",
          subcategory: "perc",
        }],
      });
      writeFileSync(join(tmp, "metadata.json"), original, "utf-8");

      const stats = reconstructStudioMetadata(tmp, true);
      expect(stats.detailAdded).toBe(1);
      expect(stats.internalNameAdded).toBe(1);

      const after = readFileSync(join(tmp, "metadata.json"), "utf-8");
      expect(after).toBe(original);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("counts errors when WAV file is missing", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          total_samples: 1,
          samples: [{
            filename: "Techno_140bpm_SYNTH001_TEKNO_140_A_ST.wav",
            product: "eJay_Studio",
            category: "Keys",
          }],
        }),
      );

      const stats = reconstructStudioMetadata(tmp, false);
      expect(stats.detailAdded).toBe(1);
      expect(stats.errors).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
