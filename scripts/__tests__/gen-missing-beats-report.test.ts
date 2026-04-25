import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it, vi } from "vitest";

import {
  APP_SIG_RAVE,
  FA_CELL_BYTES,
  FA_COLS,
  FA_HEADER_BYTES,
  FA_ROW_BYTES,
} from "../mix-parser.js";
import {
  dedupKey,
  findMixFiles,
  generateMissingBeatsReport,
  isUtilitySample,
  main,
  productHintForPath,
  refIdentifiers,
} from "../gen-missing-beats-report.js";

function buildFormatA(
  appSig: number,
  cells: Array<{ row: number; col: number; id: number }>,
): Buffer {
  const maxRow = cells.reduce((currentMax, cell) => Math.max(currentMax, cell.row), 0);
  const gridBytes = (maxRow + 1) * FA_ROW_BYTES;
  const buf = Buffer.alloc(FA_HEADER_BYTES + gridBytes);

  buf.writeUInt16LE(appSig, 0);
  for (const cell of cells) {
    if (cell.col >= FA_COLS) {
      throw new Error("buildFormatA: invalid column");
    }
    const offset = FA_HEADER_BYTES + (cell.row * FA_ROW_BYTES) + (cell.col * FA_CELL_BYTES);
    buf.writeUInt16LE(cell.id, offset);
  }

  return buf;
}

