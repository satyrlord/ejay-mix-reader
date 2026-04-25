import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildExtractionManifest,
  canonicalizeExtractedOutputLayout,
  DEFAULT_THRESHOLD_BYTES,
  defaultManifestPath,
  discoverOversizedMixFiles,
  extractEmbeddedMixAudio,
  findEmbeddedMixWavs,
  main,
  runExtraction,
  writeExtractionManifest,
} from "../extract-embedded-mix-audio.js";
import { buildSilentPcmWav } from "./wav-test-utils.js";

function buildEmbeddedRecord(path: string, wav: Buffer): Buffer {
  const pathBytes = Buffer.from(path, "latin1");
  const header = Buffer.alloc(2 + pathBytes.length + 2 + 4);
  header.writeUInt16LE(pathBytes.length + 2, 0);
  pathBytes.copy(header, 2);
  header[2 + pathBytes.length] = 0x00;
  header[2 + pathBytes.length + 1] = 0x01;
  header.writeUInt32LE(wav.length, 2 + pathBytes.length + 2);
  return Buffer.concat([header, wav]);
}

function buildEmbeddedRecordAltLayout(path: string, wav: Buffer): Buffer {
  const pathBytes = Buffer.from(path, "latin1");
  const header = Buffer.alloc(2 + pathBytes.length + 2 + 4);
  header.writeUInt16LE(pathBytes.length, 0);
  pathBytes.copy(header, 2);
  header[2 + pathBytes.length] = 0x00;
  header[2 + pathBytes.length + 1] = 0x01;
  header.writeUInt32LE(wav.length, 2 + pathBytes.length + 2);
  return Buffer.concat([header, wav]);
}

function buildUnreadableRiffChunk(): Buffer {
  const wav = Buffer.alloc(44, 0);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36, 4);
  wav.write("WAVE", 8, "ascii");
  return wav;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findEmbeddedMixWavs", () => {
  it("finds embedded WAV records framed by a length-prefixed path", () => {
    const wav = buildSilentPcmWav({
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      numFrames: 32,
    });
    const mixBuf = Buffer.concat([
      Buffer.from("prefix", "latin1"),
      buildEmbeddedRecord("E:\\samples\\_eJay\\Kick01.wav", wav),
      Buffer.from("suffix", "latin1"),
    ]);

    const found = findEmbeddedMixWavs(mixBuf, "Test.mix", "C");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      mixPath: "Test.mix",
      mixFormat: "C",
      embeddedPath: "E:\\samples\\_eJay\\Kick01.wav",
      byteLength: wav.length,
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
    });
  });

  it("skips RIFF data that is not preceded by a valid embedded-path record", () => {
    const wav = buildSilentPcmWav({
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16,
      numFrames: 16,
    });
    const bogus = Buffer.concat([
      Buffer.from([0x10, 0x00]),
      Buffer.from("not-a-path", "latin1"),
      Buffer.from([0x00, 0x01]),
      wav,
    ]);

    expect(findEmbeddedMixWavs(bogus, "Bogus.mix", "B")).toEqual([]);
  });

  it("accepts the alternate framing layout and skips unreadable RIFF payloads", () => {
    const goodWav = buildSilentPcmWav({
      sampleRate: 22050,
      channels: 1,
      bitDepth: 16,
      numFrames: 12,
    });

    const mixBuf = Buffer.concat([
      buildEmbeddedRecordAltLayout("E:\\samples\\AltKick.wav", goodWav),
      Buffer.from("gap", "latin1"),
      buildEmbeddedRecordAltLayout("E:\\samples\\Broken.wav", buildUnreadableRiffChunk()),
    ]);

    const found = findEmbeddedMixWavs(mixBuf, "Alt.mix", null);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      mixPath: "Alt.mix",
      mixFormat: null,
      embeddedPath: "E:\\samples\\AltKick.wav",
      byteLength: goodWav.length,
      sampleRate: 22050,
      channels: 1,
      bitDepth: 16,
    });
  });

  it("skips RIFF markers with non-WAVE headers or truncated chunk sizes before finding a valid record", () => {
    const invalidHeader = Buffer.alloc(44, 0);
    invalidHeader.write("RIFF", 0, "ascii");
    invalidHeader.writeUInt32LE(36, 4);
    invalidHeader.write("NOPE", 8, "ascii");

    const truncated = Buffer.alloc(44, 0);
    truncated.write("RIFF", 0, "ascii");
    truncated.writeUInt32LE(200, 4);
    truncated.write("WAVE", 8, "ascii");

    const goodWav = buildSilentPcmWav({
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16,
      numFrames: 8,
    });

    const mixBuf = Buffer.concat([
      invalidHeader,
      truncated,
      buildEmbeddedRecord("E:\\samples\\Good.wav", goodWav),
    ]);

    const found = findEmbeddedMixWavs(mixBuf, "MixedHeaders.mix", "B");
    expect(found).toHaveLength(1);
    expect(found[0]!.embeddedPath).toBe("E:\\samples\\Good.wav");
  });
});

