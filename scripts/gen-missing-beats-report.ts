#!/usr/bin/env tsx

/**
 * gen-missing-beats-report.ts — Scan every .mix file in archive/ and
 * report sample references that cannot be resolved against output/metadata.json.
 *
 * Writes logs/missing-beats-report.json in the same schema expected by
 * scripts/recover-missing-samples.ts.
 *
 * Usage:
 *   tsx scripts/gen-missing-beats-report.ts
 *   tsx scripts/gen-missing-beats-report.ts --archive archive --output logs/missing-beats-report.json
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { parseMix } from "./mix-parser.js";
import {
  buildResolverIndex,
  resolveMix,
  canonicalizeProduct,
  gen1CatalogCandidates,
  type NormalizedMetadata,
} from "./mix-resolver.js";
import type { Gen1CatalogEntry } from "./gen1-catalog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ARCHIVE_DIR = join(ROOT, "archive");
const DEFAULT_OUTPUT_PATH = join(ROOT, "logs", "missing-beats-report.json");
const DEFAULT_METADATA_PATH = join(ROOT, "output", "metadata.json");

// Map relative paths from archive/ root to canonical product IDs.
// Longest-match wins: paths are matched as prefix of the relative .mix path.
// Order matters — more specific entries should come first.
const PATH_PRODUCT_HINTS: Array<[string, string]> = [
  // Dance SuperPack DMKIT expansion mix files
  ["Dance_SuperPack/eJay SampleKit/DMKIT1/", "Dance_SuperPack"],
  ["Dance_SuperPack/eJay SampleKit/DMKIT2/", "Dance_SuperPack"],
  ["Dance SuperPack/eJay SampleKit/DMKIT1/", "Dance_SuperPack"],
  ["Dance SuperPack/eJay SampleKit/DMKIT2/", "Dance_SuperPack"],
  ["Dance_SuperPack/", "Dance_SuperPack"],
  ["Dance SuperPack/", "Dance_SuperPack"],
  // Standard product dirs
  ["Dance_eJay1/", "Dance_eJay1"],
  ["Dance eJay 1/", "Dance_eJay1"],
  ["Dance_eJay2/", "Dance_eJay2"],
  ["Dance eJay 2/", "Dance_eJay2"],
  ["Dance eJay 2 OLD/", "Dance_eJay2"],
  ["Dance eJay 2 NEW/", "Dance_eJay2"],
  ["Dance_eJay3/", "Dance_eJay3"],
  ["Dance eJay 3/", "Dance_eJay3"],
  ["Dance_eJay4/", "Dance_eJay4"],
  ["Dance eJay 4/", "Dance_eJay4"],
  ["HipHop eJay 1/h/MIX/", "HipHop_eJay1"],
  ["HipHop 1/h/MIX/", "HipHop_eJay1"],
  ["HipHop eJay 1/h/", "HipHop_eJay1"],
  ["HipHop 1/h/", "HipHop_eJay1"],
  ["HipHop 1/", "HipHop_eJay1"],
  ["HipHop eJay 1/", "HipHop_eJay1"],
  ["HipHop 2/", "HipHop_eJay2"],
  ["HipHop eJay 2/", "HipHop_eJay2"],
  ["HipHop 3/", "HipHop_eJay3"],
  ["HipHop eJay 3/", "HipHop_eJay3"],
  ["HipHop 4/", "HipHop_eJay4"],
  ["HipHop eJay 4/", "HipHop_eJay4"],
  ["House_eJay/", "House_eJay"],
  ["House eJay/", "House_eJay"],
  ["Rave/", "Rave"],
  ["Rave eJay/", "Rave"],
  ["Techno 3/", "Techno_eJay3"],
  ["Techno eJay 3/", "Techno_eJay3"],
  ["TECHNO_EJAY/", "Techno_eJay"],
  ["Techno eJay 2/", "Techno_eJay"],
  ["Techno eJay/", "Techno_eJay"],
  ["Xtreme_eJay/", "Xtreme_eJay"],
  ["Xtreme/", "Xtreme_eJay"],
  // GenerationPack1 sub-products
  ["GenerationPack1/Dance/", "GenerationPack1_Dance"],
  ["GenerationPack1/HipHop/", "GenerationPack1_HipHop"],
  ["GenerationPack1/Rave/", "GenerationPack1_Rave"],
  // User-data mixes grouped by product
  ["_userdata/Dance and House/Dance2/", "Dance_eJay2"],
  ["_user/Dance and House/Dance2/", "Dance_eJay2"],
  ["_userdata/Dance and House/Dance3/", "Dance_eJay3"],
  ["_user/Dance and House/Dance3/", "Dance_eJay3"],
  ["_userdata/Dance and House/Dance4/", "Dance_eJay4"],
  ["_user/Dance and House/Dance4/", "Dance_eJay4"],
  ["_userdata/Hip Hop/", "HipHop_eJay4"],
  ["_user/Hip Hop/", "HipHop_eJay4"],
  ["_userdata/Rave/", "Rave"],
  ["_user/Rave/", "Rave"],
  ["_userdata/Techno/", "Techno_eJay"],
  ["_user/Techno/", "Techno_eJay"],
];

// ---------------------------------------------------------------------------
// Non-musical utility sample filter
// ---------------------------------------------------------------------------

/**
 * These filenames are eJay application resources (UI sounds, vocoder components,
 * metronome clicks, test tones, beat counters) that are embedded in .mix reference
 * lists but are not music samples. They are intentionally absent from output/ and
 * should never appear in the missing-beats report.
 *
 * Matching is case-insensitive against the basename of ids.filename.
 */
