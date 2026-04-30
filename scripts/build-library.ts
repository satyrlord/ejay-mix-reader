#!/usr/bin/env tsx

/**
 * build-library.ts — One-shot setup: extract, organise, and build the browser
 * library from whatever eJay products are present under archive/.
 *
 * Steps run automatically:
 *   1. pxd-parser.ts          — decode PXD archives → WAV + per-product metadata.json
 *   2. reorganize.ts          — sort WAVs into channel sub-folders
 *   3. enrich-metadata.ts     — backfill BPM / category / beats
 *   4. normalize.ts           — merge all products into a single category tree
 *   5. [promote _normalized]  — move the staged tree into the output/ root
 *   6. rename-samples.ts      — lowercase and tidy filenames
 *   7. extract-mix-metadata   — build data/mix-metadata.json
 *   8. build-index.ts         — build data/index.json
 *
 * After the script finishes, run `npm run serve`, then click
 * "Choose output folder" and point it at the output/ directory.
 *
 * Usage:
 *   npx tsx scripts/build-library.ts
 *   npx tsx scripts/build-library.ts --dry-run   # show commands, change nothing
 *   npx tsx scripts/build-library.ts --force     # re-extract already-done products
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_DIR = join(ROOT, "archive");
const OUTPUT_DIR = join(ROOT, "output");
const NORMALIZED_DIR = join(OUTPUT_DIR, "_normalized");
const EXTRACTED_MARKER_DIR = join(OUTPUT_DIR, ".extracted");

const { values: opts } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

const DRY_RUN = opts["dry-run"] as boolean;
const FORCE = opts.force as boolean;
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const VITE_CLI = join(ROOT, "node_modules", "vite", "bin", "vite.js");

// ── Product registry ──────────────────────────────────────────────────────────

interface ProductSpec {
  /** Folder id used under output/ */
  id: string;
  /** Human-readable product name */
  label: string;
  /** Path relative to archive/ that must exist for the product to be detected */
  archivePath: string;
  /** Additional archive-path candidates accepted for detection. */
  archivePathAliases?: string[];
  /** Source path to pass to pxd-parser.ts, relative to the repo root */
  parserSource: string;
  /** Additional parser-source candidates accepted for extraction. */
  parserSourceAliases?: string[];
}

