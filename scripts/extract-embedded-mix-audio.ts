#!/usr/bin/env tsx

/**
 * extract-embedded-mix-audio.ts — Recover WAV payloads embedded directly
 * inside oversized eJay `.mix` files.
 *
 * Observed framing in large user-created Gen 2/3 mixes:
 *   <u16 pathBlockLen> <windowsPathBytes> 00 01 <u32 wavByteLength>
 *
 * The script scans `.mix` files above 100 KiB under `archive/` by default and
 * writes every recovered WAV into `output/Unsorted/` using deterministic
 * filenames derived from the source mix name plus the embedded WAV basename.
 *
 * Usage:
 *   tsx scripts/extract-embedded-mix-audio.ts
 *   tsx scripts/extract-embedded-mix-audio.ts --file archive/_userdata/.../song.mix
 *   tsx scripts/extract-embedded-mix-audio.ts --dry-run
 *   tsx scripts/extract-embedded-mix-audio.ts --out output/Unsorted
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, parse, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { EMBEDDED_MIX_MANIFEST_FILENAME, EMBEDDED_MIX_SUBCATEGORY_ID } from "../src/data.js";
import { hashPcm } from "./find-duplicates.js";
import { detectFormat } from "./mix-parser.js";
import { readWavInfo, type WavInfo } from "./wav-decode.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_ARCHIVE_DIR = join(ROOT, "archive");
export const DEFAULT_OUT_DIR = join(ROOT, "output", "Unsorted");
export const DEFAULT_THRESHOLD_BYTES = 100 * 1024;
export const DEFAULT_MANIFEST_FILENAME = EMBEDDED_MIX_MANIFEST_FILENAME;

const RIFF = 0x46464952; // "RIFF" little-endian
const WAVE = 0x45564157; // "WAVE"
const MIN_PATH_BYTES = 8;
const MAX_PATH_BYTES = 260;

export interface EmbeddedMixWavRecord extends WavInfo {
  mixPath: string;
  mixFormat: string | null;
  pathOffset: number;
  pathLength: number;
  embeddedPath: string;
  storedSize: number;
  riffOffset: number;
  byteLength: number;
}

export interface ExtractedEmbeddedMixWav extends EmbeddedMixWavRecord {
  outputPath: string;
  dedupeGroup?: string;
  dedupeGroupSize?: number;
  dedupeKept?: boolean;
}

export interface MixExtractionResult {
  mixPath: string;
  mixFormat: string | null;
  fileSize: number;
  embeddedCount: number;
  totalEmbeddedBytes: number;
  extracted: ExtractedEmbeddedMixWav[];
}

export interface ExtractEmbeddedMixAudioOptions {
  outDir?: string;
  dryRun?: boolean;
}

export type EmbeddedMixManifestEntry = ExtractedEmbeddedMixWav;

export interface EmbeddedMixOutputSummary {
  uniqueOutputs: number;
  duplicateGroups: number;
  redundantExtractions: number;
  uniqueBytes: number;
}

export interface EmbeddedMixManifest {
  generatedAt: string;
  archiveDir: string;
  outDir: string;
  thresholdBytes: number;
  totals: {
    mixes: number;
    embeddedWavs: number;
    bytes: number;
    uniqueOutputs: number;
    duplicateGroups: number;
    redundantExtractions: number;
    uniqueBytes: number;
  };
  mixes: Array<{
    mixPath: string;
    mixFormat: string | null;
    fileSize: number;
    embeddedCount: number;
    totalEmbeddedBytes: number;
  }>;
  extractions: EmbeddedMixManifestEntry[];
}

function isWindowsWavPath(value: string): boolean {
  return /^[A-Za-z]:\\[\x20-\x7e]{1,255}\.wav$/i.test(value);
}

function safeFileComponent(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "embedded";
}

function relativeLabel(filePath: string): string {
  const rel = relative(ROOT, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}

function normalizedPathKey(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function compareCanonicalRecords(left: ExtractedEmbeddedMixWav, right: ExtractedEmbeddedMixWav): number {
  return normalizedPathKey(left.embeddedPath).localeCompare(normalizedPathKey(right.embeddedPath), undefined, {
    sensitivity: "base",
  }) || normalizedPathKey(left.mixPath).localeCompare(normalizedPathKey(right.mixPath), undefined, {
    sensitivity: "base",
  }) || normalizedPathKey(left.outputPath).localeCompare(normalizedPathKey(right.outputPath), undefined, {
    sensitivity: "base",
  });
}

function canonicalOutputDir(outDir: string): string {
  return join(resolve(outDir), EMBEDDED_MIX_SUBCATEGORY_ID);
}

function reserveCanonicalOutputPath(
  outDir: string,
  record: ExtractedEmbeddedMixWav,
  digest: string,
  reserved: Map<string, string>,
): string {
  const targetDir = canonicalOutputDir(outDir);
  const baseStem = safeFileComponent(parse(record.embeddedPath).name) || safeFileComponent(parse(record.outputPath).name);
  const candidates = [
    `${baseStem}.wav`,
    `${baseStem}__${digest.slice(0, 8)}.wav`,
  ];

  let counter = 2;
  while (true) {
    const candidateName = candidates.shift() ?? `${baseStem}__${digest.slice(0, 8)}_${counter}.wav`;
    const candidatePath = join(targetDir, candidateName);
    const key = normalizedPathKey(candidatePath);
    const reservedDigest = reserved.get(key);
    if (reservedDigest && reservedDigest !== digest) {
      counter++;
      continue;
    }

    if (!existsSync(candidatePath)) {
      reserved.set(key, digest);
      return candidatePath;
    }

    const existingDigest = hashPcm(candidatePath);
    if (existingDigest === digest) {
      reserved.set(key, digest);
      return candidatePath;
    }

    counter++;
  }
}

function summarizeOutputLayout(results: MixExtractionResult[]): EmbeddedMixOutputSummary {
  const grouped = new Map<string, ExtractedEmbeddedMixWav[]>();

  for (const record of results.flatMap((result) => result.extracted)) {
    const key = normalizedPathKey(record.outputPath);
    const existing = grouped.get(key) ?? [];
    existing.push(record);
    grouped.set(key, existing);
  }

  const duplicateGroups = [...grouped.values()].filter((records) => records.length > 1).length;
  const redundantExtractions = [...grouped.values()].reduce((sum, records) => sum + Math.max(0, records.length - 1), 0);
  const uniqueBytes = [...grouped.values()].reduce((sum, records) => sum + (records[0]?.byteLength ?? 0), 0);

  return {
    uniqueOutputs: grouped.size,
    duplicateGroups,
    redundantExtractions,
    uniqueBytes,
  };
}

function outputNameForRecord(mixPath: string, record: EmbeddedMixWavRecord, index: number): string {
  const mixStem = safeFileComponent(parse(mixPath).name);
  const wavStem = safeFileComponent(parse(record.embeddedPath).name);
  return `${mixStem}__${String(index + 1).padStart(2, "0")}__${wavStem}.wav`;
}

function matchRecordAtRiff(
  buf: Buffer,
  mixPath: string,
  mixFormat: string | null,
  riffOffset: number,
): EmbeddedMixWavRecord | null {
  if (riffOffset + 12 > buf.length) return null;
  if (buf.readUInt32LE(riffOffset) !== RIFF || buf.readUInt32LE(riffOffset + 8) !== WAVE) {
    return null;
  }

  const riffChunkSize = buf.readUInt32LE(riffOffset + 4);
  const wavByteLength = riffChunkSize + 8;
  if (wavByteLength < 44 || riffOffset + wavByteLength > buf.length) {
    return null;
  }

  const minPathOffset = Math.max(0, riffOffset - (MAX_PATH_BYTES + 8));
  const maxPathOffset = Math.max(0, riffOffset - (MIN_PATH_BYTES + 6));

  for (let pathOffset = minPathOffset; pathOffset <= maxPathOffset; pathOffset++) {
    if (pathOffset + 2 > buf.length) break;

    const pathLength = buf.readUInt16LE(pathOffset);
    if (pathLength < MIN_PATH_BYTES || pathLength > MAX_PATH_BYTES + 2) continue;

    const pathStart = pathOffset + 2;
    const layouts = [
      {
        expectedRiffOffset: pathOffset + pathLength + 6,
        pathEnd: pathStart + pathLength - 2,
        markerOffset: pathStart + pathLength - 2,
        sizeOffset: pathStart + pathLength,
      },
      {
        expectedRiffOffset: pathOffset + pathLength + 8,
        pathEnd: pathStart + pathLength,
        markerOffset: pathStart + pathLength,
        sizeOffset: pathStart + pathLength + 2,
      },
    ];

    let embeddedPath: string | null = null;
    let storedSize = 0;
    for (const layout of layouts) {
      if (layout.expectedRiffOffset !== riffOffset) continue;
      if (layout.pathEnd <= pathStart || layout.sizeOffset + 4 > buf.length) continue;
      if (buf[layout.markerOffset] !== 0x00 || buf[layout.markerOffset + 1] !== 0x01) continue;

      const candidatePath = buf.toString("latin1", pathStart, layout.pathEnd);
      if (!isWindowsWavPath(candidatePath)) continue;

      const candidateStoredSize = buf.readUInt32LE(layout.sizeOffset);
      if (candidateStoredSize !== wavByteLength) continue;

      embeddedPath = candidatePath;
      storedSize = candidateStoredSize;
      break;
    }
    if (!embeddedPath) continue;

    const wavBuf = buf.subarray(riffOffset, riffOffset + wavByteLength);

    let wavInfo: WavInfo;
    try {
      wavInfo = readWavInfo(wavBuf);
    } catch {
      continue;
    }

    return {
      mixPath,
      mixFormat,
      pathOffset,
      pathLength,
      embeddedPath,
      storedSize,
      riffOffset,
      byteLength: wavByteLength,
      sampleRate: wavInfo.sampleRate,
      channels: wavInfo.channels,
      bitDepth: wavInfo.bitDepth,
      dataSize: wavInfo.dataSize,
      duration: wavInfo.duration,
    };
  }

  return null;
}

export function findEmbeddedMixWavs(
  buf: Buffer,
  mixPath: string,
  mixFormat: string | null = detectFormat(buf),
): EmbeddedMixWavRecord[] {
  const records: EmbeddedMixWavRecord[] = [];
  let searchOffset = 0;

  while (searchOffset + 12 <= buf.length) {
    const riffOffset = buf.indexOf("RIFF", searchOffset, "ascii");
    if (riffOffset < 0) break;

    const record = matchRecordAtRiff(buf, mixPath, mixFormat, riffOffset);
    if (record) {
      records.push(record);
      searchOffset = record.riffOffset + record.byteLength;
      continue;
    }

    searchOffset = riffOffset + 4;
  }

  return records;
}

export function discoverOversizedMixFiles(
  rootDir: string,
  thresholdBytes: number = DEFAULT_THRESHOLD_BYTES,
): string[] {
  const found: string[] = [];
  const queue: string[] = [resolve(rootDir)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!stats.isFile()) continue;
      if (!/\.mix$/i.test(entry)) continue;
      if (stats.size <= thresholdBytes) continue;
      found.push(fullPath);
    }
  }

  return found.sort();
}

export function extractEmbeddedMixAudio(
  mixPath: string,
  options: ExtractEmbeddedMixAudioOptions = {},
): MixExtractionResult {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  const buf = readFileSync(mixPath);
  const mixFormat = detectFormat(buf);
  const records = findEmbeddedMixWavs(buf, mixPath, mixFormat);
  const extracted: ExtractedEmbeddedMixWav[] = [];

  if (!options.dryRun && records.length > 0) {
    mkdirSync(outDir, { recursive: true });
  }

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const outputPath = join(outDir, outputNameForRecord(mixPath, record, index));

    if (!options.dryRun) {
      writeFileSync(outputPath, buf.subarray(record.riffOffset, record.riffOffset + record.byteLength));
    }

    extracted.push({
      ...record,
      outputPath,
    });
  }

  return {
    mixPath,
    mixFormat,
    fileSize: buf.length,
    embeddedCount: extracted.length,
    totalEmbeddedBytes: extracted.reduce((sum, record) => sum + record.byteLength, 0),
    extracted,
  };
}

export interface MainOptions {
  archiveDir?: string;
  outDir?: string;
  thresholdBytes?: number;
  dryRun?: boolean;
  file?: string;
  manifestOut?: string;
}

export function defaultManifestPath(outDir: string): string {
  return join(resolve(outDir), DEFAULT_MANIFEST_FILENAME);
}

export function canonicalizeExtractedOutputLayout(
  results: MixExtractionResult[],
  outDir: string,
): EmbeddedMixOutputSummary {
  const records = results.flatMap((result) => result.extracted);
  if (records.length === 0) {
    return {
      uniqueOutputs: 0,
      duplicateGroups: 0,
      redundantExtractions: 0,
      uniqueBytes: 0,
    };
  }

  const groups = new Map<string, ExtractedEmbeddedMixWav[]>();
  for (const record of records) {
    const digest = hashPcm(record.outputPath) ?? `path:${normalizedPathKey(record.outputPath)}`;
    const existing = groups.get(digest) ?? [];
    existing.push(record);
    groups.set(digest, existing);
  }

  mkdirSync(canonicalOutputDir(outDir), { recursive: true });
  const reservedPaths = new Map<string, string>();

  for (const [digest, duplicateRecords] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...duplicateRecords].sort(compareCanonicalRecords);
    const canonicalRecord = ordered[0];
    if (!canonicalRecord) continue;

    const targetPath = reserveCanonicalOutputPath(outDir, canonicalRecord, digest, reservedPaths);
    const targetKey = normalizedPathKey(targetPath);
    const canonicalKey = normalizedPathKey(canonicalRecord.outputPath);

    if (canonicalKey !== targetKey) {
      if (existsSync(targetPath)) {
        const existingDigest = hashPcm(targetPath);
        if (existingDigest === digest) {
          if (existsSync(canonicalRecord.outputPath)) {
            rmSync(canonicalRecord.outputPath, { force: true });
          }
        } else {
          renameSync(canonicalRecord.outputPath, targetPath);
        }
      } else {
        renameSync(canonicalRecord.outputPath, targetPath);
      }
    }

    for (const duplicateRecord of ordered.slice(1)) {
      if (normalizedPathKey(duplicateRecord.outputPath) === targetKey) continue;
      if (existsSync(duplicateRecord.outputPath)) {
        rmSync(duplicateRecord.outputPath, { force: true });
      }
    }

    for (const record of ordered) {
      record.outputPath = targetPath;
      record.dedupeGroup = digest.startsWith("path:") ? undefined : digest.slice(0, 16);
      record.dedupeGroupSize = ordered.length;
      record.dedupeKept = record === canonicalRecord;
    }
  }

  return summarizeOutputLayout(results);
}

export function buildExtractionManifest(
  results: MixExtractionResult[],
  {
    archiveDir,
    outDir,
    thresholdBytes,
  }: {
    archiveDir: string;
    outDir: string;
    thresholdBytes: number;
  },
): EmbeddedMixManifest {
  const outputSummary = summarizeOutputLayout(results);

  return {
    generatedAt: new Date().toISOString(),
    archiveDir: resolve(archiveDir),
    outDir: resolve(outDir),
    thresholdBytes,
    totals: {
      mixes: results.length,
      embeddedWavs: results.reduce((sum, result) => sum + result.embeddedCount, 0),
      bytes: results.reduce((sum, result) => sum + result.totalEmbeddedBytes, 0),
      uniqueOutputs: outputSummary.uniqueOutputs,
      duplicateGroups: outputSummary.duplicateGroups,
      redundantExtractions: outputSummary.redundantExtractions,
      uniqueBytes: outputSummary.uniqueBytes,
    },
    mixes: results.map((result) => ({
      mixPath: result.mixPath,
      mixFormat: result.mixFormat,
      fileSize: result.fileSize,
      embeddedCount: result.embeddedCount,
      totalEmbeddedBytes: result.totalEmbeddedBytes,
    })),
    extractions: results.flatMap((result) => result.extracted),
  };
}

export function writeExtractionManifest(
  results: MixExtractionResult[],
  {
    archiveDir,
    outDir,
    thresholdBytes,
    manifestOut = defaultManifestPath(outDir),
  }: {
    archiveDir: string;
    outDir: string;
    thresholdBytes: number;
    manifestOut?: string;
  },
): string {
  const outPath = resolve(manifestOut);
  const manifest = buildExtractionManifest(results, { archiveDir, outDir, thresholdBytes });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return outPath;
}

export function runExtraction(options: MainOptions = {}): MixExtractionResult[] {
  const archiveDir = resolve(options.archiveDir ?? DEFAULT_ARCHIVE_DIR);
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  const thresholdBytes = options.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;

  const mixPaths = options.file
    ? [resolve(options.file)]
    : discoverOversizedMixFiles(archiveDir, thresholdBytes);

  return mixPaths.map((mixPath) => extractEmbeddedMixAudio(mixPath, {
    outDir,
    dryRun: options.dryRun,
  }));
}

export function main(args: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      out: { type: "string" },
      archive: { type: "string" },
      json: { type: "boolean", default: false },
      "manifest-out": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "threshold-kb": { type: "string" },
    },
    strict: true,
  });

  const thresholdBytes = values["threshold-kb"]
    ? Number.parseInt(values["threshold-kb"], 10) * 1024
    : DEFAULT_THRESHOLD_BYTES;

  if (!Number.isFinite(thresholdBytes) || thresholdBytes < 0) {
    console.error("ERROR: --threshold-kb must be a non-negative integer");
    return 1;
  }

  const results = runExtraction({
    archiveDir: values.archive,
    outDir: values.out,
    thresholdBytes,
    dryRun: values["dry-run"],
    file: values.file,
    manifestOut: values["manifest-out"],
  });

  let manifestPath: string | null = null;
  let outputSummary: EmbeddedMixOutputSummary | null = null;
  if (!values["dry-run"]) {
    outputSummary = canonicalizeExtractedOutputLayout(results, values.out ?? DEFAULT_OUT_DIR);
    manifestPath = writeExtractionManifest(results, {
      archiveDir: values.archive ?? DEFAULT_ARCHIVE_DIR,
      outDir: values.out ?? DEFAULT_OUT_DIR,
      thresholdBytes,
      manifestOut: values["manifest-out"] ?? undefined,
    });
  }

  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const mode = values["dry-run"] ? "found" : "extracted";
    for (const result of results) {
      const fmt = result.mixFormat ?? "?";
      const count = String(result.embeddedCount).padStart(3);
      const bytes = String(result.totalEmbeddedBytes).padStart(10);
      console.log(
        `[${fmt}] ${basename(result.mixPath).padEnd(32)} ${mode}=${count} bytes=${bytes} ${relativeLabel(result.mixPath)}`,
      );
      for (const record of result.extracted) {
        console.log(
          `  ${parse(record.outputPath).base} <= ${record.embeddedPath} @0x${record.riffOffset.toString(16)}`,
        );
      }
    }

    const mixCount = results.length;
    const extractedCount = results.reduce((sum, result) => sum + result.embeddedCount, 0);
    const extractedBytes = results.reduce((sum, result) => sum + result.totalEmbeddedBytes, 0);
    console.log(`\nTotal oversized mixes=${mixCount} embedded WAVs=${extractedCount} bytes=${extractedBytes}`);
    if (outputSummary) {
      console.log(
        `Unique output WAVs=${outputSummary.uniqueOutputs} duplicate groups=${outputSummary.duplicateGroups} ` +
        `redundant=${outputSummary.redundantExtractions} uniqueBytes=${outputSummary.uniqueBytes}`,
      );
    }
    if (manifestPath) {
      console.log(`Manifest: ${relativeLabel(manifestPath)}`);
    }
  }

  return 0;
}

/* istanbul ignore next -- CLI entry point */
if (process.argv[1] && resolve(process.argv[1]).replace(/\\/g, "/").endsWith("scripts/extract-embedded-mix-audio.ts")) {
  process.exit(main());
}