describe("extractEmbeddedMixAudio", () => {
  it("writes deterministic WAV files to the output directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-"));
    try {
      const mixPath = join(tmp, "My Huge Mix.mix");
      const outDir = join(tmp, "out");
      mkdirSync(outDir, { recursive: true });

      const wavA = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 8,
      });
      const wavB = buildSilentPcmWav({
        sampleRate: 22050,
        channels: 2,
        bitDepth: 16,
        numFrames: 8,
      });

      writeFileSync(mixPath, Buffer.concat([
        Buffer.from("prefix", "latin1"),
        buildEmbeddedRecord("D:\\eJay\\MixWaves\\kick01.wav", wavA),
        Buffer.from("middle", "latin1"),
        buildEmbeddedRecord("D:\\eJay\\MixWaves\\snare 02.WAV", wavB),
      ]));

      const result = extractEmbeddedMixAudio(mixPath, { outDir });
      expect(result.embeddedCount).toBe(2);
      expect(result.extracted.map((entry) => entry.outputPath.split(/[/\\]/).pop())).toEqual([
        "My_Huge_Mix__01__kick01.wav",
        "My_Huge_Mix__02__snare_02.wav",
      ]);
      expect(readFileSync(result.extracted[0]!.outputPath)).toEqual(wavA);
      expect(readFileSync(result.extracted[1]!.outputPath)).toEqual(wavB);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports dry runs without creating output files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-dry-run-"));
    try {
      const mixPath = join(tmp, "Dry Run.mix");
      const outDir = join(tmp, "out");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 8,
      });

      writeFileSync(mixPath, buildEmbeddedRecord("D:\\eJay\\MixWaves\\dry.wav", wav));

      const result = extractEmbeddedMixAudio(mixPath, { outDir, dryRun: true });
      expect(result.embeddedCount).toBe(1);
      expect(result.extracted[0]!.outputPath).toBe(join(outDir, "Dry_Run__01__dry.wav"));
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a manifest that maps each extracted wav back to its source mix", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-manifest-"));
    try {
      const mixPath = join(tmp, "Manifest Mix.mix");
      const outDir = join(tmp, "out");
      mkdirSync(outDir, { recursive: true });

      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 12,
      });

      writeFileSync(mixPath, Buffer.concat([
        buildEmbeddedRecord("D:\\eJay\\MixWaves\\effect001.wav", wav),
      ]));

      const results = [extractEmbeddedMixAudio(mixPath, { outDir })];
      const manifestPath = writeExtractionManifest(results, {
        archiveDir: tmp,
        outDir,
        thresholdBytes: DEFAULT_THRESHOLD_BYTES,
      });

      expect(manifestPath).toBe(defaultManifestPath(outDir));

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReturnType<typeof buildExtractionManifest>;
      expect(manifest.totals).toEqual({
        mixes: 1,
        embeddedWavs: 1,
        bytes: wav.length,
        uniqueOutputs: 1,
        duplicateGroups: 0,
        redundantExtractions: 0,
        uniqueBytes: wav.length,
      });
      expect(manifest.mixes).toEqual([
        expect.objectContaining({
          mixPath,
          embeddedCount: 1,
          totalEmbeddedBytes: wav.length,
        }),
      ]);
      expect(manifest.extractions).toEqual([
        expect.objectContaining({
          mixPath,
          embeddedPath: "D:\\eJay\\MixWaves\\effect001.wav",
          sampleRate: 44100,
          channels: 1,
          bitDepth: 16,
          riffOffset: expect.any(Number),
          outputPath: join(outDir, "Manifest_Mix__01__effect001.wav"),
        }),
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("canonicalizes duplicate extracted wavs into a grouped output folder", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-dedupe-"));
    try {
      const outDir = join(tmp, "output", "Unsorted");
      mkdirSync(outDir, { recursive: true });

      const mixA = join(tmp, "Needles.mix");
      const mixB = join(tmp, "Waterworld.mix");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        numFrames: 24,
      });

      writeFileSync(mixA, buildEmbeddedRecord("E:\\samples\\_eJay\\Kick01.wav", wav));
      writeFileSync(mixB, buildEmbeddedRecord("D:\\eJay\\Dance3\\MIXWAVES\\Kick01.wav", wav));

      const results = [
        extractEmbeddedMixAudio(mixA, { outDir }),
        extractEmbeddedMixAudio(mixB, { outDir }),
      ];

      const summary = canonicalizeExtractedOutputLayout(results, outDir);
      const canonicalPath = join(outDir, "embedded mix", "Kick01.wav");

      expect(summary).toEqual({
        uniqueOutputs: 1,
        duplicateGroups: 1,
        redundantExtractions: 1,
        uniqueBytes: wav.length,
      });
      expect(results[0]!.extracted[0]!.outputPath).toBe(canonicalPath);
      expect(results[1]!.extracted[0]!.outputPath).toBe(canonicalPath);
      expect(results.filter((result) => result.extracted[0]!.dedupeKept).length).toBe(1);
      expect(results[1]!.extracted[0]!.dedupeGroupSize).toBe(2);
      expect(readFileSync(canonicalPath)).toEqual(wav);
      expect(existsSync(join(outDir, "Needles__01__Kick01.wav"))).toBe(false);
      expect(existsSync(join(outDir, "Waterworld__01__Kick01.wav"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reuses an existing canonical file and suffixes basename collisions for distinct digests", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-collision-"));
    try {
      const outDir = join(tmp, "output", "Unsorted");
      mkdirSync(join(outDir, "embedded mix"), { recursive: true });

      const mixA = join(tmp, "Needles.mix");
      const mixB = join(tmp, "Waterworld.mix");
      const wavA = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        numFrames: 24,
      });
      const wavB = buildSilentPcmWav({
        sampleRate: 22050,
        channels: 1,
        bitDepth: 16,
        numFrames: 18,
      });

      const canonicalPath = join(outDir, "embedded mix", "Kick01.wav");
      writeFileSync(canonicalPath, wavA);
      writeFileSync(mixA, buildEmbeddedRecord("E:\\samples\\Kick01.wav", wavA));
      writeFileSync(mixB, buildEmbeddedRecord("D:\\eJay\\Kick01.wav", wavB));

      const results = [
        extractEmbeddedMixAudio(mixA, { outDir }),
        extractEmbeddedMixAudio(mixB, { outDir }),
      ];

      const summary = canonicalizeExtractedOutputLayout(results, outDir);
      const secondPath = results[1]!.extracted[0]!.outputPath;

      expect(summary).toEqual({
        uniqueOutputs: 2,
        duplicateGroups: 0,
        redundantExtractions: 0,
        uniqueBytes: wavA.length + wavB.length,
      });
      expect(results[0]!.extracted[0]!.outputPath).toBe(canonicalPath);
      expect(readFileSync(canonicalPath)).toEqual(wavA);
      expect(secondPath).toMatch(/Kick01__[0-9a-f]{8}\.wav$/i);
      expect(readFileSync(secondPath)).toEqual(wavB);
      expect(existsSync(join(outDir, "Needles__01__Kick01.wav"))).toBe(false);
      expect(existsSync(join(outDir, "Waterworld__01__Kick01.wav"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("suffixes the canonical filename when an existing target uses a different digest before reservation", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-preexisting-diff-"));
    try {
      const outDir = join(tmp, "output", "Unsorted");
      mkdirSync(join(outDir, "embedded mix"), { recursive: true });

      const mixPath = join(tmp, "Needles.mix");
      const existingWav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        numFrames: 24,
      });
      const freshWav = buildSilentPcmWav({
        sampleRate: 22050,
        channels: 1,
        bitDepth: 16,
        numFrames: 18,
      });

      const canonicalPath = join(outDir, "embedded mix", "Kick01.wav");
      writeFileSync(canonicalPath, existingWav);
      writeFileSync(mixPath, buildEmbeddedRecord("E:\\samples\\Kick01.wav", freshWav));

      const results = [extractEmbeddedMixAudio(mixPath, { outDir })];
      canonicalizeExtractedOutputLayout(results, outDir);

      expect(results[0]!.extracted[0]!.outputPath).toMatch(/Kick01__[0-9a-f]{8}\.wav$/i);
      expect(readFileSync(canonicalPath)).toEqual(existingWav);
      expect(readFileSync(results[0]!.extracted[0]!.outputPath)).toEqual(freshWav);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to a path-based dedupe key when PCM hashing cannot read the output file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-embedded-path-fallback-"));
    try {
      const outDir = join(tmp, "output", "Unsorted");
      mkdirSync(outDir, { recursive: true });

      const outputPath = join(outDir, "Broken__01__odd.wav");
      writeFileSync(outputPath, Buffer.from("not-a-wav", "utf8"));

      const results = [{
        mixPath: join(tmp, "Broken.mix"),
        mixFormat: null,
        fileSize: 8,
        embeddedCount: 1,
        totalEmbeddedBytes: 8,
        extracted: [{
          mixPath: join(tmp, "Broken.mix"),
          mixFormat: null,
          pathOffset: 0,
          pathLength: 0,
          embeddedPath: "E:\\samples\\odd.wav",
          storedSize: 8,
          riffOffset: 0,
          byteLength: 8,
          sampleRate: 0,
          channels: 0,
          bitDepth: 0,
          dataSize: 0,
          duration: 0,
          outputPath,
        }],
      }];

      const summary = canonicalizeExtractedOutputLayout(results, outDir);
      const canonicalPath = join(outDir, "embedded mix", "odd.wav");

      expect(summary).toEqual({
        uniqueOutputs: 1,
        duplicateGroups: 0,
        redundantExtractions: 0,
        uniqueBytes: 8,
      });
      const rawExtracted = results[0]!.extracted[0]!;
      const extracted = rawExtracted as typeof rawExtracted & {
        dedupeGroup?: string;
        dedupeKept?: boolean;
      };
      expect(extracted.outputPath).toBe(canonicalPath);
      expect(extracted.dedupeGroup).toBeUndefined();
      expect(extracted.dedupeKept).toBe(true);
      expect(readFileSync(canonicalPath, "utf8")).toBe("not-a-wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty summary when there are no extracted records", () => {
    expect(canonicalizeExtractedOutputLayout([], join(tmpdir(), "mix-embedded-empty"))).toEqual({
      uniqueOutputs: 0,
      duplicateGroups: 0,
      redundantExtractions: 0,
      uniqueBytes: 0,
    });
  });
});

describe("discoverOversizedMixFiles", () => {
  it("recursively lists only .mix files above the threshold", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-threshold-"));
    try {
      const nested = join(tmp, "nested");
      mkdirSync(nested, { recursive: true });

      const oversized = join(nested, "large.mix");
      const small = join(tmp, "small.mix");
      const note = join(nested, "note.txt");

      writeFileSync(oversized, Buffer.alloc(DEFAULT_THRESHOLD_BYTES + 1));
      writeFileSync(small, Buffer.alloc(DEFAULT_THRESHOLD_BYTES));
      writeFileSync(note, "ignore");

      expect(discoverOversizedMixFiles(tmp)).toEqual([oversized]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the root directory cannot be read", () => {
    expect(discoverOversizedMixFiles(join(tmpdir(), `missing-mix-root-${Date.now()}`))).toEqual([]);
  });
});

describe("runExtraction and main", () => {
  it("runExtraction discovers oversized mixes when no explicit file is provided", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-run-extraction-"));
    try {
      const archiveDir = join(tmp, "archive", "nested");
      const outDir = join(tmp, "out");
      mkdirSync(archiveDir, { recursive: true });

      const mixPath = join(archiveDir, "Auto.mix");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 8,
      });

      writeFileSync(mixPath, buildEmbeddedRecord("D:\\eJay\\MixWaves\\auto.wav", wav));

      const results = runExtraction({
        archiveDir: join(tmp, "archive"),
        outDir,
        thresholdBytes: 1,
        dryRun: true,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.mixPath).toBe(mixPath);
      expect(results[0]!.embeddedCount).toBe(1);
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("main rejects invalid threshold arguments", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(main(["--threshold-kb=-1"])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("ERROR: --threshold-kb must be a non-negative integer");
  });

  it("main supports dry-run JSON output without writing files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-main-json-"));
    try {
      const mixPath = join(tmp, "Json.mix");
      const outDir = join(tmp, "out");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 10,
      });

      writeFileSync(mixPath, buildEmbeddedRecord("D:\\eJay\\MixWaves\\json.wav", wav));

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(main(["--file", mixPath, "--out", outDir, "--dry-run", "--json"])).toBe(0);

      const payload = JSON.parse(String(logSpy.mock.calls[0]![0])) as Array<{ embeddedCount: number; extracted: Array<{ outputPath: string }> }>;
      expect(payload).toHaveLength(1);
      expect(payload[0]!.embeddedCount).toBe(1);
      expect(payload[0]!.extracted[0]!.outputPath).toBe(join(outDir, "Json__01__json.wav"));
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("main prints found-mode summaries during dry-run text output", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-main-dry-summary-"));
    try {
      const mixPath = join(tmp, "DrySummary.mix");
      const outDir = join(tmp, "out");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 10,
      });

      writeFileSync(mixPath, buildEmbeddedRecord("D:\\eJay\\MixWaves\\dry-summary.wav", wav));

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(main(["--file", mixPath, "--out", outDir, "--dry-run"])).toBe(0);

      const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("found=  1");
      expect(output).toContain("Total oversized mixes=1 embedded WAVs=1 bytes=");
      expect(output).not.toContain("Unique output WAVs=");
      expect(output).not.toContain("Manifest:");
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("main writes canonicalized outputs and a manifest in summary mode", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mix-main-summary-"));
    try {
      const mixPath = join(tmp, "Summary.mix");
      const outDir = join(tmp, "output", "Unsorted");
      const manifestOut = join(tmp, "reports", "embedded-manifest.json");
      const wav = buildSilentPcmWav({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 16,
        numFrames: 14,
      });

      writeFileSync(mixPath, buildEmbeddedRecord("D:\\eJay\\MixWaves\\summary.wav", wav));

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(main([
        "--file", mixPath,
        "--out", outDir,
        "--archive", tmp,
        "--manifest-out", manifestOut,
      ])).toBe(0);

      const canonicalPath = join(outDir, "embedded mix", "summary.wav");
      const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");

      expect(existsSync(canonicalPath)).toBe(true);
      expect(readFileSync(canonicalPath)).toEqual(wav);
      expect(existsSync(manifestOut)).toBe(true);
      expect(output).toContain("Total oversized mixes=1 embedded WAVs=1 bytes=");
      expect(output).toContain("Unique output WAVs=1 duplicate groups=0 redundant=0");
      expect(output).toContain(`Manifest: ${manifestOut}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

