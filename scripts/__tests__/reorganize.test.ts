import { describe, expect, it } from "vitest";
import {
  CHANNEL_MAP,
  CATEGORY_HINTS,
  HH4_CHANNEL_MAP,
  PRODUCT_PREFIX_OVERRIDES,
  getChannel,
  collectMetadata,
  reorganize,
  sanitizeChannelToken,
} from "../reorganize.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ejay-reorg-"));
}

// ── Constants ────────────────────────────────────────────────

describe("CHANNEL_MAP", () => {
  it("maps drum codes to Drum", () => {
    for (const code of ["MA", "MB", "MC", "MD", "ME", "MF", "MG", "DA", "DB", "DC", "DD", "DE", "DF"]) {
      expect(CHANNEL_MAP[code]).toBe("Drum");
    }
  });

  it("maps BS to Bass", () => {
    expect(CHANNEL_MAP["BS"]).toBe("Bass");
  });

  it("maps GT to Guitar", () => {
    expect(CHANNEL_MAP["GT"]).toBe("Guitar");
  });

  it("maps FX to Effect", () => {
    expect(CHANNEL_MAP["FX"]).toBe("Effect");
  });

  it("maps vocal codes to Voice", () => {
    for (const code of ["VA", "VB", "VC", "VF", "VM"]) {
      expect(CHANNEL_MAP[code]).toBe("Voice");
    }
  });

  it("maps loop codes to Loop", () => {
    for (const code of ["LA", "LC", "HS", "BT"]) {
      expect(CHANNEL_MAP[code]).toBe("Loop");
    }
  });

  it("maps key codes to Keys", () => {
    for (const code of ["PN", "ON", "SY"]) {
      expect(CHANNEL_MAP[code]).toBe("Keys");
    }
  });
});

describe("HH4_CHANNEL_MAP", () => {
  it("maps HipHop 4 channel codes", () => {
    expect(HH4_CHANNEL_MAP["BASS"]).toBe("Bass");
    expect(HH4_CHANNEL_MAP["DRUMA"]).toBe("Drum");
    expect(HH4_CHANNEL_MAP["FX"]).toBe("Effect");
    expect(HH4_CHANNEL_MAP["GUITAR"]).toBe("Guitar");
    expect(HH4_CHANNEL_MAP["LOOP"]).toBe("Loop");
    expect(HH4_CHANNEL_MAP["SCRATCH"]).toBe("Scratch");
  });
});

describe("CATEGORY_HINTS", () => {
  it("is an array of [hint, channel] pairs", () => {
    expect(CATEGORY_HINTS.length).toBeGreaterThan(0);
    for (const [hint, channel] of CATEGORY_HINTS) {
      expect(typeof hint).toBe("string");
      expect(typeof channel).toBe("string");
    }
  });
});

describe("PRODUCT_PREFIX_OVERRIDES", () => {
  it("has Techno eJay 3 override for SRC → Sphere", () => {
    expect(PRODUCT_PREFIX_OVERRIDES["techno_ejay3"]).toEqual([["SRC", "Sphere"]]);
  });
});

// ── getChannel ───────────────────────────────────────────────

