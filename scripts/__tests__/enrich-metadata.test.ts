import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  dance1Category,
  enrichProduct,
  extractSubCode,
  findManifests,
  hiphopCategory,
  parsePxddanceCatalog,
  raveCategory,
  studioBpmFromBank,
  studioCategoryFromSource,
} from "../enrich-metadata.js";

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

      expect(raveManifest.samples[0].bpm).toBe(140);
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
});
