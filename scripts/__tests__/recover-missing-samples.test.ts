import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { buildSilentPcmWav } from "./wav-test-utils.js";
import {
  bpmFromPath,
  buildFileIndex,
  computeBeats,
  dedupKey,
  getOutputFilename,
  inferCategory,
  isUtilitySample,
  normalizeBasename,
  productHintForPath,
  refIdentifiers,
  runRecovery,
} from "../recover-missing-samples.js";

describe("recover-missing-samples helpers", () => {
  it("normalizes filenames and builds exact plus fuzzy wav indexes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "recover-helpers-index-"));
    try {
      mkdirSync(join(tmp, "nested"), { recursive: true });
      writeFileSync(join(tmp, "cowbellhigh 7.wav"), Buffer.from("wav"));
      writeFileSync(join(tmp, "nested", "Kick.wav"), Buffer.from("wav"));
      writeFileSync(join(tmp, "nested", "readme.txt"), "x");

      expect(normalizeBasename("cowbellhigh 7.wav")).toBe("cowbellhigh07");
      expect(normalizeBasename("Kick-08.WAV")).toBe("kick08");

      const index = new Map<string, string>();
      buildFileIndex(tmp, index);
      buildFileIndex(join(tmp, "missing"), index);

      expect(index.get("cowbellhigh 7.wav")).toBe(join(tmp, "cowbellhigh 7.wav"));
      expect(index.get("cowbellhigh07")).toBe(join(tmp, "cowbellhigh 7.wav"));
      expect(index.get("kick.wav")).toBe(join(tmp, "nested", "Kick.wav"));
      expect(index.get("kick")).toBe(join(tmp, "nested", "Kick.wav"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("classifies utility refs, path hints, identifiers, and dedupe keys", () => {
    expect(isUtilitySample({ filename: "voice.wav", source: "voice" })).toBe(true);
    expect(isUtilitySample({ filename: "sample.wav", source: "D_ejay3/ejay/ui.wav" })).toBe(true);
    expect(isUtilitySample({ filename: "sample.wav", source: "banks/sample.wav" })).toBe(false);

    expect(productHintForPath("_userdata/Hip Hop/demo.hh.mix")).toBe("HipHop_eJay4");
    expect(productHintForPath("GenerationPack1/Rave/demo.mix")).toBe("GenerationPack1_Rave");

    expect(refIdentifiers({ rawId: 7, internalName: null, displayName: "BankA/loop_160bpm" })).toEqual({
      filename: "BankA/loop_160bpm.wav",
      source: "BankA/loop_160bpm",
      internal_name: null,
      alias: "BankA/loop_160bpm",
    });
    expect(refIdentifiers({ rawId: 7, internalName: "bass01.9", displayName: null })).toEqual({
      filename: "BASS01.wav",
      source: "bass01.9",
      internal_name: "bass01.9",
      alias: null,
    });
    expect(
      refIdentifiers(
        { rawId: 7, internalName: null, displayName: null },
        { id: 7, path: "rekit1/01/r2bs306.pxd", bank: "REKIT1", file: "R2BS306", category: null, group: null, version: null },
      ),
    ).toEqual({
      filename: "R2BS306.wav",
      source: "rekit1/01/r2bs306.pxd",
      internal_name: null,
      alias: null,
    });
    expect(dedupKey("Rave", { filename: "x.wav", source: "Bass/One", internal_name: null, alias: null })).toBe(
      "Rave::bass/one",
    );
  });

  it("infers categories from explicit hints, resolved paths, source paths, prefixes, and fallback", () => {
    expect(inferCategory({
      product: "Rave",
      filename: "whatever.wav",
      internal_name: null,
      source: "x",
      source_archive: null,
      alias: null,
      category: "drum loop",
      detail: null,
      format: "wav",
    })).toBe("Drum");

    expect(inferCategory({
      product: "Rave",
      filename: "whatever.wav",
      internal_name: null,
      source: "x",
      source_archive: null,
      alias: null,
      category: null,
      detail: null,
      format: "wav",
    }, "D:/samples/Keys/piano.wav")).toBe("Keys");

    expect(inferCategory({
      product: "Rave",
      filename: "whatever.wav",
      internal_name: null,
      source: "voices/vox01",
      source_archive: null,
      alias: null,
      category: null,
      detail: null,
      format: "wav",
    })).toBe("Voice");

    expect(inferCategory({
      product: "Rave",
      filename: "FX123.wav",
      internal_name: null,
      source: "x",
      source_archive: null,
      alias: null,
      category: null,
      detail: null,
      format: "wav",
    })).toBe("Effect");

    expect(inferCategory({
      product: "Rave",
      filename: "mystery.wav",
      internal_name: null,
      source: "x",
      source_archive: null,
      alias: null,
      category: null,
      detail: null,
      format: "wav",
    })).toBe("Unsorted");
  });

  it("extracts BPM, computes beat counts, and strips output filenames", () => {
    expect(bpmFromPath("BankA/loop_160bpm")).toBe(160);
    expect(bpmFromPath("bad_10bpm")).toBeNull();
    expect(computeBeats(3, 160)).toBe(8);
    expect(computeBeats(1.125, 160)).toBe(3);
    expect(computeBeats(0, 160)).toBeNull();
    expect(getOutputFilename({
      product: "Rave",
      filename: "BankA/loop_160bpm.wav",
      internal_name: null,
      source: "BankA/loop_160bpm",
      source_archive: null,
      alias: null,
      category: null,
      detail: null,
      format: "wav",
    })).toBe("loop_160bpm.wav");
  });
});

describe("runRecovery", () => {
  it("regenerates the report, recovers found files, updates metadata, and applies the hh.mix hint override", () => {
    const tmp = mkdtempSync(join(tmpdir(), "recover-run-"));
    try {
      const archiveDir = join(tmp, "archive");
      const outputDir = join(tmp, "output");
      const externalA = join(tmp, "externalA");
      const externalB = join(tmp, "externalB");
      const reportPath = join(tmp, "logs", "missing-beats-report.json");
      const metadataPath = join(outputDir, "metadata.json");

      mkdirSync(join(archiveDir, "Rave"), { recursive: true });
      mkdirSync(join(archiveDir, "_userdata", "Hip Hop"), { recursive: true });
      mkdirSync(join(outputDir, "Bass"), { recursive: true });
      mkdirSync(join(externalA, "Drum", "BankA"), { recursive: true });
      mkdirSync(join(externalB, "Effect"), { recursive: true });
      mkdirSync(join(reportPath, ".."), { recursive: true });

      writeFileSync(join(archiveDir, "Rave", "one.mix"), Buffer.from("one", "utf8"));
      writeFileSync(join(archiveDir, "Rave", "two.mix"), Buffer.from("two", "utf8"));
      writeFileSync(join(archiveDir, "Rave", "bad.mix"), Buffer.from("bad", "utf8"));
      writeFileSync(join(archiveDir, "_userdata", "Hip Hop", "demo.hh.mix"), Buffer.from("hh", "utf8"));
      writeFileSync(reportPath, JSON.stringify({ stale: true }), "utf8");

      writeFileSync(
        metadataPath,
        JSON.stringify({
          generated_at: "2026-04-25T00:00:00.000Z",
          total_samples: 1,
          per_category: { Drum: 1 },
          samples: [
            {
              filename: "R2BS306.wav",
              source: "rekit1/01/r2bs306.pxd",
              alias: null,
              category: "Drum",
              subcategory: null,
              product: "Rave",
              original_filename: "id_1.wav",
              original_category: null,
            },
          ],
        }),
        "utf8",
      );

      writeFileSync(
        join(outputDir, "Bass", "BASS01.wav"),
        buildSilentPcmWav({ sampleRate: 22050, channels: 1, bitDepth: 16, numFrames: 22050 }),
      );
      writeFileSync(
        join(externalA, "Drum", "BankA", "loop_160bpm.wav"),
        buildSilentPcmWav({ sampleRate: 16000, channels: 1, bitDepth: 16, numFrames: 48000 }),
      );
      writeFileSync(join(externalB, "Effect", "badfx.wav"), Buffer.from("not-a-wav", "utf8"));

      const hints: Array<string | undefined> = [];
      const warnings: string[] = [];
      const result = runRecovery(
        {
          archiveDir,
          outputDir,
          reportPath,
          metadataPath,
          externalPath: `${externalA},${externalB}`,
        },
        {
          parseMixFn: (buf: Buffer, hint: string | undefined) => {
            const tag = buf.toString("utf8");
            hints.push(hint);
            if (tag === "bad") return null;
            if (tag === "two") return { product: "eJay_Studio" } as never;
            if (tag === "hh") return { product: "HipHop_eJay4" } as never;
            return { product: "Rave" } as never;
          },
          buildResolverIndexFn: () => ({
            gen1: new Map([
              [
                "Rave",
                {
                  entries: Array.from({ length: 2 }, (_, id) => ({
                    id,
                    path: id === 1 ? "rekit1/01/r2bs306.pxd" : "",
                    bank: id === 1 ? "REKIT1" : null,
                    file: id === 1 ? "R2BS306" : null,
                    category: null,
                    group: null,
                    version: null,
                  })),
                },
              ],
            ]),
          }) as never,
          resolveMixFn: (ir: { product: string }) => {
            if (ir.product === "eJay_Studio") {
              return {
                total: 1,
                resolved: 0,
                unresolved: 1,
                tracks: [
                  { sampleRef: { rawId: 70, internalName: null, displayName: "BankA/loop_160bpm", resolvedPath: null } },
                ],
              } as never;
            }
            if (ir.product === "HipHop_eJay4") {
              return {
                total: 1,
                resolved: 1,
                unresolved: 0,
                tracks: [
                  { sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "resolved.wav" } },
                ],
              } as never;
            }
            return {
              total: 6,
              resolved: 0,
              unresolved: 6,
              tracks: [
                { sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null } },
                { sampleRef: { rawId: 2, internalName: "BASS01.9", displayName: null, resolvedPath: null } },
                { sampleRef: { rawId: 3, internalName: null, displayName: "badfx", resolvedPath: null } },
                { sampleRef: { rawId: 99, internalName: null, displayName: null, resolvedPath: null } },
                { sampleRef: { rawId: 50, internalName: null, displayName: "logo", resolvedPath: null } },
                { sampleRef: { rawId: 2, internalName: "BASS01.9", displayName: null, resolvedPath: null } },
              ],
            } as never;
          },
          warn: undefined,
        } as never,
      );

      expect(hints).toContain("GenerationPack1_HipHop");
      expect(result.deletedExistingReport).toBe(true);
      expect(result.indexedSamples).toBe(1);
      expect(result.mixFileCount).toBe(4);
      expect(result.parsedOk).toBe(3);
      expect(result.parseFailed).toBe(1);
      expect(result.totalRefs).toBe(8);
      expect(result.resolvedCount).toBe(1);
      expect(result.unresolvedCount).toBe(7);
      expect(result.generatedReport.total_missing_beats).toBe(5);
      expect(result.alreadyKnown).toBe(1);
      expect(result.found).toBe(3);
      expect(result.notFound).toBe(1);
      expect(result.copied).toBe(2);
      expect(result.newEntries).toHaveLength(3);
      expect(result.notFoundList).toEqual(["Rave: id_99.wav"]);

      const writtenReport = JSON.parse(readFileSync(reportPath, "utf8")) as { total_missing_beats: number };
      expect(writtenReport.total_missing_beats).toBe(5);

      const writtenMeta = JSON.parse(readFileSync(metadataPath, "utf8")) as { total_samples: number; samples: Array<Record<string, unknown>> };
      expect(writtenMeta.total_samples).toBe(4);
      expect(writtenMeta.samples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ filename: "BASS01.wav", category: "Bass", product: "Rave" }),
          expect.objectContaining({ filename: "badfx.wav", category: "Effect", product: "Rave" }),
          expect.objectContaining({
            filename: "loop_160bpm.wav",
            category: "Drum",
            product: "eJay_Studio",
            bank: "BankA",
            bpm: 160,
            beats: 8,
          }),
        ]),
      );
      expect(readFileSync(join(outputDir, "Effect", "badfx.wav"), "utf8")).toBe("not-a-wav");
      expect(join(outputDir, "Drum", "loop_160bpm.wav")).toBeTruthy();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("recovers numbered internal-name stems from hyphenated external filenames", () => {
    const tmp = mkdtempSync(join(tmpdir(), "recover-humn-"));
    try {
      const archiveDir = join(tmp, "archive");
      const outputDir = join(tmp, "output");
      const externalDir = join(tmp, "external");
      const reportPath = join(tmp, "logs", "missing-beats-report.json");
      const metadataPath = join(outputDir, "metadata.json");

      mkdirSync(join(archiveDir, "TECHNO_EJAY"), { recursive: true });
      mkdirSync(join(outputDir), { recursive: true });
      mkdirSync(join(externalDir, "Drum"), { recursive: true });
      mkdirSync(join(reportPath, ".."), { recursive: true });

      writeFileSync(join(archiveDir, "TECHNO_EJAY", "demo.mix"), Buffer.from("techno", "utf8"));
      writeFileSync(
        metadataPath,
        JSON.stringify({ generated_at: "x", total_samples: 0, per_category: {}, samples: [] }),
        "utf8",
      );
      writeFileSync(
        join(externalDir, "Drum", "humn-13.wav"),
        buildSilentPcmWav({ sampleRate: 44100, channels: 1, bitDepth: 16, numFrames: 4410 }),
      );

      const result = runRecovery(
        {
          archiveDir,
          outputDir,
          reportPath,
          metadataPath,
          externalPath: externalDir,
        },
        {
          parseMixFn: (buf) => {
            if (buf.toString("utf8") !== "techno") return null;
            return { product: "Techno_eJay" } as never;
          },
          buildResolverIndexFn: () => ({ gen1: new Map() }) as never,
          resolveMixFn: () => ({
            total: 1,
            resolved: 0,
            unresolved: 1,
            tracks: [
              { sampleRef: { rawId: 0, internalName: "humn.13", displayName: null, resolvedPath: null } },
            ],
          }) as never,
        },
      );

      expect(result.generatedReport.samples).toEqual([
        expect.objectContaining({
          product: "Techno_eJay",
          filename: "HUMN.wav",
          internal_name: "humn.13",
          source: "humn.13",
        }),
      ]);
      expect(result.found).toBe(1);
      expect(result.notFound).toBe(0);
      expect(result.newEntries).toEqual([
        expect.objectContaining({
          filename: "HUMN.wav",
          product: "Techno_eJay",
          category: "Drum",
          internal_name: "humn.13",
        }),
      ]);
      expect(readFileSync(join(outputDir, "Drum", "HUMN.wav"))).toBeTruthy();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("recovers distinct samples that share a basename with existing metadata", () => {
    const tmp = mkdtempSync(join(tmpdir(), "recover-shared-basename-"));
    try {
      const archiveDir = join(tmp, "archive");
      const outputDir = join(tmp, "output");
      const externalDir = join(tmp, "external");
      const reportPath = join(tmp, "logs", "missing-beats-report.json");
      const metadataPath = join(outputDir, "metadata.json");

      mkdirSync(join(archiveDir, "Dance_eJay3"), { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      mkdirSync(join(externalDir, "Drum"), { recursive: true });
      mkdirSync(join(reportPath, ".."), { recursive: true });

      writeFileSync(join(archiveDir, "Dance_eJay3", "demo.mix"), Buffer.from("shared", "utf8"));
      writeFileSync(
        metadataPath,
        JSON.stringify({
          generated_at: "x",
          total_samples: 1,
          per_category: { Bass: 1 },
          samples: [
            {
              filename: "shared.wav",
              source: "bass/shared",
              alias: null,
              category: "Bass",
              subcategory: null,
              product: "Rave",
              original_filename: "shared.wav",
              original_category: null,
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(externalDir, "Drum", "shared.wav"),
        buildSilentPcmWav({ sampleRate: 44100, channels: 1, bitDepth: 16, numFrames: 4410 }),
      );

      const result = runRecovery(
        {
          archiveDir,
          outputDir,
          reportPath,
          metadataPath,
          externalPath: externalDir,
        },
        {
          parseMixFn: (buf) => {
            if (buf.toString("utf8") !== "shared") return null;
            return { product: "Dance_eJay3" } as never;
          },
          buildResolverIndexFn: () => ({ gen1: new Map() }) as never,
          resolveMixFn: () => ({
            total: 1,
            resolved: 0,
            unresolved: 1,
            tracks: [
              { sampleRef: { rawId: 0, internalName: null, displayName: "drum/shared", resolvedPath: null } },
            ],
          }) as never,
        },
      );

      expect(result.alreadyKnown).toBe(0);
      expect(result.found).toBe(1);
      expect(result.notFound).toBe(0);
      expect(result.newEntries).toEqual([
        expect.objectContaining({
          filename: "shared.wav",
          source: "drum/shared",
          category: "Drum",
          product: "Dance_eJay3",
        }),
      ]);

      const writtenMeta = JSON.parse(readFileSync(metadataPath, "utf8")) as {
        total_samples: number;
        per_category: Record<string, number>;
        samples: Array<Record<string, unknown>>;
      };
      expect(writtenMeta.total_samples).toBe(2);
      expect(writtenMeta.per_category).toEqual({ Bass: 1, Drum: 1 });
      expect(writtenMeta.samples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ filename: "shared.wav", category: "Bass", product: "Rave" }),
          expect.objectContaining({ filename: "shared.wav", category: "Drum", product: "Dance_eJay3" }),
        ]),
      );
      expect(readFileSync(join(outputDir, "Drum", "shared.wav"))).toBeTruthy();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports dry-run mode without deleting or mutating files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "recover-dry-run-"));
    try {
      const archiveDir = join(tmp, "archive");
      const outputDir = join(tmp, "output");
      const reportPath = join(tmp, "logs", "missing-beats-report.json");
      const metadataPath = join(outputDir, "metadata.json");
      const externalDir = join(tmp, "external");

      mkdirSync(archiveDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      mkdirSync(externalDir, { recursive: true });
      mkdirSync(join(reportPath, ".."), { recursive: true });

      writeFileSync(reportPath, JSON.stringify({ stale: true }), "utf8");
      writeFileSync(
        metadataPath,
        JSON.stringify({ generated_at: "x", total_samples: 0, per_category: {}, samples: [] }),
        "utf8",
      );

      const result = runRecovery(
        {
          dryRun: true,
          archiveDir,
          outputDir,
          reportPath,
          metadataPath,
          externalPath: externalDir,
        },
        {
          buildResolverIndexFn: () => ({}) as never,
        },
      );

      expect(result.deletedExistingReport).toBe(true);
      expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual({ stale: true });
      expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toEqual({ generated_at: "x", total_samples: 0, per_category: {}, samples: [] });
      expect(result.generatedReport.total_missing_beats).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});