describe("getChannel", () => {
  it("returns channel for standard CHANNEL_MAP prefix (BS → Bass)", () => {
    expect(getChannel("BS001")).toBe("Bass");
  });

  it("returns channel for drum prefix (MA → Drum)", () => {
    expect(getChannel("MA01")).toBe("Drum");
  });

  it("returns channel for guitar prefix (GT → Guitar)", () => {
    expect(getChannel("GT01")).toBe("Guitar");
  });

  it("returns channel for effect prefix (FX → Effect)", () => {
    expect(getChannel("FX001")).toBe("Effect");
  });

  it("returns Xtra for unknown prefix", () => {
    expect(getChannel("QQ999")).toBe("Xtra");
  });

  it("is case-insensitive", () => {
    expect(getChannel("bs001")).toBe("Bass");
    expect(getChannel("Bs001")).toBe("Bass");
  });

  it("uses category hints when prefix unknown", () => {
    expect(getChannel("UNKNOWN01", "Bass Loop")).toBe("Bass");
  });

  it("falls back to Xtra when category has no match", () => {
    expect(getChannel("UNKNOWN01", "nonsense")).toBe("Xtra");
  });

  it("applies product-specific override (techno_ejay3 SRC → Sphere)", () => {
    expect(getChannel("SRC001", "", "techno_ejay3")).toBe("Sphere");
  });

  it("SRC without product override goes to Scratch", () => {
    expect(getChannel("SRC001", "", "hiphop_ejay3")).toBe("Scratch");
  });

  it("handles empty internal name by returning Xtra", () => {
    expect(getChannel("")).toBe("Xtra");
  });

  it("handles House eJay EX prefix → Groove", () => {
    // House eJay filenames like HS1AEX01
    expect(getChannel("HS1AEX01")).toBe("Groove");
  });

  it("handles Loop codes (LA → Loop)", () => {
    expect(getChannel("LA01")).toBe("Loop");
  });

  it("handles Seq codes (KY → Seq)", () => {
    expect(getChannel("KY01")).toBe("Seq");
  });

  it("handles Scratch codes (ST → Scratch)", () => {
    expect(getChannel("ST01")).toBe("Scratch");
  });

  it("handles HipHop 4 pattern (HIPHOP_BASS01 → Bass)", () => {
    expect(getChannel("HIPHOP_BASS01")).toBe("Bass");
    expect(getChannel("HIPHOP_DRUMA01")).toBe("Drum");
    expect(getChannel("HIPHOP_LOOP01")).toBe("Loop");
    expect(getChannel("HIPHOP_SCRATCH01")).toBe("Scratch");
    expect(getChannel("HIPHOP_FEMALE01")).toBe("Ladies");
    expect(getChannel("HIPHOP_MALE01")).toBe("Fellas");
  });

  it("handles HH4 unknown code → Xtra", () => {
    expect(getChannel("HIPHOP_UNKNOWN01")).toBe("Xtra");
  });

  it("handles Dance eJay 2 pattern (D5BS01 → Bass)", () => {
    expect(getChannel("D5BS01")).toBe("Bass");
    expect(getChannel("A1GT01")).toBe("Guitar");
  });

  it("handles Dance eJay 4 pattern (DABS01 → Bass)", () => {
    expect(getChannel("DABS01")).toBe("Bass");
    expect(getChannel("DAFX01")).toBe("Effect");
  });

  it("handles Xtreme eJay pattern", () => {
    expect(getChannel("XABSXA01")).toBe("Bass");
  });

  it("handles House eJay non-EX code", () => {
    expect(getChannel("HS1ABS01")).toBe("Bass");
  });

  it("handles House eJay with unknown code → Xtra", () => {
    expect(getChannel("HS1AQQ01")).toBe("Xtra");
  });

  it("falls back to category hints when a regex-derived code is unknown", () => {
    expect(getChannel("D4SP001", "effect")).toBe("Effect");
  });

  it("uses longest-prefix matching for multi-char codes", () => {
    // GCA is in CHANNEL_MAP → Drum
    expect(getChannel("GCA01")).toBe("Drum");
  });

  it("falls through to prefix when no regex matches", () => {
    expect(getChannel("RP01")).toBe("Rap");
    expect(getChannel("LY01")).toBe("Layer");
    expect(getChannel("SC01")).toBe("Scratch");
  });

  it("uses category hints for various keywords", () => {
    expect(getChannel("UNKNOWN01", "drums")).toBe("Drum");
    expect(getChannel("UNKNOWN01", "guitar riff")).toBe("Guitar");
    expect(getChannel("UNKNOWN01", "vocals")).toBe("Voice");
    expect(getChannel("UNKNOWN01", "effects pad")).toBe("Layer");
    expect(getChannel("UNKNOWN01", "synthesizer")).toBe("Keys");
    expect(getChannel("UNKNOWN01", "scratching")).toBe("Scratch");
  });
});

// ── collectMetadata ──────────────────────────────────────────

