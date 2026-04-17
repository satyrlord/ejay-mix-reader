#!/usr/bin/env tsx

/**
 * rename-samples.ts — Rename and normalise eJay sample filenames and metadata.
 *
 * Operations:
 * 1. Filenames: lowercase, keep only [a-z0-9-], collapse dashes.
 * 2. Group by base name (trailing -N segments stripped), renumber
 *    consecutively with consistent zero-padding. Singletons keep bare base.
 * 3. Metadata: update filename, alias, category, detail.
 *
 * Usage:
 *   tsx tools/rename-samples.ts --output-dir output
 *   tsx tools/rename-samples.ts --output-dir output --apply
 *   tsx tools/rename-samples.ts --output-dir output --product Dance_eJay1 --apply
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { readdirSync, statSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { parseArgs } from "util";
import { randomUUID } from "crypto";

// ── Types ────────────────────────────────────────────────────

export interface SampleEntry {
  filename: string;
  alias?: string;
  category?: string;
  channel?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface ProductMetadata {
  samples: SampleEntry[];
  total_samples?: number;
  alias_mode?: "derive-from-category" | "preserve-stem";
  [key: string]: unknown;
}

export interface RenameEntry {
  index: string;
  old_path: string;
  new_path: string;
  old_filename: string;
  new_filename: string;
  old_alias: string;
  new_alias: string;
  old_category: string;
  new_category: string;
  old_detail: string;
  new_detail: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Normalise a name: lowercase, keep a-z 0-9 -, collapse dashes. */
export function cleanName(name: string): string {
  let result = name.toLowerCase();
  result = result.replace(/[^a-z0-9-]/g, "-");
  result = result.replace(/-{2,}/g, "-");
  result = result.replace(/^-+|-+$/g, "");
  return result || "unnamed";
}

/** Return the absolute path to a sample's WAV file on disk. */
function physicalPath(productDir: string, sample: SampleEntry): string {
  const fn = sample.filename;
  if (fn.includes("/")) {
    return join(productDir, ...fn.split("/"));
  }
  const channel = String(sample.channel ?? sample.category ?? "unknown");
  return join(productDir, channel, fn);
}

/** Build the metadata `filename` value for a new stem. */
function newMetadataFilename(sample: SampleEntry, newStem: string): string {
  const fn = sample.filename;
  if (fn.includes("/")) {
    const prefix = fn.substring(0, fn.lastIndexOf("/"));
    return `${prefix}/${newStem}.wav`;
  }
  return `${newStem}.wav`;
}