describe("gen-missing-beats-report helpers", () => {
  it("classifies utility samples, maps product hints, and de-duplicates keys", () => {
    expect(isUtilitySample({ filename: "logo.wav", source: "logo" })).toBe(true);
    expect(isUtilitySample({ filename: "mix.wav", source: "counter/01 classic.wav" })).toBe(true);
    expect(isUtilitySample({ filename: "mix.wav", source: "normal/sample" })).toBe(false);

    expect(productHintForPath("Dance_SuperPack/eJay SampleKit/DMKIT1/demo.mix")).toBe("Dance_SuperPack");
    expect(productHintForPath("GenerationPack1/Rave/demo.mix")).toBe("GenerationPack1_Rave");
    expect(productHintForPath("unknown/demo.mix")).toBeUndefined();

    expect(dedupKey("Rave", { filename: "x.wav", source: "Kick/One", internal_name: null, alias: null })).toBe(
      "Rave::kick/one",
    );
  });

  it("finds nested mix files and derives unresolved identifiers", () => {
    const tmp = mkdtempSync(join(tmpdir(), "missing-beats-helpers-"));
    try {
      mkdirSync(join(tmp, "nested"), { recursive: true });
      writeFileSync(join(tmp, "a.mix"), "a");
      writeFileSync(join(tmp, "nested", "b.MIX"), "b");
      writeFileSync(join(tmp, "nested", "note.txt"), "x");

      expect(findMixFiles(tmp).map((path) => path.replace(/\\/g, "/"))).toEqual([
        join(tmp, "a.mix").replace(/\\/g, "/"),
        join(tmp, "nested", "b.MIX").replace(/\\/g, "/"),
      ]);
      expect(findMixFiles(join(tmp, "missing"))).toEqual([]);

      expect(refIdentifiers({ rawId: 0, internalName: null, displayName: "Kick01" })).toEqual({
        filename: "Kick01.wav",
        source: "Kick01",
        internal_name: null,
        alias: "Kick01",
      });
      expect(refIdentifiers({ rawId: 0, internalName: "stem.9", displayName: null })).toEqual({
        filename: "STEM.wav",
        source: "stem.9",
        internal_name: "stem.9",
        alias: null,
      });
      expect(refIdentifiers({ rawId: 42, internalName: null, displayName: null })).toEqual({
        filename: "id_42.wav",
        source: "id_42",
        internal_name: null,
        alias: null,
      });
      expect(
        refIdentifiers(
          { rawId: 42, internalName: null, displayName: null },
          { id: 42, path: "rekit1/01/r2bs306.pxd", bank: "REKIT1", file: "R2BS306", category: null, group: null, version: null },
        ),
      ).toEqual({
        filename: "R2BS306.wav",
        source: "rekit1/01/r2bs306.pxd",
        internal_name: null,
        alias: null,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("generateMissingBeatsReport", () => {
  it("filters utility refs, skips empty refs, and collapses duplicates", () => {
    const tmp = mkdtempSync(join(tmpdir(), "missing-beats-generate-"));
    try {
      const archiveDir = join(tmp, "archive");
      mkdirSync(join(archiveDir, "Rave"), { recursive: true });
      mkdirSync(join(archiveDir, "_userdata", "Hip Hop"), { recursive: true });
      writeFileSync(join(archiveDir, "Rave", "demo.mix"), Buffer.from("rave", "utf8"));
      writeFileSync(join(archiveDir, "_userdata", "Hip Hop", "demo.hh.mix"), Buffer.from("hh", "utf8"));
      writeFileSync(join(archiveDir, "Rave", "bad.mix"), Buffer.from("bad", "utf8"));

      const metadataPath = join(tmp, "metadata.json");
      writeFileSync(metadataPath, JSON.stringify({ samples: [] }), "utf8");

      const hints: Array<string | undefined> = [];
      const result = generateMissingBeatsReport(
        { archiveDir, metadataPath, outputRoot: join(tmp, "output") },
        {
          parseMixFn: (buf, hint) => {
            const tag = buf.toString("utf8");
            hints.push(hint);
            if (tag === "bad") return null;
            return { product: tag === "hh" ? "HipHop_eJay4" : "Rave" } as never;
          },
          buildResolverIndexFn: () => ({
            gen1: new Map([
              [
                "Rave",
                {
                  entries: Array.from({ length: 22 }, (_, id) => ({
                    id,
                    path: id === 21 ? "rekit1/01/r2bs306.pxd" : "",
                    bank: id === 21 ? "REKIT1" : null,
                    file: id === 21 ? "R2BS306" : null,
                    category: null,
                    group: null,
                    version: null,
                  })),
                },
              ],
            ]),
          }) as never,
          resolveMixFn: (ir) => {
            if (ir.product === "HipHop_eJay4") {
              return {
                total: 4,
                resolved: 1,
                unresolved: 3,
                tracks: [
                  { sampleRef: { rawId: 11, internalName: null, displayName: "logo", resolvedPath: null } },
                  { sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: null } },
                  { sampleRef: { rawId: 12, internalName: null, displayName: "hit01", resolvedPath: null } },
                  { sampleRef: { rawId: 12, internalName: null, displayName: "hit01", resolvedPath: null } },
                ],
              } as never;
            }

            return {
              total: 2,
              resolved: 0,
              unresolved: 2,
              tracks: [
                { sampleRef: { rawId: 21, internalName: null, displayName: null, resolvedPath: null } },
                { sampleRef: { rawId: 22, internalName: null, displayName: null, resolvedPath: "Bass/stem.wav" } },
              ],
            } as never;
          },
        },
      );

      expect(hints).toContain("GenerationPack1_HipHop");
      expect(result.indexedSamples).toBe(0);
      expect(result.mixFileCount).toBe(3);
      expect(result.parsedOk).toBe(2);
      expect(result.parseFailed).toBe(1);
      expect(result.totalRefs).toBe(6);
      expect(result.resolvedCount).toBe(1);
      expect(result.unresolvedCount).toBe(5);
      expect(result.report.total_missing_beats).toBe(2);
      expect(result.report.per_product).toEqual(
        expect.arrayContaining([
          { product: "HipHop_eJay4", missing_beats: 1 },
          { product: "Rave", missing_beats: 1 },
        ]),
      );
      expect(result.report.samples).toEqual([
        expect.objectContaining({ product: "HipHop_eJay4", filename: "hit01.wav", source: "hit01" }),
        expect.objectContaining({
          product: "Rave",
          filename: "R2BS306.wav",
          source: "rekit1/01/r2bs306.pxd",
          source_archive: "REKIT1",
        }),
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("gen-missing-beats-report CLI", () => {
  it("writes the missing-beats report for a real format-A mix", () => {
    const tmp = mkdtempSync(join(tmpdir(), "missing-beats-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const archiveDir = join(tmp, "archive");
      mkdirSync(join(archiveDir, "Rave", "MIX"), { recursive: true });
      writeFileSync(join(archiveDir, "Rave", "MIX", "demo.mix"), buildFormatA(APP_SIG_RAVE, [{ row: 0, col: 0, id: 42 }]));

      const metadataPath = join(tmp, "metadata.json");
      const outputPath = join(tmp, "logs", "missing-beats-report.json");
      writeFileSync(metadataPath, JSON.stringify({ samples: [] }), "utf8");

      expect(main(["--archive", archiveDir, "--metadata", metadataPath, "--output", outputPath])).toBe(0);

      const report = JSON.parse(readFileSync(outputPath, "utf8")) as { total_missing_beats: number; samples: Array<{ filename: string }> };
      expect(report.total_missing_beats).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.samples)).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Wrote"))).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});