describe("collectMetadata", () => {
  it("reads samples from metadata.json", () => {
    const tmp = createTempDir();
    try {
      const meta = {
        samples: [
          { filename: "kick.wav", internal_name: "DA01" },
          { filename: "snare.wav", internal_name: "DA02" },
        ],
      };
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify(meta));

      const records = collectMetadata(tmp);
      expect(records.length).toBe(2);
      expect(records[0][1].filename).toBe("kick.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty array for directory without metadata.json", () => {
    const tmp = createTempDir();
    try {
      expect(collectMetadata(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips corrupt metadata.json", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "metadata.json"), "NOT VALID JSON {{{{");
      expect(collectMetadata(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds metadata.json in subdirectories", () => {
    const tmp = createTempDir();
    try {
      const subDir = join(tmp, "subdir");
      mkdirSync(subDir);
      writeFileSync(join(subDir, "metadata.json"), JSON.stringify({
        samples: [{ filename: "bass.wav" }],
      }));

      const records = collectMetadata(tmp);
      expect(records.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── reorganize ───────────────────────────────────────────────

describe("reorganize", () => {
  it("moves WAV files into channel folders", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "BS01.wav"), "pcm-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "BS01.wav", internal_name: "BS01" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(true);
      // metadata.json should be updated
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles dry run without moving files", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "FX01.wav"), "fx-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "FX01.wav", internal_name: "FX01" }],
      }));

      reorganize(tmp, true);

      // File should NOT have moved
      expect(existsSync(join(tmp, "FX01.wav"))).toBe(true);
      expect(existsSync(join(tmp, "Effect", "FX01.wav"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips samples with missing files", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "nonexistent.wav", internal_name: "BS01" }],
      }));

      reorganize(tmp);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles empty metadata", () => {
    const tmp = createTempDir();
    try {
      // No metadata.json → should print message and return
      reorganize(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves filename collisions", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "sample.wav"), "existing");
      writeFileSync(join(tmp, "sample.wav"), "new-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "sample.wav", internal_name: "BS01", source_archive: "PACK1" }],
      }));

      reorganize(tmp);

      // The collision logic should rename the file
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].channel).toBe("Bass");
      expect(meta.samples[0].filename).toBe("PACK1 sample.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles path-style filenames and flattens filename metadata", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "oldch"), { recursive: true });
      writeFileSync(join(tmp, "oldch", "sample.wav"), "data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "oldch/sample.wav", internal_name: "BS01" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "sample.wav"))).toBe(true);
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].filename).toBe("sample.wav");
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores traversal-style metadata paths", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "BS01.wav"), "pcm-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "../BS01.wav", internal_name: "BS01" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(false);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("sanitizes source_archive before choosing collision-safe names", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "sample.wav"), "existing");
      writeFileSync(join(tmp, "sample.wav"), "new-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "sample.wav", internal_name: "BS01", source_archive: "..\\PACK/1" }],
      }));

      reorganize(tmp);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].filename).toBe(".._PACK_1 sample.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves secondary collision names", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "sample.wav"), "existing1");
      writeFileSync(join(tmp, "Bass", "PACK1 sample.wav"), "existing2");
      writeFileSync(join(tmp, "sample.wav"), "new-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "sample.wav", internal_name: "BS01", source_archive: "PACK1" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "PACK1 sample (2).wav"))).toBe(true);
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].filename).toBe("PACK1 sample (2).wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves top-level metadata fields", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "BS01.wav"), "pcm-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        source: "archive/Dance_eJay2",
        total_samples: 999,
        format: {
          sample_rate: 44100,
          bit_depth: 16,
          channels: 1,
          encoding: "signed_pcm",
        },
        samples: [{ filename: "BS01.wav", internal_name: "BS01" }],
      }));

      reorganize(tmp);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.source).toBe("archive/Dance_eJay2");
      expect(meta.format).toEqual({
        sample_rate: 44100,
        bit_depth: 16,
        channels: 1,
        encoding: "signed_pcm",
      });
      expect(meta.total_samples).toBe(1);
      expect(Array.isArray(meta.samples)).toBe(true);
      expect(meta.samples.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses source field for internal_name when internal_name missing", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "sample.wav"), "data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "sample.wav", source: "bank/BS01.pxd" }],
      }));

      reorganize(tmp);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips samples with empty filename", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "" }],
      }));

      reorganize(tmp);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dedupes root and nested metadata for the same source file", () => {
    const tmp = createTempDir();
    try {
      const packDir = join(tmp, "pack");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, "BS01.wav"), "pcm-data");

      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "pack/BS01.wav", internal_name: "BS01", alias: "root" }],
      }));
      writeFileSync(join(packDir, "metadata.json"), JSON.stringify({
        samples: [{ filename: "BS01.wav", internal_name: "BS01", alias: "nested" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(true);
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples).toHaveLength(1);
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prefers the richer metadata record when duplicate sources collapse to one file", () => {
    const tmp = createTempDir();
    try {
      const packDir = join(tmp, "pack");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, "BS01.wav"), "pcm-data");

      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "pack/BS01.wav", internal_name: "BS01", alias: "root" }],
      }));
      writeFileSync(join(packDir, "metadata.json"), JSON.stringify({
        samples: [{
          filename: "BS01.wav",
          internal_name: "BS01",
          alias: "nested",
          detail: "kept",
          source_archive: "PACK1",
        }],
      }));

      reorganize(tmp);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples).toHaveLength(1);
      expect(meta.samples[0].alias).toBe("nested");
      expect(meta.samples[0].detail).toBe("kept");
      expect(meta.samples[0].source_archive).toBe("PACK1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("counts the same missing source file once when duplicate metadata entries reference it", () => {
    const tmp = createTempDir();
    try {
      const packDir = join(tmp, "pack");
      mkdirSync(packDir, { recursive: true });

      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "pack/missing.wav", internal_name: "BS01" }],
      }));
      writeFileSync(join(packDir, "metadata.json"), JSON.stringify({
        samples: [{ filename: "missing.wav", internal_name: "BS01" }],
      }));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));
      try {
        reorganize(tmp);
      } finally {
        console.log = origLog;
      }

      expect(logs.some((line) => line.includes("1 skipped (missing files)"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("treats already-organized files as unchanged even when metadata casing differs", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "BS01.wav"), "pcm-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "bass/BS01.wav", internal_name: "BS01", channel: "Bass" }],
      }));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));
      try {
        reorganize(tmp);
      } finally {
        console.log = origLog;
      }

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(true);
      expect(logs.some((line) => line.includes("1 already in place"))).toBe(true);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples).toHaveLength(1);
      expect(meta.samples[0].filename).toBe("BS01.wav");
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves metadata when rerun on an already organized product", () => {
    const tmp = createTempDir();
    try {
      mkdirSync(join(tmp, "Bass"), { recursive: true });
      writeFileSync(join(tmp, "Bass", "BS01.wav"), "pcm-data");
      writeFileSync(join(tmp, "metadata.json"), JSON.stringify({
        samples: [{ filename: "BS01.wav", internal_name: "BS01", channel: "Bass" }],
      }));

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(true);
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8"));
      expect(meta.samples).toHaveLength(1);
      expect(meta.samples[0].filename).toBe("BS01.wav");
      expect(meta.samples[0].channel).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sanitizeChannelToken", () => {
  it("accepts simple alnum tokens", () => {
    expect(sanitizeChannelToken("Drum")).toBe("Drum");
    expect(sanitizeChannelToken("Hi-Hat 1")).toBe("Hi-Hat 1");
  });

  it("rejects path separators and traversal segments", () => {
    expect(sanitizeChannelToken("../etc")).toBeNull();
    expect(sanitizeChannelToken("..\\foo")).toBeNull();
    expect(sanitizeChannelToken("a/b")).toBeNull();
    expect(sanitizeChannelToken("a\\b")).toBeNull();
    expect(sanitizeChannelToken("..")).toBeNull();
    expect(sanitizeChannelToken(".")).toBeNull();
    expect(sanitizeChannelToken("")).toBeNull();
    expect(sanitizeChannelToken("   ")).toBeNull();
  });

  it("rejects non-string and special characters", () => {
    expect(sanitizeChannelToken(undefined)).toBeNull();
    expect(sanitizeChannelToken(null)).toBeNull();
    expect(sanitizeChannelToken(123)).toBeNull();
    expect(sanitizeChannelToken("name\0null")).toBeNull();
    expect(sanitizeChannelToken("name:colon")).toBeNull();
  });
});

