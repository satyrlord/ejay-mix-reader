#!/usr/bin/env tsx

/**
 * sequence-migrate.ts — Promote loop-intended `Keys` samples to `Sequence`.
 *
 * Reads the consolidated normalized manifest at `<root>/metadata.json`,
 * runs PCM analysis on every sample currently classified as `Keys`,
 * and (when the analysis matches the promotion rule) moves the WAV file
 * from `<root>/Keys/` to `<root>/Sequence/` and updates its metadata
 * record in-place.
 *
 * The PCM analysis is cached on each sample under a stable schema:
 *   {
 *     duration: number,    // seconds (overrides any prior value)
 *     beats: number,       // float, computed from duration * bpm / 60
 *     transients: number,
 *     loopable: boolean,
 *   }
 *
 * Usage:
 *   tsx scripts/sequence-migrate.ts
 *   tsx scripts/sequence-migrate.ts --dry-run
 *   tsx scripts/sequence-migrate.ts --root output --reanalyze
 *
 * `--reanalyze` ignores the cache and decodes every Keys WAV again.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

import { decodeWavFile } from "./wav-decode.js";
import {
  analyze,
  shouldPromoteToSequence,
  type SampleAnalysis,
} from "./sequence-detect.js";

const SOURCE_CATEGORY = "Keys";
const TARGET_CATEGORY = "Sequence";
const CACHE_KEY = "sequence_analysis";

interface NormalizedSample {
  filename: string;
  category: string;
  subcategory?: string | null;
  product?: string;
  bpm?: number;
  channels?: number;
  duration?: number;
  beats?: number;
  [CACHE_KEY]?: SampleAnalysis;
  [key: string]: unknown;
}

interface NormalizedManifest {
  generated_at?: string;
  total_samples?: number;
  per_category?: Record<string, number>;
  samples: NormalizedSample[];
}

export interface MigrateOptions {
  /** Root of the normalized tree (contains metadata.json + category folders). */
  root: string;
  /** Skip filesystem mutations and metadata writes. */
  dryRun?: boolean;
  /** Re-decode every sample even if a cached analysis exists. */
  reanalyze?: boolean;
  /** Maximum analyses per run (0 = unlimited). Useful for incremental runs. */
  limit?: number;
  /** Optional callback fired once per analyzed sample (used by tests). */
  onProgress?: (filename: string, analysis: SampleAnalysis, promoted: boolean) => void;
  /** Skip samples shorter than this many seconds (default 0.5). */
  minDurationSec?: number;
}

export interface MigrateResult {
  analyzed: number;
  promoted: number;
  skippedShort: number;
  skippedMissing: number;
  fromCache: number;
  errors: number;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function relocateFile(src: string, dest: string): void {
  ensureDir(dirname(dest));
  try {
    renameSync(src, dest);
  } catch {
    // Cross-device fallback.
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

export function migrate(options: MigrateOptions): MigrateResult {
  const {
    root,
    dryRun = false,
    reanalyze = false,
    limit = 0,
    onProgress,
    minDurationSec = 0.5,
  } = options;

  const manifestPath = join(root, "metadata.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as NormalizedManifest;
  if (!Array.isArray(manifest.samples)) {
    throw new Error(`sequence-migrate: ${manifestPath} has no samples array`);
  }

  const result: MigrateResult = {
    analyzed: 0,
    promoted: 0,
    skippedShort: 0,
    skippedMissing: 0,
    fromCache: 0,
    errors: 0,
  };

  for (const sample of manifest.samples) {
    if (sample.category !== SOURCE_CATEGORY) continue;
    if (limit > 0 && result.analyzed >= limit) break;

    const wavPath = join(root, SOURCE_CATEGORY, sample.filename);
    if (!isFile(wavPath)) {
      result.skippedMissing++;
      continue;
    }

    let analysis = reanalyze ? undefined : sample[CACHE_KEY];
    if (!analysis) {
      // Cheap pre-filter: skip very short samples regardless of metadata.
      if (typeof sample.duration === "number" && sample.duration < minDurationSec) {
        result.skippedShort++;
        continue;
      }
      try {
        const wav = decodeWavFile(wavPath);
        if (wav.duration < minDurationSec) {
          result.skippedShort++;
          continue;
        }
        const bpm = typeof sample.bpm === "number" ? sample.bpm : 0;
        analysis = analyze(wav, bpm);
        result.analyzed++;
        if (!dryRun) sample[CACHE_KEY] = analysis;
      } catch {
        result.errors++;
        continue;
      }
    } else {
      result.fromCache++;
    }

    const promote = shouldPromoteToSequence(analysis);
    if (onProgress) onProgress(sample.filename, analysis, promote);
    if (!promote) continue;

    const destPath = join(root, TARGET_CATEGORY, sample.filename);
    if (!dryRun) {
      relocateFile(wavPath, destPath);
      sample.category = TARGET_CATEGORY;
      sample.subcategory = null;
    }
    result.promoted++;
  }

  if (!dryRun) {
    // Recompute per_category counts so the manifest stays consistent.
    const perCategory: Record<string, number> = {};
    for (const sample of manifest.samples) {
      const key = sample.subcategory
        ? `${sample.category}/${sample.subcategory}`
        : sample.category;
      perCategory[key] = (perCategory[key] ?? 0) + 1;
    }
    manifest.per_category = perCategory;
    manifest.total_samples = manifest.samples.length;
    manifest.generated_at = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  return result;
}

// ── CLI ──────────────────────────────────────────────────────

/* v8 ignore start */
function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: "string", default: "output" },
      "dry-run": { type: "boolean", default: false },
      reanalyze: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
    },
    allowPositionals: false,
    strict: true,
  });

  const root = values.root as string;
  if (!existsSync(join(root, "metadata.json"))) {
    console.error(`No metadata.json in ${root}`);
    process.exit(1);
  }

  let processed = 0;
  let promoted = 0;
  const result = migrate({
    root,
    dryRun: values["dry-run"] as boolean,
    reanalyze: values.reanalyze as boolean,
    limit: Number.parseInt(values.limit as string, 10) || 0,
    onProgress: (_filename, _analysis, didPromote) => {
      processed++;
      if (didPromote) promoted++;
      if (processed % 500 === 0) {
        console.log(`  ${processed} analyzed, ${promoted} promoted so far…`);
      }
    },
  });

  const prefix = values["dry-run"] ? "[DRY RUN] " : "";
  console.log(`${prefix}Sequence migration complete:`);
  console.log(`  analyzed:        ${result.analyzed}`);
  console.log(`  from cache:      ${result.fromCache}`);
  console.log(`  promoted:        ${result.promoted}`);
  console.log(`  skipped (short): ${result.skippedShort}`);
  console.log(`  skipped (missing file): ${result.skippedMissing}`);
  console.log(`  errors:          ${result.errors}`);
}

const argv1 = process.argv[1] ?? "";
if (argv1.endsWith("sequence-migrate.ts") || argv1.endsWith("sequence-migrate.js")) {
  main();
}
/* v8 ignore stop */