const UTILITY_FILENAMES = new Set<string>([
  "logo.wav",      // splash/startup logo sound
  "metro.wav",     // metronome click
  "carrier.wav",   // vocoder carrier component
  "modulator.wav", // vocoder modulator component
  "vocoder.wav",   // vocoder component
  "voice.wav",     // vocoder voice component
  "savetemp.wav",  // temporary save indicator sound
  "test.wav",      // test tone
  "sound.wav",     // generic app utility sound
]);

/**
 * Regex patterns matched against ids.source (the full path or display name).
 * Any source matching one of these patterns is treated as a utility sound.
 */
const UTILITY_SOURCE_PATTERNS: RegExp[] = [
  /^counter\//i,              // beat-counter samples: counter/01 classic.wav etc.
  /[/\\]eJay[/\\]eJay[/\\]/i, // app-internal resource path: ejay/eJay/...
  /^eJay[/\\]eJay[/\\]/i,     // same, at path root
  /^D_ejay\d[/\\]ejay[/\\]/i, // Dance eJay 2/3 resource path prefix
];

/**
 * Returns true if the given identifier (produced by refIdentifiers) belongs to
 * a known non-musical eJay application resource that should be excluded from the
 * missing-beats report.
 */
export function isUtilitySample(ids: { filename: string; source: string }): boolean {
  const base = ids.filename.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (UTILITY_FILENAMES.has(base)) return true;
  for (const pat of UTILITY_SOURCE_PATTERNS) {
    if (pat.test(ids.source)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportEntry {
  product: string;
  filename: string;
  internal_name: string | null;
  source: string;
  source_archive: string | null;
  alias: string | null;
  category: string | null;
  detail: string | null;
  format: string;
}

export interface MissingBeatsReport {
  generated_at: string;
  total_missing_beats: number;
  per_product: Array<{ product: string; missing_beats: number }>;
  samples: ReportEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .mix file paths under dir. */
export function findMixFiles(dir: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        result.push(...findMixFiles(full));
      } else if (/\.mix$/i.test(entry)) {
        result.push(full);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return result;
}

/** Return the product hint for a given archive-relative path (forward slash). */
export function productHintForPath(relPath: string): string | undefined {
  const normalized = relPath.replace(/\\/g, "/");
  for (const [prefix, product] of PATH_PRODUCT_HINTS) {
    if (normalized.startsWith(prefix)) return product;
  }
  return undefined;
}

/**
 * Build a display/source identifier and filename for an unresolved SampleRef.
 * Returns { filename, source, internal_name, alias }.
 */
export function refIdentifiers(
  ref: { rawId: number; internalName: string | null; displayName: string | null },
  gen1Entry?: Gen1CatalogEntry | null,
): { filename: string; source: string; internal_name: string | null; alias: string | null } {
  // Format C/D — displayName is the primary human label
  if (ref.displayName) {
    const dn = ref.displayName;
    const filename = /\.[a-z0-9]+$/i.test(dn) ? dn : `${dn}.wav`;
    return { filename, source: dn, internal_name: null, alias: dn };
  }

  // Format B — internalName is the PXD stem (e.g. "humn.9" or "d5ma060")
  if (ref.internalName) {
    const stem = ref.internalName.replace(/\.[0-9]+$/, "");
    const filename = `${stem.toUpperCase()}.wav`;
    return { filename, source: ref.internalName, internal_name: ref.internalName, alias: null };
  }

  // Format A fallback: when a Gen 1 catalog entry exists, keep the real
  // PXD-derived stem/path so downstream recovery can search by the sample name.
  if (gen1Entry?.path) {
    const stem = gen1Entry.file ?? gen1Entry.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? null;
    if (stem) {
      return {
        filename: `${stem.toUpperCase()}.wav`,
        source: gen1Entry.path,
        internal_name: null,
        alias: null,
      };
    }
  }

  // Format A — only a raw integer ID; use a placeholder
  const filename = `id_${ref.rawId}.wav`;
  return { filename, source: `id_${ref.rawId}`, internal_name: null, alias: null };
}

function gen1EntryForRef(
  product: string,
  ref: { rawId: number },
  gen1Catalogs?: Map<string, { entries: Gen1CatalogEntry[] }> | null,
): Gen1CatalogEntry | null {
  if (!gen1Catalogs || ref.rawId <= 0) return null;
  for (const productId of gen1CatalogCandidates(product)) {
    const catalog = gen1Catalogs.get(productId);
    if (!catalog || ref.rawId >= catalog.entries.length) continue;
    const entry = catalog.entries[ref.rawId] ?? null;
    if (entry?.path) return entry;
  }
  return null;
}

/** Stable deduplication key for an unresolved ref. */
export function dedupKey(product: string, ids: ReturnType<typeof refIdentifiers>): string {
  return `${product}::${ids.source.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface GenerateMissingBeatsReportOptions {
  archiveDir?: string;
  metadataPath?: string;
  outputRoot?: string;
}

export interface GenerateMissingBeatsReportDeps {
  parseMixFn?: typeof parseMix;
  buildResolverIndexFn?: typeof buildResolverIndex;
  resolveMixFn?: typeof resolveMix;
  canonicalizeProductFn?: typeof canonicalizeProduct;
}

export interface GenerateMissingBeatsReportResult {
  archiveDir: string;
  metadataPath: string;
  indexedSamples: number;
  mixFileCount: number;
  parsedOk: number;
  parseFailed: number;
  totalRefs: number;
  resolvedCount: number;
  unresolvedCount: number;
  report: MissingBeatsReport;
}

export function generateMissingBeatsReport(
  options: GenerateMissingBeatsReportOptions = {},
  deps: GenerateMissingBeatsReportDeps = {},
): GenerateMissingBeatsReportResult {
  const archiveDir = resolve(options.archiveDir ?? DEFAULT_ARCHIVE_DIR);
  const metadataPath = resolve(options.metadataPath ?? DEFAULT_METADATA_PATH);
  const outputRoot = resolve(options.outputRoot ?? join(ROOT, "output"));
  const parseMixFn = deps.parseMixFn ?? parseMix;
  const buildResolverIndexFn = deps.buildResolverIndexFn ?? buildResolverIndex;
  const resolveMixFn = deps.resolveMixFn ?? resolveMix;
  const canonicalizeProductFn = deps.canonicalizeProductFn ?? canonicalizeProduct;

  const metadata: NormalizedMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const resolverIndex = buildResolverIndexFn({ metadata, outputRoot, archiveRoot: archiveDir });
  const mixFiles = findMixFiles(archiveDir);
  const seen = new Set<string>();
  const missing: ReportEntry[] = [];
  const perProduct = new Map<string, number>();

  let parsedOk = 0;
  let parseFailed = 0;
  let totalRefs = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const mixPath of mixFiles) {
    const relPath = relative(archiveDir, mixPath).replace(/\\/g, "/");
    let productHint = productHintForPath(relPath);

    if (
      productHint === "HipHop_eJay4" &&
      /_userdata\/Hip Hop\//i.test(relPath) &&
      /\.hh\.mix$/i.test(relPath)
    ) {
      productHint = "GenerationPack1_HipHop";
    }

    let buf: Buffer;
    try {
      buf = readFileSync(mixPath);
    } catch {
      parseFailed++;
      continue;
    }

    const ir = parseMixFn(buf, productHint);
    if (!ir) {
      parseFailed++;
      continue;
    }
    parsedOk++;

    const report = resolveMixFn(ir, resolverIndex);
    totalRefs += report.total;
    resolvedCount += report.resolved;
    unresolvedCount += report.unresolved;

    const product = canonicalizeProductFn(ir.product);
    const gen1Catalogs = (resolverIndex as { gen1?: Map<string, { entries: Gen1CatalogEntry[] }> }).gen1;
    for (const track of report.tracks) {
      if (track.sampleRef.resolvedPath !== null) continue;

      const gen1Entry = gen1EntryForRef(product, track.sampleRef, gen1Catalogs);
      const ids = refIdentifiers(track.sampleRef, gen1Entry);
      if (isUtilitySample(ids)) continue;
      if (track.sampleRef.rawId === 0 && !track.sampleRef.internalName && !track.sampleRef.displayName) continue;

      const key = dedupKey(product, ids);
      if (seen.has(key)) continue;
      seen.add(key);

      missing.push({
        product,
        filename: ids.filename,
        internal_name: ids.internal_name,
        source: ids.source,
        source_archive: gen1Entry?.bank ?? null,
        alias: ids.alias,
        category: gen1Entry?.category ?? null,
        detail: gen1Entry?.group ?? gen1Entry?.version ?? null,
        format: "wav",
      });

      perProduct.set(product, (perProduct.get(product) ?? 0) + 1);
    }
  }

  return {
    archiveDir,
    metadataPath,
    indexedSamples: metadata.samples.length,
    mixFileCount: mixFiles.length,
    parsedOk,
    parseFailed,
    totalRefs,
    resolvedCount,
    unresolvedCount,
    report: {
      generated_at: new Date().toISOString(),
      total_missing_beats: missing.length,
      per_product: [...perProduct.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([product, missing_beats]) => ({ product, missing_beats })),
      samples: missing.sort((a, b) => {
        const pc = a.product.localeCompare(b.product);
        return pc !== 0 ? pc : a.filename.localeCompare(b.filename);
      }),
    },
  };
}

export function writeMissingBeatsReport(report: MissingBeatsReport, outputPath: string): void {
  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

export function main(args: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({
    args,
    options: {
      archive: { type: "string", default: DEFAULT_ARCHIVE_DIR },
      output: { type: "string", default: DEFAULT_OUTPUT_PATH },
      metadata: { type: "string", default: DEFAULT_METADATA_PATH },
    },
  });

  const archiveDir = resolve(String(values["archive"]));
  const outputPath = resolve(String(values["output"]));
  const metadataPath = resolve(String(values["metadata"]));

  console.log(`Loading metadata from ${metadataPath} ...`);
  const result = generateMissingBeatsReport({ archiveDir, metadataPath });
  console.log(`  ${result.indexedSamples} samples indexed`);
  console.log(`\nScanning .mix files under ${archiveDir} ...`);
  console.log(`  ${result.mixFileCount} .mix files found`);

  writeMissingBeatsReport(result.report, outputPath);

  console.log("\n=== Scan Summary ===");
  console.log(`  .mix files parsed:    ${result.parsedOk}`);
  console.log(`  .mix files skipped:   ${result.parseFailed}`);
  console.log(`  Total sample refs:    ${result.totalRefs}`);
  console.log(`  Resolved:             ${result.resolvedCount}`);
  console.log(`  Unresolved:           ${result.unresolvedCount}`);
  console.log(`  Unique missing:       ${result.report.total_missing_beats}`);
  console.log("\nPer product:");
  for (const { product, missing_beats } of result.report.per_product) {
    console.log(`  ${product.padEnd(28)} ${missing_beats}`);
  }
  console.log(`\nWrote ${outputPath}`);
  return 0;
}

/* istanbul ignore next -- CLI entry point */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
