import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  dedupeMetadataSamples,
  hasInfCompanion,
  PRODUCTS,
  detectProducts,
  expandParserSourceCandidate,
  parserSourceCandidates,
  readProductMetadataSamples,
  resolveArchivePathCandidate,
  resolveParserSource,
  resolveParserSources,
  writeMergedProductMetadata,
} from "../build-library.js";

// Expected product IDs in the registry (one per eJay title shipped in archive/)
const EXPECTED_IDS = [
  "Dance_eJay1",
  "Dance_eJay2",
  "Dance_eJay3",
  "Dance_eJay4",
  "Dance_SuperPack",
  "GenerationPack1_Dance",
  "GenerationPack1_Rave",
  "GenerationPack1_HipHop",
  "HipHop_eJay2",
  "HipHop_eJay3",
  "HipHop_eJay4",
  "House_eJay",
  "Rave",
  "Techno_eJay",
  "Techno_eJay3",
  "Xtreme_eJay",
];

describe("PRODUCTS registry", () => {
  it("contains all expected product IDs", () => {
    const ids = PRODUCTS.map((p) => p.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("every entry has non-empty id, label, archivePath, parserSource", () => {
    for (const p of PRODUCTS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.archivePath.length).toBeGreaterThan(0);
      expect(p.parserSource.length).toBeGreaterThan(0);
    }
  });

  it("parserSource starts with archive/ for every entry", () => {
    for (const p of PRODUCTS) {
      expect(p.parserSource.replace(/\\/g, "/")).toMatch(/^archive\//);
    }
  });
});

describe("detectProducts", () => {
  it("returns empty array when archive dir does not exist", () => {
    const result = detectProducts(join(tmpdir(), "build-library-missing-xyz"));
    expect(result).toEqual([]);
  });

  it("returns empty array when archive dir exists but no product subdirs are present", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-empty-"));
    try {
      const result = detectProducts(archive);
      expect(result).toEqual([]);
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("returns only products whose archivePath exists under the given dir", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-partial-"));
    const rave = PRODUCTS.find((p) => p.id === "Rave")!;
    const dance1 = PRODUCTS.find((p) => p.id === "Dance_eJay1")!;
    try {
      mkdirSync(join(archive, rave.archivePath), { recursive: true });
      const result = detectProducts(archive);
      expect(result.map((p) => p.id)).toContain("Rave");
      expect(result.map((p) => p.id)).not.toContain("Dance_eJay1");
      expect(result).toHaveLength(1);

      // Add the second product
      mkdirSync(join(archive, dance1.archivePath), { recursive: true });
      const result2 = detectProducts(archive);
      expect(result2).toHaveLength(2);
      expect(result2.map((p) => p.id).sort()).toEqual(["Dance_eJay1", "Rave"].sort());
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("detects products through archivePath aliases", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-alias-"));
    try {
      mkdirSync(join(archive, "Rave eJay", "RAVE"), { recursive: true });
      const result = detectProducts(archive);
      expect(result.map((p) => p.id)).toContain("Rave");
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("detects Rave through PXD archive layout aliases", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-alias-rave-pxd-"));
    try {
      mkdirSync(join(archive, "Rave eJay", "PXD"), { recursive: true });
      const result = detectProducts(archive);
      expect(result.map((p) => p.id)).toContain("Rave");
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("detects Dance_eJay2 from OLD and NEW archive layouts", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-d2-old-new-"));
    try {
      mkdirSync(join(archive, "Dance eJay 2 OLD", "D_EJAY2", "PXD"), { recursive: true });
      mkdirSync(join(archive, "Dance eJay 2 NEW", "D2", "PXD"), { recursive: true });
      mkdirSync(join(archive, "Dance eJay 2 OLD", "D_EJAY2", "PXD", "DANCE20"), { recursive: true });
      mkdirSync(join(archive, "Dance eJay 2 NEW", "D2", "PXD", "Dancesk4"), { recursive: true });

      const result = detectProducts(archive);
      expect(result.map((p) => p.id)).toContain("Dance_eJay2");
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("detects Dance_eJay2 from the D_EJAY2/PXD layout", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-d2-dejay2-layout-"));
    try {
      mkdirSync(join(archive, "Dance eJay 2", "D_EJAY2", "PXD"), { recursive: true });
      const result = detectProducts(archive);
      expect(result.map((p) => p.id)).toContain("Dance_eJay2");
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });
});

describe("parserSourceCandidates", () => {
  it("returns only parserSource when no aliases are configured", () => {
    const spec = {
      id: "Synthetic",
      label: "Synthetic",
      archivePath: "Synthetic",
      parserSource: "archive/Synthetic",
    } as (typeof PRODUCTS)[number];
    expect(parserSourceCandidates(spec)).toEqual([spec.parserSource]);
  });

  it("returns parserSource followed by aliases when configured", () => {
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    expect(parserSourceCandidates(spec)).toEqual([
      spec.parserSource,
      ...(spec.parserSourceAliases ?? []),
    ]);
  });
});

describe("resolveParserSource", () => {
  it("returns primary parserSource when present", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-parse-src-primary-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      mkdirSync(join(root, spec.parserSource), { recursive: true });
      expect(resolveParserSource(spec, root)).toBe(spec.parserSource);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to parserSource aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-parse-src-alias-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      mkdirSync(join(root, spec.parserSourceAliases![0]), { recursive: true });
      expect(resolveParserSource(spec, root)).toBe(spec.parserSourceAliases![0]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no parserSource candidate exists", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-parse-src-missing-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      expect(resolveParserSource(spec, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveParserSources", () => {
  it("falls through aliases until it finds an expanded packed-archive set", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-parse-sources-fallback-chain-"));
    try {
      const spec = {
        id: "Synthetic",
        label: "Synthetic",
        archivePath: "Synthetic",
        parserSource: join("archive", "missing", "PXD"),
        parserSourceAliases: [
          join("archive", "alias-empty", "PXD"),
          join("archive", "alias-packed", "PXD"),
        ],
      } as (typeof PRODUCTS)[number];

      mkdirSync(join(root, "archive", "alias-empty", "PXD"), { recursive: true });

      const packedDir = join(root, "archive", "alias-packed", "PXD");
      mkdirSync(packedDir, { recursive: true });
      writeFileSync(join(packedDir, "DANCE20"), "packed");
      writeFileSync(join(packedDir, "DANCE20.INF"), "[SAMPLES]\n");
      writeFileSync(join(packedDir, "Dancesk4"), "packed");
      writeFileSync(join(packedDir, "Dancesk4.inf"), "[SAMPLES]\n");

      expect(resolveParserSources(spec, root)).toEqual([
        join("archive", "alias-packed", "PXD", "DANCE20"),
        join("archive", "alias-packed", "PXD", "Dancesk4"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the first existing directory candidate when no packed archives are found", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-parse-sources-dir-fallback-"));
    try {
      const spec = {
        id: "Synthetic",
        label: "Synthetic",
        archivePath: "Synthetic",
        parserSource: join("archive", "missing", "PXD"),
        parserSourceAliases: [
          join("archive", "alias-empty", "PXD"),
          join("archive", "alias-packed", "PXD"),
        ],
      } as (typeof PRODUCTS)[number];

      mkdirSync(join(root, "archive", "alias-empty", "PXD"), { recursive: true });

      expect(resolveParserSources(spec, root)).toEqual([
        join("archive", "alias-empty", "PXD"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveArchivePathCandidate", () => {
  it("returns the primary archivePath when present", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-archive-primary-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      mkdirSync(join(archive, spec.archivePath), { recursive: true });
      expect(resolveArchivePathCandidate(spec, archive)).toBe(spec.archivePath);
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("falls back to archivePath aliases", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-archive-alias-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      const alias = spec.archivePathAliases![0];
      mkdirSync(join(archive, alias), { recursive: true });
      expect(resolveArchivePathCandidate(spec, archive)).toBe(alias);
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it("returns null when no archivePath candidates exist", () => {
    const archive = mkdtempSync(join(tmpdir(), "build-library-archive-missing-"));
    const spec = PRODUCTS.find((p) => p.id === "Rave")!;
    try {
      expect(resolveArchivePathCandidate(spec, archive)).toBeNull();
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });
});

describe("metadata helper functions", () => {
  it("readProductMetadataSamples returns [] for missing metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-meta-missing-"));
    try {
      expect(readProductMetadataSamples(join(root, "metadata.json"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("readProductMetadataSamples returns [] for invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-meta-invalid-json-"));
    const metadataPath = join(root, "metadata.json");
    try {
      writeFileSync(metadataPath, "{not-json");
      expect(readProductMetadataSamples(metadataPath)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("readProductMetadataSamples returns [] when samples is not an array", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-meta-no-array-"));
    const metadataPath = join(root, "metadata.json");
    try {
      writeFileSync(metadataPath, JSON.stringify({ samples: "bad-shape" }));
      expect(readProductMetadataSamples(metadataPath)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("readProductMetadataSamples keeps only object entries", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-meta-filter-"));
    const metadataPath = join(root, "metadata.json");
    try {
      writeFileSync(metadataPath, JSON.stringify({
        samples: [
          null,
          1,
          "x",
          { filename: "keep-1.wav" },
          { filename: "keep-2.wav", sample_id: 2 },
        ],
      }));

      expect(readProductMetadataSamples(metadataPath)).toEqual([
        { filename: "keep-1.wav" },
        { filename: "keep-2.wav", sample_id: 2 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupeMetadataSamples removes duplicate records case-insensitively", () => {
    const deduped = dedupeMetadataSamples([
      { filename: "Kick.wav", source_archive: "DANCE20", internal_name: "KICK", sample_id: 7 },
      { filename: "kick.wav", source_archive: "dance20", internal_name: "kick", sample_id: "7" },
      { filename: "Snare.wav", source_archive: "DANCE20", internal_name: "SNARE", sample_id: 8 },
    ]);

    expect(deduped).toEqual([
      { filename: "Kick.wav", source_archive: "DANCE20", internal_name: "KICK", sample_id: 7 },
      { filename: "Snare.wav", source_archive: "DANCE20", internal_name: "SNARE", sample_id: 8 },
    ]);
  });

  it("writeMergedProductMetadata writes deduped sample metadata and total", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-meta-merged-"));
    const metadataPath = join(root, "metadata.json");
    try {
      writeMergedProductMetadata(metadataPath, [
        { filename: "Kick.wav", source_archive: "DANCE20", internal_name: "KICK", sample_id: 7 },
        { filename: "kick.wav", source_archive: "dance20", internal_name: "kick", sample_id: 7 },
        { filename: "Snare.wav", source_archive: "DANCE20", internal_name: "SNARE", sample_id: 8 },
      ]);

      const merged = JSON.parse(readFileSync(metadataPath, "utf8")) as {
        generated_at: string;
        total_samples: number;
        samples: Array<{ filename: string }>;
      };

      expect(merged.generated_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(merged.total_samples).toBe(2);
      expect(merged.samples.map((sample) => sample.filename)).toEqual(["Kick.wav", "Snare.wav"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("hasInfCompanion", () => {
  it("accepts lowercase, uppercase, and mixed-case INF companions", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-has-inf-"));
    try {
      const packedBase = join(root, "DANCE20");

      writeFileSync(`${packedBase}.inf`, "[SAMPLES]");
      expect(hasInfCompanion(packedBase)).toBe(true);

      rmSync(`${packedBase}.inf`, { force: true });
      writeFileSync(`${packedBase}.INF`, "[SAMPLES]");
      expect(hasInfCompanion(packedBase)).toBe(true);

      rmSync(`${packedBase}.INF`, { force: true });
      writeFileSync(`${packedBase}.Inf`, "[SAMPLES]");
      expect(hasInfCompanion(packedBase)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false when no INF companion exists", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-no-inf-"));
    try {
      expect(hasInfCompanion(join(root, "DANCE20"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("expandParserSourceCandidate", () => {
  it("expands extension-less packed archives with INF companions", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-expand-packed-"));
    try {
      const pxdRoot = join(root, "archive", "Dance eJay 2", "D_EJAY2", "PXD");
      mkdirSync(pxdRoot, { recursive: true });

      mkdirSync(join(pxdRoot, "EFFECSAV"), { recursive: true });
      mkdirSync(join(pxdRoot, "MIXWAVES"), { recursive: true });

      writeFileSync(join(pxdRoot, "DANCE20"), "packed");
      writeFileSync(join(pxdRoot, "DANCE20.INF"), "[SAMPLES]\n");
      writeFileSync(join(pxdRoot, "Dancesk4"), "packed");
      writeFileSync(join(pxdRoot, "Dancesk4.inf"), "[SAMPLES]\n");
      writeFileSync(join(pxdRoot, "Dancesk5"), "packed");
      writeFileSync(join(pxdRoot, "Dancesk5.inf"), "[SAMPLES]\n");
      writeFileSync(join(pxdRoot, "Dancesk6"), "packed");
      writeFileSync(join(pxdRoot, "Dancesk6.inf"), "[SAMPLES]\n");

      expect(
        expandParserSourceCandidate(join("archive", "Dance eJay 2", "D_EJAY2", "PXD"), root),
      ).toEqual([
        join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "DANCE20"),
        join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "Dancesk4"),
        join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "Dancesk5"),
        join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "Dancesk6"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the original directory when no packed archives are present", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-expand-directory-"));
    try {
      const dir = join(root, "archive", "Rave eJay", "PXD");
      mkdirSync(dir, { recursive: true });
      expect(expandParserSourceCandidate(join("archive", "Rave eJay", "PXD"), root)).toEqual([
        join("archive", "Rave eJay", "PXD"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores extension-less files that lack an INF companion", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-expand-no-inf-file-"));
    try {
      const dir = join(root, "archive", "Rave eJay", "PXD");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "NOINF"), "packed");

      expect(expandParserSourceCandidate(join("archive", "Rave eJay", "PXD"), root)).toEqual([
        join("archive", "Rave eJay", "PXD"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the original file path when source is already a file", () => {
    const root = mkdtempSync(join(tmpdir(), "build-library-expand-file-"));
    try {
      const pxdRoot = join(root, "archive", "Dance eJay 2", "D_EJAY2", "PXD");
      mkdirSync(pxdRoot, { recursive: true });
      writeFileSync(join(pxdRoot, "DANCE20"), "packed");
      expect(
        expandParserSourceCandidate(join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "DANCE20"), root),
      ).toEqual([
        join("archive", "Dance eJay 2", "D_EJAY2", "PXD", "DANCE20"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