/** Get file stem (basename without extension). */
function stemOf(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Iteratively strip trailing -N segments to find the core base name.
 *
 * "warm-line-1-01" → "warm-line"
 * "kick-e-fig-2"   → "kick-e-fig"
 * "synth"          → "synth"
 */
export function extractBase(stem: string): string {
  let base = stem;
  for (;;) {
    const m = base.match(/^(.+)-\d+$/);
    if (m) {
      base = m[1];
    } else {
      break;
    }
  }
  return base;
}

/** Extract all numeric segments from a stem for natural sorting. */
export function numericSortKey(stem: string): number[] {
  const matches = stem.match(/\d+/g);
  return matches ? matches.map(Number) : [];
}

/** Derive a clean alias by stripping the category prefix from the stem. */
export function deriveAlias(cleanStem: string, cleanCat: string): string {
  if (cleanCat && cleanStem.startsWith(cleanCat + "-")) {
    const candidate = cleanStem.slice(cleanCat.length + 1);
    if (candidate && candidate !== cleanCat) {
      return candidate;
    }
  }
  return cleanStem;
}

function resolveAlias(mode: ProductMetadata["alias_mode"], cleanStem: string, cleanCat: string): string {
  if (mode === "preserve-stem") {
    return cleanStem;
  }
  return deriveAlias(cleanStem, cleanCat);
}

// ── Core logic ───────────────────────────────────────────────

/**
 * Compute renames for every sample in meta.
 *
 * Returns only entries where something actually changes.
 */
export function planRenames(productDir: string, meta: ProductMetadata): RenameEntry[] {
  const samples = meta.samples;
  const aliasMode = meta.alias_mode;

  // Step 1 — compute clean stems, extract base names
  interface EntryInfo {
    i: number;
    oldPath: string;
    dirPath: string;
    cleanStem: string;
    base: string;
    sample: SampleEntry;
  }

  const entries: EntryInfo[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const oldPath = physicalPath(productDir, sample);
    const dirPath = dirname(oldPath);
    const stem = cleanName(stemOf(oldPath));
    const base = extractBase(stem);
    entries.push({ i, oldPath, dirPath, cleanStem: stem, base, sample });
  }

  // Step 2 — group by (directory, base) and assign consecutive numbers
  const dirBaseGroups = new Map<string, number[]>();
  for (let idx = 0; idx < entries.length; idx++) {
    const { dirPath, base } = entries[idx];
    const key = `${dirPath}\0${base}`;
    const list = dirBaseGroups.get(key) ?? [];
    list.push(idx);
    dirBaseGroups.set(key, list);
  }

  const finalStems = new Map<number, string>();

  for (const [, indices] of dirBaseGroups) {
    if (indices.length === 1) {
      finalStems.set(indices[0], entries[indices[0]].base);
    } else {
      indices.sort((a, b) => {
        const ka = numericSortKey(entries[a].cleanStem);
        const kb = numericSortKey(entries[b].cleanStem);
        for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
          const va = ka[i] ?? 0;
          const vb = kb[i] ?? 0;
          if (va !== vb) return va - vb;
        }
        return String(entries[a].sample.filename).localeCompare(String(entries[b].sample.filename));
      });

      const width = Math.max(2, String(indices.length).length);
      for (let seq = 0; seq < indices.length; seq++) {
        const idx = indices[seq];
        finalStems.set(idx, `${entries[idx].base}-${String(seq + 1).padStart(width, "0")}`);
      }
    }
  }

  // Step 3 — build rename plan
  const plan: RenameEntry[] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const { i, oldPath, sample } = entries[idx];
    const newStem = finalStems.get(idx)!;
    const newPath = join(dirname(oldPath), `${newStem}.wav`);
    const newFilename = newMetadataFilename(sample, newStem);

    const oldAlias = String(sample.alias ?? "");
    const oldCat = String(sample.category ?? "");
    const oldDetail = String(sample.detail ?? "");
    const oldFilename = sample.filename;

    const newCat = oldCat ? cleanName(oldCat) : "";
    const newDetail = oldDetail ? cleanName(oldDetail) : "";
    const newAlias = resolveAlias(aliasMode, newStem, newCat);

    const changed =
      oldPath !== newPath ||
      oldFilename !== newFilename ||
      oldAlias !== newAlias ||
      oldCat !== newCat ||
      oldDetail !== newDetail;

    if (!changed) continue;

    plan.push({
      index: String(i),
      old_path: oldPath,
      new_path: newPath,
      old_filename: oldFilename,
      new_filename: newFilename,
      old_alias: oldAlias,
      new_alias: newAlias,
      old_category: oldCat,
      new_category: newCat,
      old_detail: oldDetail,
      new_detail: newDetail,
    });
  }

  return plan;
}

/**
 * Execute renames on disk and update meta in-place.
 *
 * Uses temporary file names to avoid conflicts when two files swap names.
 * Returns the number of files renamed on disk.
 */
