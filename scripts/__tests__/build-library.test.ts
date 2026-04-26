import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { PRODUCTS, detectProducts } from "../build-library.js";

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
});
