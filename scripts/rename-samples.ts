#!/usr/bin/env tsx

/**
 * rename-samples.ts — Normalise filenames in the flat output structure.
 *
 * Reads the consolidated output/metadata.json and renames sample files:
 * 1. Filenames: lowercase, keep only [a-z0-9-], collapse dashes.
 * 2. Group by base name (trailing -N segments stripped), renumber
 *    consecutively with consistent zero-padding. Singletons keep bare base.
 * 3. Only the filename field is updated — alias, detail, category,
 *    subcategory, and all other metadata fields are preserved as-is.
 *
 * Usage:
 *   tsx scripts/rename-samples.ts
 *   tsx scripts/rename-samples.ts --apply
 *   tsx scripts/rename-samples.ts --product eJay_Studio --apply
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { parseArgs } from "util";
import { randomUUID } from "crypto";

// ── Types ────────────────────────────────────────────────────

export interface SampleEntry {
  filename: string;
  alias?: string;
  category?: string;
  subcategory?: string | null;
  channel?: string;
  detail?: string;
  product?: string;
  [key: string]: unknown;
}

export interface ConsolidatedMetadata {
  samples: SampleEntry[];
  [key: string]: unknown;
}

export interface RenameEntry {
  index: number;
  old_path: string;
  new_path: string;
  old_filename: string;
  new_filename: string;
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
function physicalPath(outputRoot: string, sample: SampleEntry): string {
  const cat = sample.category ?? "Unsorted";
  const parts = [outputRoot, cat];
  if (sample.subcategory) {
    parts.push(sample.subcategory);
  }
  parts.push(sample.filename);
  return join(...parts);
}

/** Get file stem (basename without extension). */
function stemOf(filename: string): string {
  const base = basename(filename);
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

// ── Core logic ───────────────────────────────────────────────

/**
 * Compute renames for every sample in the consolidated metadata.
 *
 * Only changes filenames on disk — alias, detail, category, subcategory,
 * and all other metadata fields are preserved as-is.
 *
 * Pass `options.product` to limit processing to a single product.
 *
 * Returns only entries where the filename actually changes.
 * Throws if two samples would collide after cleaning. Collision checks include
 * skipped files and compare case-insensitively to match Windows filesystem behavior.
 */
export function planRenames(
  outputRoot: string,
  meta: ConsolidatedMetadata,
  options?: { product?: string },
): RenameEntry[] {
  const samples = meta.samples;

  interface EntryInfo {
    i: number;
    oldPath: string;
    dirPath: string;
    cleanStem: string;
    base: string;
    sample: SampleEntry;
    skip: boolean;
  }

  const entries: EntryInfo[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const skip = options?.product ? sample.product !== options.product : false;
    const oldPath = physicalPath(outputRoot, sample);
    const dirPath = dirname(oldPath);
    const stem = cleanName(stemOf(sample.filename));
    const base = extractBase(stem);
    entries.push({ i, oldPath, dirPath, cleanStem: stem, base, sample, skip });
  }

  // Group by (directory, base) — only non-skipped entries participate
  const dirBaseGroups = new Map<string, number[]>();
  for (let idx = 0; idx < entries.length; idx++) {
    if (entries[idx].skip) continue;
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
        return entries[a].sample.filename.localeCompare(entries[b].sample.filename);
      });

      const width = Math.max(2, String(indices.length).length);
      for (let seq = 0; seq < indices.length; seq++) {
        const idx = indices[seq];
        finalStems.set(idx, `${entries[idx].base}-${String(seq + 1).padStart(width, "0")}`);
      }
    }
  }

  // Collision check: ensure no two samples end up with the same filename
  // in the same directory. Compare case-insensitively for Windows safety.
  const occupied = new Map<string, number>();

  // Register skipped files (not being renamed — keep original filenames)
  for (let idx = 0; idx < entries.length; idx++) {
    if (entries[idx].skip) {
      const key = `${entries[idx].dirPath}\0${entries[idx].sample.filename.toLowerCase()}`;
      occupied.set(key, idx);
    }
  }

  // Register and check all planned final filenames
  for (const [idx, stem] of finalStems) {
    const newFilename = `${stem}.wav`;
    const key = `${entries[idx].dirPath}\0${newFilename}`;
    const prev = occupied.get(key);
    if (prev !== undefined) {
      throw new Error(
        `Filename collision: "${entries[prev].sample.filename}" and ` +
        `"${entries[idx].sample.filename}" both map to "${newFilename}"`,
      );
    }
    occupied.set(key, idx);
  }

  // Build plan — only include entries where filename actually changes
  const plan: RenameEntry[] = [];

  for (const [idx, stem] of finalStems) {
    const { i, oldPath, sample } = entries[idx];
    const newFilename = `${stem}.wav`;
    const newPath = join(dirname(oldPath), newFilename);

    if (sample.filename === newFilename) continue;

    plan.push({
      index: i,
      old_path: oldPath,
      new_path: newPath,
      old_filename: sample.filename,
      new_filename: newFilename,
    });
  }

  return plan;
}

/**
 * Execute renames on disk and update meta.samples[].filename in-place.
 * Only the filename field is modified — all other metadata is preserved.
 *
 * Uses temporary file names to avoid conflicts when two files swap names.
 * Returns the number of files renamed on disk.
 */
export function applyRenames(_outputRoot: string, meta: ConsolidatedMetadata, plan: RenameEntry[]): number {
  const samples = meta.samples;

  // Phase 1 — rename files to temp names
  const tempMap = new Map<number, { originalPath: string; tempPath: string; finalPath: string }>();

  for (const entry of plan) {
    if (entry.old_path !== entry.new_path && existsSync(entry.old_path)) {
      let tempPath: string;
      for (;;) {
        const tempName = `.tmp_${randomUUID().replace(/-/g, "").slice(0, 12)}.wav`;
        tempPath = join(dirname(entry.old_path), tempName);
        if (!existsSync(tempPath)) break;
      }
      renameSync(entry.old_path, tempPath);
      tempMap.set(entry.index, { originalPath: entry.old_path, tempPath, finalPath: entry.new_path });
    }
  }

  // Phase 2 — rename temp files to final names
  let diskRenames = 0;
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

  // Phase 3 — update metadata in-place (filename only)
  for (const entry of plan) {
    samples[entry.index].filename = entry.new_filename;
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
  const metaPath = join(outputDir, "metadata.json");

  if (!existsSync(metaPath)) {
    console.error(`ERROR: metadata.json not found at: ${metaPath}`);
    process.exit(1);
  }

  let meta: ConsolidatedMetadata;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch (err) {
    console.error(`ERROR: cannot parse metadata.json — ${(err as Error).message}`);
    process.exit(1);
  }

  const plan = planRenames(outputDir, meta, { product: values.product });

  if (!plan.length) {
    console.log("No renames needed.");
    return;
  }

  const diskChanges = plan.filter((e) => e.old_path !== e.new_path).length;
  console.log(`${plan.length} changes planned (${diskChanges} file renames)`);

  for (const entry of plan.slice(0, 10)) {
    const oldRel = relative(outputDir, entry.old_path).replace(/\\/g, "/");
    const newRel = relative(outputDir, entry.new_path).replace(/\\/g, "/");
    console.log(`  ${oldRel} -> ${newRel}`);
  }
  if (plan.length > 10) {
    console.log(`  ... and ${plan.length - 10} more`);
  }

  if (values.apply) {
    const renamed = applyRenames(outputDir, meta, plan);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
    console.log(`Applied: ${renamed} files renamed, ${plan.length} metadata entries updated`);
    console.log("Run `npm run build` to rebuild data/index.json");
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