export function applyRenames(productDir: string, meta: ProductMetadata, plan: RenameEntry[]): number {
  const samples = meta.samples;

  // Phase 1 — rename files to temp names
  const tempMap = new Map<string, { originalPath: string; tempPath: string; finalPath: string }>();
  let diskRenames = 0;

  for (const entry of plan) {
    const oldPath = entry.old_path;
    const newPath = entry.new_path;

    if (oldPath !== newPath && existsSync(oldPath)) {
      let tempName = `.tmp_${randomUUID().replace(/-/g, "").slice(0, 12)}.wav`;
      let tempPath = join(dirname(oldPath), tempName);
      // Retry once on the astronomically unlikely chance of a UUID collision.
      if (existsSync(tempPath)) {
        tempName = `.tmp_${randomUUID().replace(/-/g, "").slice(0, 12)}.wav`;
        tempPath = join(dirname(oldPath), tempName);
      }
      renameSync(oldPath, tempPath);
      tempMap.set(entry.index, { originalPath: oldPath, tempPath, finalPath: newPath });
    }
  }

  // Phase 2 — rename temp files to final names
  const finalizedEntries: Array<{ originalPath: string; finalPath: string }> = [];
  try {
    for (const [, { originalPath, tempPath, finalPath }] of tempMap) {
      mkdirSync(dirname(finalPath), { recursive: true });
      renameSync(tempPath, finalPath);
      finalizedEntries.push({ originalPath, finalPath });
      diskRenames++;
    }
  } catch (err) {
    // Roll back both completed and pending renames to keep originals intact.
    for (let i = finalizedEntries.length - 1; i >= 0; i--) {
      const { originalPath, finalPath } = finalizedEntries[i];
      try {
        mkdirSync(dirname(originalPath), { recursive: true });
        renameSync(finalPath, originalPath);
      } catch {
        // best-effort rollback — preserve the original error below
      }
    }
    for (const [, { originalPath, tempPath }] of tempMap) {
      try {
        if (existsSync(tempPath)) {
          mkdirSync(dirname(originalPath), { recursive: true });
          renameSync(tempPath, originalPath);
        }
      } catch {
        // best-effort rollback — preserve the original error below
      }
    }
    throw err;
  }

  // Phase 3 — update metadata in-place
  for (const entry of plan) {
    const i = parseInt(entry.index, 10);
    const sample = samples[i];
    sample.filename = entry.new_filename;
    sample.alias = entry.new_alias;
    if (entry.new_category) {
      sample.category = entry.new_category;
    }
    if ("detail" in sample) {
      sample.detail = entry.new_detail;
    }
  }

  return diskRenames;
}

// ── CLI ──────────────────────────────────────────────────────

/* v8 ignore start */
function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "output-dir": { type: "string", default: "output" },
      product: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });

  const outputDir = values["output-dir"] ?? "output";
  if (!statSync(outputDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`ERROR: Output directory not found: ${outputDir}`);
    process.exit(1);
  }

  let products: string[];
  if (values.product) {
    const p = join(outputDir, values.product);
    if (!statSync(p, { throwIfNoEntry: false })?.isDirectory()) {
      console.error(`ERROR: Product directory not found: ${p}`);
      process.exit(1);
    }
    products = [p];
  } else {
    products = readdirSync(outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(outputDir, d.name, "metadata.json")))
      .map((d) => join(outputDir, d.name))
      .sort();
  }

  let totalDisk = 0;
  let totalMeta = 0;

  for (const productDir of products) {
    const metaPath = join(productDir, "metadata.json");
    const meta: ProductMetadata = JSON.parse(readFileSync(metaPath, "utf-8"));

    const plan = planRenames(productDir, meta);
    if (!plan.length) continue;

    const diskChanges = plan.filter((e) => e.old_path !== e.new_path).length;
    console.log(`\n${basename(productDir)}: ${plan.length} changes (${diskChanges} file renames)`);

    for (const entry of plan.slice(0, 5)) {
      if (entry.old_path !== entry.new_path) {
        const oldRel = relative(outputDir, entry.old_path).replace(/\\/g, "/");
        const newRel = relative(outputDir, entry.new_path).replace(/\\/g, "/");
        console.log(`  ${oldRel} -> ${newRel}`);
      } else {
        console.log(`  meta-only: ${entry.old_filename}`);
      }
      if (entry.old_alias !== entry.new_alias) {
        console.log(`    alias: '${entry.old_alias}' -> '${entry.new_alias}'`);
      }
    }
    if (plan.length > 5) {
      console.log(`  ... and ${plan.length - 5} more`);
    }

    if (values.apply) {
      const renamed = applyRenames(productDir, meta, plan);
      if (meta.total_samples !== undefined) {
        meta.total_samples = meta.samples.length;
      }
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
      totalDisk += renamed;
      totalMeta += plan.length;
      console.log(`  Applied: ${renamed} files renamed, ${plan.length} metadata entries updated`);
    }
  }

  if (values.apply) {
    console.log(`\nTotal: ${totalDisk} files renamed, ${totalMeta} metadata entries updated`);
  } else {
    console.log("\nDry run — no changes made. Use --apply to execute.");
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("rename-samples.ts") || process.argv[1].endsWith("rename-samples.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