describe("reorganize path-traversal hardening", () => {
  it("ignores malicious channel values in metadata and falls back to inference", () => {
    const tmp = createTempDir();
    try {
      // BS01 deterministically infers to "Bass". A poisoned metadata.json with
      // channel "../escape" must not redirect the move outside the product dir.
      writeFileSync(join(tmp, "BS01.wav"), "pcm-data");
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "BS01.wav", internal_name: "BS01", channel: "../escape" },
          ],
        }),
      );

      reorganize(tmp);

      expect(existsSync(join(tmp, "Bass", "BS01.wav"))).toBe(true);
      // Confirm nothing was placed at the traversal target.
      expect(existsSync(join(tmp, "..", "escape"))).toBe(false);
      expect(existsSync(join(tmp, "escape"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to Xtra when channel is unsafe and no inference is available", () => {
    const tmp = createTempDir();
    try {
      // ZZZZ does not match any inference rule (returns "Xtra"). A poisoned
      // channel must not be honoured; it must collapse to the safe default.
      writeFileSync(join(tmp, "ZZZZ.wav"), "pcm-data");
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "ZZZZ.wav", internal_name: "ZZZZ", channel: "../../tmp" },
          ],
        }),
      );

      reorganize(tmp);

      expect(existsSync(join(tmp, "Xtra", "ZZZZ.wav"))).toBe(true);
      expect(existsSync(join(tmp, "..", "..", "tmp"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
