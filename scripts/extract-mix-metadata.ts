#!/usr/bin/env tsx

/**
 * extract-mix-metadata.ts — Standalone script that parses every archived
 * `.mix` file and writes a per-product metadata manifest to
 * `data/mix-metadata.json`.
 *
 * The manifest maps product IDs to per-filename metadata objects so that
 * callers (build-index, browser tooling) can look up parsed details without
 * re-parsing the binary on every build.
 *
 * Usage:
 *   tsx scripts/extract-mix-metadata.ts          # writes data/mix-metadata.json
 *   tsx scripts/extract-mix-metadata.ts --dry-run # print JSON to stdout, no file write
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { parseMix } from "./mix-parser.js";
import { ARCHIVE_MIX_DIRS, buildUserdataMixLibrary, collectProductMixes } from "./build-index.js";
import type { MixFileMeta } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_DIR = join(ROOT, "archive");
const DATA_DIR = join(ROOT, "data");
const OUT_FILE = join(DATA_DIR, "mix-metadata.json");

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface ExtractOptions {
  dryRun?: boolean;
  archiveDir?: string;
  outFile?: string;
}

// ── Core extraction ───────────────────────────────────────────────────────────

/**
 * Convert a parsed `MixIR` into a compact `MixFileMeta` for storage.
 * Returns `null` when parsing failed.
 */
export function irToMeta(ir: ReturnType<typeof parseMix>): MixFileMeta | null {
  if (!ir) return null;

  const meta: MixFileMeta = {
    format: ir.format,
    bpm: ir.bpm,
    trackCount: ir.tracks.length,
    catalogs: ir.catalogs.map((c) => c.name),
  };

  if (ir.bpmAdjusted !== null && ir.bpmAdjusted !== ir.bpm) {
    meta.bpmAdjusted = ir.bpmAdjusted;
  }
  if (ir.title) meta.title = ir.title;
  if (ir.author) meta.author = ir.author;
  if (ir.tickerText.length > 0) meta.tickerText = ir.tickerText;

  return meta;
}

/** Manifest shape written to `data/mix-metadata.json`. */
export type MixMetadataManifest = Record<string, Record<string, MixFileMeta>>;

/**
 * Build the full manifest by parsing every `.mix` file in every registered
 * product archive folder.
 */
export function buildMetadataManifest(
  archiveDir: string = ARCHIVE_DIR,
): MixMetadataManifest {
  const manifest: MixMetadataManifest = {};
  const totals = { total: 0, failed: 0 };

  for (const productId of Object.keys(ARCHIVE_MIX_DIRS).sort()) {
    const layout = ARCHIVE_MIX_DIRS[productId];
    if (!layout) continue;

    const productArchivePath = join(archiveDir, layout.archiveDir);
    if (!existsSync(productArchivePath)) continue;

    // Re-use `collectProductMixes` to discover .mix files for this product.
    const entries = collectProductMixes(productId, archiveDir);
    if (entries.length === 0) continue;

    const productManifest: Record<string, MixFileMeta> = {};

    for (const entry of entries) {
      const filePath = join(productArchivePath, layout.mixSubdir, entry.filename);
      if (!existsSync(filePath)) continue;

      let buf: Buffer;
      try {
        buf = readFileSync(filePath);
      } /* istanbul ignore next -- race condition: file deleted between collectProductMixes and readFileSync */ catch (err) {
        console.warn(`WARNING: could not read ${filePath}: ${String(err)}`);
        totals.failed++;
        continue;
      }

      const ir = parseMix(buf, productId);
      const meta = irToMeta(ir);
      /* istanbul ignore next -- parseMix returns null only for unrecognised formats, already filtered by scanMixDir */
      if (!meta) {
        console.warn(`WARNING: could not parse ${filePath}`);
        totals.failed++;
        continue;
      }

      productManifest[entry.filename] = meta;
      totals.total++;
    }

    if (Object.keys(productManifest).length > 0) {
      manifest[productId] = productManifest;
    }
  }

  appendUserdataMetadata(manifest, archiveDir, totals);

  console.log(`Extracted metadata for ${totals.total} .mix files (${totals.failed} failed).`);
  return manifest;
}

/**
 * Extend a manifest in-place with metadata for all mixes found under
 * `archive/_userdata`. Each group is stored under its group ID
 * (e.g. `_userdata/_unsorted`). Re-uses the metadata already parsed by
 * `buildUserdataMixLibrary` → `scanMixDir` so the files are not read twice.
 */
function appendUserdataMetadata(
  manifest: MixMetadataManifest,
  archiveDir: string,
  totals: { total: number; failed: number },
): void {
  const groups = buildUserdataMixLibrary(archiveDir);
  for (const group of groups) {
    const groupManifest: Record<string, MixFileMeta> = {};
    for (const entry of group.mixes) {
      if (entry.meta) {
        groupManifest[entry.filename] = entry.meta;
        totals.total++;
      } /* istanbul ignore next -- parseMix throws are already handled inside scanMixDir */ else {
        console.warn(`WARNING: no metadata available for ${group.id}/${entry.filename}`);
        totals.failed++;
      }
    }
    if (Object.keys(groupManifest).length > 0) {
      manifest[group.id] = groupManifest;
    }
  }
}

/**
 * Write `manifest` to `outFile` as formatted JSON.
 */
export function writeManifest(
  manifest: MixMetadataManifest,
  outFile: string = OUT_FILE,
): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${outFile}`);
}

// ── CLI entry point ───────────────────────────────────────────────────────────

/* istanbul ignore next -- CLI entry point, not exercised by unit tests */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
    },
    strict: false,
  });

  const manifest = buildMetadataManifest();

  if (values["dry-run"]) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    writeManifest(manifest);
  }
}