export const PRODUCTS: readonly ProductSpec[] = [
  {
    id: "Dance_eJay1",
    label: "Dance eJay 1",
    archivePath: join("Dance_eJay1"),
    archivePathAliases: [join("Dance eJay 1"), join("Dance_eJay1", "dance"), join("Dance eJay 1", "dance")],
    parserSource: join("archive", "Dance_eJay1"),
    parserSourceAliases: [join("archive", "Dance eJay 1"), join("archive", "Dance_eJay1", "dance"), join("archive", "Dance eJay 1", "dance")],
  },
  {
    id: "Dance_eJay2",
    label: "Dance eJay 2",
    archivePath: join("Dance eJay 2", "D_EJAY2", "PXD"),
    archivePathAliases: [
      join("Dance_eJay2", "D_ejay2", "PXD"),
      join("Dance eJay 2", "D2", "PXD"),
      join("Dance eJay 2 OLD", "D_EJAY2", "PXD"),
      join("Dance eJay 2 NEW", "D2", "PXD"),
    ],
    parserSource: join("archive", "Dance eJay 2", "D_EJAY2", "PXD"),
    parserSourceAliases: [
      join("archive", "Dance_eJay2", "D_ejay2", "PXD"),
      join("archive", "Dance eJay 2", "D2", "PXD"),
      join("archive", "Dance eJay 2 OLD", "D_EJAY2", "PXD"),
      join("archive", "Dance eJay 2 NEW", "D2", "PXD"),
    ],
  },
  {
    id: "Dance_eJay3",
    label: "Dance eJay 3",
    archivePath: join("Dance_eJay3", "eJay", "pxd", "dance30"),
    archivePathAliases: [join("Dance eJay 3", "eJay", "pxd", "dance30")],
    parserSource: join("archive", "Dance_eJay3", "eJay", "pxd", "dance30"),
    parserSourceAliases: [join("archive", "Dance eJay 3", "eJay", "pxd", "dance30")],
  },
  {
    id: "Dance_eJay4",
    label: "Dance eJay 4",
    archivePath: join("Dance_eJay4", "ejay", "PXD", "DANCE40"),
    archivePathAliases: [join("Dance eJay 4", "eJay", "PXD", "DANCE40")],
    parserSource: join("archive", "Dance_eJay4", "ejay", "PXD", "DANCE40"),
    parserSourceAliases: [join("archive", "Dance eJay 4", "eJay", "PXD", "DANCE40")],
  },
  {
    id: "Dance_SuperPack",
    label: "Dance SuperPack",
    archivePath: join("Dance_SuperPack"),
    archivePathAliases: [join("Dance SuperPack"), join("Dance_SuperPack", "dance"), join("Dance SuperPack", "dance")],
    parserSource: join("archive", "Dance_SuperPack"),
    parserSourceAliases: [join("archive", "Dance SuperPack"), join("archive", "Dance_SuperPack", "dance"), join("archive", "Dance SuperPack", "dance")],
  },
  {
    id: "GenerationPack1_Dance",
    label: "Generation Pack 1 (Dance)",
    archivePath: join("GenerationPack1", "Dance"),
    archivePathAliases: [join("GenerationPack1", "Dance", "dance")],
    parserSource: join("archive", "GenerationPack1", "Dance"),
    parserSourceAliases: [join("archive", "GenerationPack1", "Dance", "dance")],
  },
  {
    id: "GenerationPack1_Rave",
    label: "Generation Pack 1 (Rave)",
    archivePath: join("GenerationPack1", "Rave"),
    archivePathAliases: [join("GenerationPack1", "Rave", "RAVE")],
    parserSource: join("archive", "GenerationPack1", "Rave"),
    parserSourceAliases: [join("archive", "GenerationPack1", "Rave", "RAVE")],
  },
  {
    id: "GenerationPack1_HipHop",
    label: "Generation Pack 1 (HipHop)",
    archivePath: join("GenerationPack1", "HipHop"),
    archivePathAliases: [join("GenerationPack1", "HipHop", "HIPHOP")],
    parserSource: join("archive", "GenerationPack1", "HipHop"),
    parserSourceAliases: [join("archive", "GenerationPack1", "HipHop", "HIPHOP")],
  },
  {
    id: "HipHop_eJay1",
    label: "HipHop eJay 1",
    archivePath: join("HipHop 1"),
    archivePathAliases: [join("HipHop eJay 1"), join("HipHop 1", "HIPHOP"), join("HipHop eJay 1", "HIPHOP")],
    parserSource: join("archive", "HipHop 1"),
    parserSourceAliases: [join("archive", "HipHop eJay 1"), join("archive", "HipHop 1", "HIPHOP"), join("archive", "HipHop eJay 1", "HIPHOP")],
  },
  {
    id: "HipHop_eJay2",
    label: "HipHop eJay 2",
    archivePath: join("HipHop 2", "eJay", "pxd", "HipHop20"),
    archivePathAliases: [join("HipHop eJay 2", "eJay", "pxd", "hiphop20")],
    parserSource: join("archive", "HipHop 2", "eJay", "pxd", "HipHop20"),
    parserSourceAliases: [join("archive", "HipHop eJay 2", "eJay", "pxd", "hiphop20")],
  },
  {
    id: "HipHop_eJay3",
    label: "HipHop eJay 3",
    archivePath: join("HipHop 3", "eJay", "pxd", "hiphop30"),
    archivePathAliases: [join("HipHop eJay 3", "eJay", "pxd", "hiphop30")],
    parserSource: join("archive", "HipHop 3", "eJay", "pxd", "hiphop30"),
    parserSourceAliases: [join("archive", "HipHop eJay 3", "eJay", "pxd", "hiphop30")],
  },
  {
    id: "HipHop_eJay4",
    label: "HipHop eJay 4",
    archivePath: join("HipHop 4", "eJay", "pxd", "HipHop40"),
    archivePathAliases: [join("HipHop eJay 4", "eJay", "pxd", "HipHop40")],
    parserSource: join("archive", "HipHop 4", "eJay", "pxd", "HipHop40"),
    parserSourceAliases: [join("archive", "HipHop eJay 4", "eJay", "pxd", "HipHop40")],
  },
  {
    id: "House_eJay",
    label: "House eJay",
    archivePath: join("House_eJay", "ejay", "PXD", "House10"),
    archivePathAliases: [join("House eJay", "ejay", "PXD", "House10")],
    parserSource: join("archive", "House_eJay", "ejay", "PXD", "House10"),
    parserSourceAliases: [join("archive", "House eJay", "ejay", "PXD", "House10")],
  },
  {
    id: "Rave",
    label: "Rave eJay",
    archivePath: join("Rave", "PXD"),
    archivePathAliases: [join("Rave eJay", "PXD"), join("Rave", "RAVE"), join("Rave eJay", "RAVE")],
    parserSource: join("archive", "Rave", "PXD"),
    parserSourceAliases: [join("archive", "Rave eJay", "PXD"), join("archive", "Rave", "RAVE"), join("archive", "Rave eJay", "RAVE")],
  },
  {
    id: "Techno_eJay",
    label: "Techno eJay",
    archivePath: join("TECHNO_EJAY", "EJAY", "PXD", "RAVE20"),
    archivePathAliases: [join("Techno eJay 2", "eJay", "PXD", "rave20")],
    parserSource: join("archive", "TECHNO_EJAY", "EJAY", "PXD", "RAVE20"),
    parserSourceAliases: [join("archive", "Techno eJay 2", "eJay", "PXD", "rave20")],
  },
  {
    id: "Techno_eJay3",
    label: "Techno eJay 3",
    archivePath: join("Techno 3", "eJay", "pxd", "rave30"),
    archivePathAliases: [join("Techno eJay 3", "eJay", "pxd", "rave30")],
    parserSource: join("archive", "Techno 3", "eJay", "pxd", "rave30"),
    parserSourceAliases: [join("archive", "Techno eJay 3", "eJay", "pxd", "rave30")],
  },
  {
    id: "Xtreme_eJay",
    label: "Xtreme eJay",
    archivePath: join("Xtreme_eJay", "eJay", "PXD", "xejay10"),
    archivePathAliases: [join("Xtreme", "eJay", "PXD", "xejay10")],
    parserSource: join("archive", "Xtreme_eJay", "eJay", "PXD", "xejay10"),
    parserSourceAliases: [join("archive", "Xtreme", "eJay", "PXD", "xejay10")],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/* v8 ignore start */
function run(script: string, args: string[]): void {
  const display = ["npx", "tsx", script, ...args].join(" ");
  console.log(`\n  > ${display}`);
  if (DRY_RUN) return;

  const result = spawnSync(process.execPath, [TSX_CLI, script, ...args], {
    stdio: "inherit",
    cwd: ROOT,
  });

  if (result.error) {
    console.error(`\nFailed to start: ${display}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nScript exited with code ${String(result.status)}: ${display}`);
    process.exit(result.status ?? 1);
  }
}

function runViteBuild(): void {
  console.log("\n  > npx vite build");
  if (DRY_RUN) return;

  const result = spawnSync(process.execPath, [VITE_CLI, "build"], {
    stdio: "inherit",
    cwd: ROOT,
  });

  if (result.error) {
    console.error(`\nFailed to start: npx vite build\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nnpx vite build exited with code ${String(result.status)}`);
    process.exit(result.status ?? 1);
  }
}

/** Copy output/_normalized/ into output/ then remove _normalized/. */
function promoteNormalized(): void {
  if (!existsSync(NORMALIZED_DIR)) return;
  console.log("\n  > Promoting output/_normalized/ → output/");
  if (DRY_RUN) return;
  cpSync(NORMALIZED_DIR, OUTPUT_DIR, { recursive: true, force: true });
  rmSync(NORMALIZED_DIR, { recursive: true, force: true });
}

/** Remove per-product staging folders (now-empty after normalize --move). */
function removeProductStagingDirs(specs: readonly ProductSpec[]): void {
  for (const spec of specs) {
    const productDir = join(OUTPUT_DIR, spec.id);
    if (!existsSync(productDir)) continue;
    console.log(`  > Removing output/${spec.id}/`);
    if (DRY_RUN) continue;
    rmSync(productDir, { recursive: true, force: true });
  }
}

/** Marker file that survives normalise --move + per-product folder deletion. */
function markerPath(spec: ProductSpec): string {
  return join(EXTRACTED_MARKER_DIR, spec.id);
}

function hasExtractedMarker(spec: ProductSpec): boolean {
  return existsSync(markerPath(spec));
}

function writeExtractedMarker(spec: ProductSpec): void {
  if (DRY_RUN) return;
  mkdirSync(EXTRACTED_MARKER_DIR, { recursive: true });
  writeFileSync(markerPath(spec), `${new Date().toISOString()}\n`);
}
/* v8 ignore stop */

/** Return all products that have an accessible archive subtree. */
export function detectProducts(archiveDir: string): ProductSpec[] {
  return PRODUCTS.filter((p) => resolveArchivePathCandidate(p, archiveDir) !== null);
}

export function archivePathCandidates(spec: ProductSpec): string[] {
  return [spec.archivePath, ...(spec.archivePathAliases ?? [])];
}

export function parserSourceCandidates(spec: ProductSpec): string[] {
  return [spec.parserSource, ...(spec.parserSourceAliases ?? [])];
}

export function resolveArchivePathCandidate(spec: ProductSpec, archiveDir: string): string | null {
  for (const pathCandidate of archivePathCandidates(spec)) {
    if (existsSync(join(archiveDir, pathCandidate))) {
      return pathCandidate;
    }
  }
  return null;
}

export function resolveParserSource(spec: ProductSpec, rootDir = ROOT): string | null {
  for (const sourceCandidate of parserSourceCandidates(spec)) {
    if (existsSync(join(rootDir, sourceCandidate))) {
      return sourceCandidate;
    }
  }
  return null;
}

/**
 * Resolve parser source candidates and return concrete extraction inputs.
 *
 * Prefers candidates that expand into packed archive files (or explicit files)
 * and falls back to the first existing directory candidate when no packed
 * archive set is discoverable.
 */
export function resolveParserSources(spec: ProductSpec, rootDir = ROOT): string[] {
  let fallback: string[] | null = null;

  for (const sourceCandidate of parserSourceCandidates(spec)) {
    const expanded = expandParserSourceCandidate(sourceCandidate, rootDir);
    if (expanded.length === 0) continue;
    if (!fallback) fallback = expanded;

    const absCandidate = join(rootDir, sourceCandidate);
    let isDirectory = false;
    try {
      isDirectory = statSync(absCandidate).isDirectory();
    } catch {
      isDirectory = false;
    }

    const unchangedDirectory =
      isDirectory &&
      expanded.length === 1 &&
      expanded[0] === sourceCandidate;

    if (!unchangedDirectory) {
      return expanded;
    }
  }

  return fallback ?? [];
}

export function hasInfCompanion(absPath: string): boolean {
  for (const ext of [".inf", ".INF", ".Inf"]) {
    if (existsSync(absPath + ext)) return true;
  }
  return false;
}

export type MetadataSample = Record<string, unknown>;

interface ProductMetadataFile {
  generated_at?: string;
  total_samples?: number;
  samples?: unknown;
}

export function readProductMetadataSamples(metadataPath: string): MetadataSample[] {
  if (!existsSync(metadataPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as ProductMetadataFile;
    if (!Array.isArray(parsed.samples)) return [];
    return parsed.samples.filter((entry): entry is MetadataSample => (
      typeof entry === "object" && entry !== null
    ));
  } catch {
    return [];
  }
}

export function dedupeMetadataSamples(samples: readonly MetadataSample[]): MetadataSample[] {
  const seen = new Set<string>();
  const deduped: MetadataSample[] = [];

  for (const sample of samples) {
    const key = [
      String(sample.filename ?? ""),
      String(sample.source_archive ?? ""),
      String(sample.internal_name ?? ""),
      String(sample.sample_id ?? ""),
    ].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(sample);
  }

  return deduped;
}

export function writeMergedProductMetadata(metadataPath: string, samples: readonly MetadataSample[]): void {
  const deduped = dedupeMetadataSamples(samples);
  const merged: ProductMetadataFile = {
    generated_at: new Date().toISOString(),
    total_samples: deduped.length,
    samples: deduped,
  };
  writeFileSync(metadataPath, `${JSON.stringify(merged, null, 2)}\n`);
}

/**
 * Expand a parser source path into concrete archive inputs.
 *
 * For directory sources that contain extension-less packed archives with INF
 * companions (e.g. Dance eJay 2: DANCE20, Dancesk4/5/6), return each packed
 * archive file so all expansions are extracted in one product pass.
 */
export function expandParserSourceCandidate(parserSource: string, rootDir = ROOT): string[] {
  const absSource = join(rootDir, parserSource);
  if (!existsSync(absSource)) return [];

  let sourceStat;
  try {
    sourceStat = statSync(absSource);
  } catch {
    return [];
  }

  if (!sourceStat.isDirectory()) {
    return [parserSource];
  }

  let entries: string[];
  try {
    entries = readdirSync(absSource);
  } catch {
    return [parserSource];
  }

  const packedArchives = entries
    .filter((entry) => {
      const absEntry = join(absSource, entry);
      try {
        if (!statSync(absEntry).isFile()) return false;
      } catch {
        return false;
      }
      // Packed archive files in this family are extension-less and have an
      // INF companion with matching basename.
      return !entry.includes(".") && hasInfCompanion(absEntry);
    })
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((entry) => join(parserSource, entry));

  if (packedArchives.length > 0) {
    return packedArchives;
  }

  return [parserSource];
}

// ── Main ──────────────────────────────────────────────────────────────────────

/* v8 ignore start */
function main(): void {
  if (DRY_RUN) console.log("[DRY RUN — no files will be written or moved]\n");

  const found = detectProducts(ARCHIVE_DIR);

  if (found.length === 0) {
    console.error(
      "No eJay product files found in archive/.\n\n" +
      "Copy the install folder from your eJay CD into the matching archive/ sub-folder.\n" +
      "See docs/rebuild-output.md for the expected layout for each product.\n",
    );
    process.exit(1);
  }

  console.log(
    `Found ${found.length} product(s):\n` + found.map((p) => `  • ${p.label}`).join("\n"),
  );

  // Steps 1+2: Per-product: extract → reorganise
  for (const spec of found) {
    if (!FORCE && hasExtractedMarker(spec)) {
      console.log(`\n  [skip] ${spec.label} already extracted  (--force to re-run)`);
      continue;
    }

    const parserSources = resolveParserSources(spec);
    if (parserSources.length === 0) {
      console.warn(`\n  [skip] ${spec.label} source path not found; archive layout not recognized`);
      continue;
    }

    console.log(`\n── Steps 1+2: ${spec.label} ──`);
    if (parserSources.length > 1) {
      console.log(`  > Found ${parserSources.length} packed archives in ${parserSource}`);
    }
    const productOutputRel = join("output", spec.id);
    const productOutputAbs = join(ROOT, productOutputRel);
    const metadataPath = join(productOutputAbs, "metadata.json");
    const mergedSamples: MetadataSample[] = [];
    const parserSourceRoot = dirname(parserSources[0]);

    for (const sourceCandidate of parserSources) {
      run("scripts/pxd-parser.ts", [sourceCandidate, "--output", productOutputRel]);
      if (!DRY_RUN && parserSources.length > 1) {
        mergedSamples.push(...readProductMetadataSamples(metadataPath));
      }
    }

    if (!DRY_RUN && parserSources.length > 1) {
      writeMergedProductMetadata(metadataPath, mergedSamples);
      const mergedCount = readProductMetadataSamples(metadataPath).length;
      console.log(`  > Merged metadata: ${mergedCount} samples across ${parserSources.length} archives from ${parserSourceRoot}`);
    }
    run("scripts/reorganize.ts", [productOutputRel]);
    writeExtractedMarker(spec);
  }

  // Step 3: Enrich all products
  console.log("\n── Step 3: Enrich metadata ──");
  run("scripts/enrich-metadata.ts", []);

  // Step 4: Normalise into output/_normalized (move so per-product folders end up empty)
  console.log("\n── Step 4: Normalise ──");
  run("scripts/normalize.ts", ["--move"]);
  promoteNormalized();
  removeProductStagingDirs(found);

  // Step 5: Tidy filenames
  console.log("\n── Step 5: Rename samples ──");
  run("scripts/rename-samples.ts", ["--apply"]);

  // Step 6: Extract .mix metadata manifest
  console.log("\n── Step 6: Extract mix metadata ──");
  run("scripts/extract-mix-metadata.ts", []);

  // Step 7: Build browser data + production bundle
  console.log("\n── Step 7: Build browser data ──");
  run("scripts/build-index.ts", []);
  runViteBuild();

  console.log(
    "\n✓ Done!\n\n" +
    "Run `npm run serve` then click 'Choose output folder' and point it at output/\n",
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("build-library.ts") || process.argv[1].endsWith("build-library.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
