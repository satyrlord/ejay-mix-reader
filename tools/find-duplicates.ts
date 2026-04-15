#!/usr/bin/env tsx

/**
 * find-duplicates.ts — Detect duplicate audio samples in the output/ directory.
 *
 * A "duplicate" is defined as two or more WAV files whose PCM data is identical
 * (regardless of filename or product). The WAV header is skipped so that
 * header-only differences do not produce false positives.
 *
 * Usage:
 *   tsx tools/find-duplicates.ts [--output-dir PATH] [--csv PATH]
 *   tsx tools/find-duplicates.ts --same-product
 *   tsx tools/find-duplicates.ts --cross-product
 */

import { createHash } from "crypto";
import { createWriteStream, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { parseArgs } from "util";

// --- WAV helpers ---

const RIFF_MAGIC = Buffer.from("RIFF", "ascii");
const WAVE_MAGIC = Buffer.from("WAVE", "ascii");
const DATA_ID = Buffer.from("data", "ascii");

/**
 * Return the byte offset of the first PCM sample in data.
 * Walks the RIFF/WAVE chunk tree to find the 'data' sub-chunk.
 * Returns 44 for non-RIFF files (conventional WAV header size).
 * Returns null when the file is a valid RIFF but the 'data' chunk is
 * absent or the chunk tree is malformed.
 */
export function pcmDataOffset(data: Buffer): number | null {
  if (data.length < 12 || !data.subarray(0, 4).equals(RIFF_MAGIC) || !data.subarray(8, 12).equals(WAVE_MAGIC)) {
    return 44; // not a RIFF/WAVE file — use conventional offset
  }

  let offset = 12; // skip RIFF header (4) + file size (4) + "WAVE" (4)
  while (offset + 8 <= data.length) {
    const chunkId = data.subarray(offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    if (chunkId.equals(DATA_ID)) {
      return offset + 8; // skip chunk id (4) + chunk size (4)
    }
    if (offset + 8 + chunkSize > data.length) {
      return null; // malformed chunk_size guard
    }
    offset += 8 + chunkSize;
    if (chunkSize & 1) offset += 1; // RIFF chunks are word-aligned
  }

  return null; // 'data' chunk not found
}

/**
 * Return the SHA-256 hex digest of the PCM payload of a WAV file.
 * Returns null if the file cannot be read or is not a valid WAV.
 */
export function hashPcm(filePath: string): string | null {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch (err) {
    console.warn(`  WARNING: cannot read ${filePath}: ${(err as Error).message}`);
    return null;
  }

  const offset = pcmDataOffset(data);
  if (offset === null) {
    console.warn(`  WARNING: ${filePath}: could not locate PCM data — skipping`);
    return null;
  }
  if (offset >= data.length) return null; // empty or header-only file

  const pcm = data.subarray(offset);
  if (pcm.length === 0) return null; // data chunk present but empty
  return createHash("sha256").update(pcm).digest("hex");
}

// --- Scanner ---

/** Recursively find all .wav files under a directory. */
function findWavFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    try {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
          results.push(fullPath);
        }
      }
    } catch {
      return;
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Walk outputDir and group WAV files by PCM hash.
 * Returns only groups with 2+ files (genuine duplicates).
 */
export function scanOutput(outputDir: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const wavFiles = findWavFiles(outputDir);
  let total = 0;

  for (const wav of wavFiles) {
    total++;
    const digest = hashPcm(wav);
    if (digest !== null) {
      const existing = groups.get(digest) ?? [];
      existing.push(wav);
      groups.set(digest, existing);
    }
  }

  console.log(`Scanned ${total} WAV files under ${outputDir}`);

  // Filter to only duplicate groups
  const duplicates = new Map<string, string[]>();
  for (const [hash, paths] of groups) {
    if (paths.length > 1) duplicates.set(hash, paths);
  }
  return duplicates;
}

// --- Filtering ---

function productOf(filePath: string, outputDir: string): string {
  try {
    const rel = relative(outputDir, filePath).replace(/\\/g, "/");
    const parts = rel.split("/");
    return parts[0] ?? filePath;
  } catch {
    return filePath;
  }
}

/**
 * Keep only groups where all files share the same product folder.
 */
export function filterSameProduct(groups: Map<string, string[]>, outputDir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [h, paths] of groups) {
    const products = new Set(paths.map((p) => productOf(p, outputDir)));
    if (products.size === 1) result.set(h, paths);
  }
  return result;
}

/**
 * Keep only groups where files span two or more product folders.
 */
export function filterCrossProduct(groups: Map<string, string[]>, outputDir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [h, paths] of groups) {
    const products = new Set(paths.map((p) => productOf(p, outputDir)));
    if (products.size > 1) result.set(h, paths);
  }
  return result;
}

// --- Reporting ---

export function printReport(groups: Map<string, string[]>, outputDir: string): void {
  if (groups.size === 0) {
    console.log("No duplicates found.");
    return;
  }

  let totalDupes = 0;
  for (const paths of groups.values()) totalDupes += paths.length - 1;
  console.log(`\nFound ${groups.size} duplicate group(s) — ${totalDupes} redundant file(s):\n`);

  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (let idx = 0; idx < sorted.length; idx++) {
    const [h, paths] = sorted[idx];
    console.log(`  Group ${idx + 1}  [${h.slice(0, 16)}…]  (${paths.length} files)`);
    for (const p of paths.sort()) {
      const rel = relative(outputDir, p).replace(/\\/g, "/");
      const sizeKb = statSync(p).size / 1024;
      console.log(`    ${rel}  (${sizeKb.toFixed(1)} KB)`);
    }
    console.log();
  }
}

export function writeCsv(groups: Map<string, string[]>, outputDir: string, csvPath: string): void {
  const stream = createWriteStream(csvPath, { encoding: "utf-8" });
  stream.write("hash_prefix,group,product,channel,filename,size_bytes\n");

  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (let idx = 0; idx < sorted.length; idx++) {
    const [h, paths] = sorted[idx];
    for (const p of paths.sort()) {
      const rel = relative(outputDir, p).replace(/\\/g, "/");
      const parts = rel.split("/");
      const product = parts[0] ?? "";
      const channel = parts.length > 1 ? parts[1] : "";
      const filename = parts[parts.length - 1] ?? p;
      const sizeBytes = statSync(p).size;
      stream.write(`${h.slice(0, 16)},${idx + 1},${product},${channel},${filename},${sizeBytes}\n`);
    }
  }

  stream.end();
  console.log(`CSV written to ${csvPath}`);
}

// --- CLI ---

/* v8 ignore start */
function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "output-dir": { type: "string", default: "output" },
      csv: { type: "string" },
      "same-product": { type: "boolean", default: false },
      "cross-product": { type: "boolean", default: false },
    },
    strict: true,
  });

  const outputDir = values["output-dir"] ?? "output";
  if (!statSync(outputDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`ERROR: output directory not found: ${outputDir}`);
    return 1;
  }

  let groups = scanOutput(outputDir);

  if (values["same-product"]) {
    groups = filterSameProduct(groups, outputDir);
    console.log("(showing same-product duplicates only)");
  } else if (values["cross-product"]) {
    groups = filterCrossProduct(groups, outputDir);
    console.log("(showing cross-product duplicates only)");
  }

  printReport(groups, outputDir);

  if (values.csv && groups.size > 0) {
    writeCsv(groups, outputDir, values.csv);
  }

  return 0;
}

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("find-duplicates.ts") || process.argv[1].endsWith("find-duplicates.js"));
if (isDirectRun) {
  process.exit(main());
}
/* v8 ignore stop */
