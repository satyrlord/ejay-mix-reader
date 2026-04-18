#!/usr/bin/env tsx

/**
 * enrich-metadata.ts — Backfill missing BPM, category, and beat data in
 * extracted metadata.json manifests.
 *
 * Enrichment sources:
 *   - Product BPM defaults (from mix-format docs)
 *   - Rave / GP1-Rave PXD catalog (Pxddance-format, sub-code → category)
 *   - GP1-HipHop PXD catalog (sub-code → category)
 *   - DanceSP / GP1-Dance Pxddance (internal-name → category for Dance_eJay1)
 *   - eJay Studio bank names (BPM from `(\d+)bpm`, category from source path)
 *
 * Usage:
 *   tsx scripts/enrich-metadata.ts                       # all products
 *   tsx scripts/enrich-metadata.ts output/Rave            # single product
 *   tsx scripts/enrich-metadata.ts output/Rave --dry-run  # preview changes
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { parseArgs } from "util";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleEntry {
  filename: string;
  source?: string;
  source_archive?: string;
  alias?: string;
  category?: string;
  channel?: string;
  duration_sec?: number;
  beats?: number;
  bpm?: number;
  bank?: string;
  format?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface Manifest {
  source?: string[];
  total_samples: number;
  format?: Record<string, unknown>;
  samples: SampleEntry[];
  [key: string]: unknown;
}

export interface EnrichStats {
  product: string;
  bpmAdded: number;
  categoryFixed: number;
  beatsRecomputed: number;
  totalSamples: number;
}

// ---------------------------------------------------------------------------
// BPM defaults per product
// ---------------------------------------------------------------------------

const PRODUCT_BPM: Record<string, number> = {
  Dance_eJay1: 140,
  Dance_eJay2: 140,
  Dance_eJay3: 140,
  Dance_eJay4: 140,
  Dance_SuperPack: 140,
  GenerationPack1_Dance: 140,
  GenerationPack1_Rave: 140,
  GenerationPack1_HipHop: 90,
  HipHop_eJay2: 90,
  HipHop_eJay3: 90,
  HipHop_eJay4: 90,
  House_eJay: 125,
  Rave: 140,
  SampleKit_DMKIT1: 140,
  SampleKit_DMKIT2: 140,
  SampleKit_DMKIT3: 140,
  Techno_eJay: 140,
  Techno_eJay3: 140,
  Xtreme_eJay: 160,
};

// ---------------------------------------------------------------------------
// Rave / GP1-HipHop: 2-letter sub-code → category
// ---------------------------------------------------------------------------

/** Rave eJay sub-code → category (from archive/Rave/RAVE/EJAY/PXD). */
export const RAVE_SUBCODE: Record<string, string> = {
  BS: "Bass",
  DA: "Drum", DB: "Drum", DC: "Drum", DD: "Drum", DF: "Drum",
  FX: "Effect",
  LA: "Loop", LB: "Loop", LC: "Loop",
  SF: "Special",
  SQ: "Sequence",
  SR: "Sphere",
  VX: "Voice",
  HG: "Hyper",
};

/** GP1 HipHop sub-code → category (from archive/.../HipHop/.../PXD). */
export const HIPHOP_SUBCODE: Record<string, string> = {
  BS: "Bass",
  DA: "Drum", DB: "Drum", DC: "Drum", DD: "Drum",
  EX: "Effect", FX: "Effect", ZZ: "Effect",
  GT: "Guitar",
  LA: "Loop", LB: "Loop", LC: "Loop",
  OL: "Keys", PN: "Keys", SY: "Keys", ZY: "Keys",
  RP: "Rap",
  VC: "Voice",
  SC: "Scratch",
};

// ---------------------------------------------------------------------------
// Valid category names (proper channel names used across products)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  // Standard eJay channel names
  "Bass", "Drum", "Effect", "Keys", "Loop", "Sequence", "Voice", "Xtra",
  "Sphere", "Special", "Rap", "Scratch", "Guitar", "Hyper", "Layer",
  "HiHat", "Seq", "Wave",
  // Product-specific channels (HipHop 4, House)
  "Ladies", "Fellas", "Groove",
  // eJay Studio source-path categories
  "Loops", "FX", "Percussions", "Hihats", "Snare", "Kick", "Cymbales",
  "Drums", "Claps",
]);

// ---------------------------------------------------------------------------
// Pxddance parser (for DanceSP / GP1-Dance / Rave PXD catalog)
// ---------------------------------------------------------------------------

/**
 * Parse a 6-line-record catalog file (Pxddance or Rave PXD-style).
 * Returns a map of upper-cased filename (no ext) → category string.
 */
export function parsePxddanceCatalog(filePath: string): Map<string, string> {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const map = new Map<string, string>();
  for (let i = 0; i + 5 < lines.length; i += 6) {
    const rawPath = lines[i].replace(/^"|"$/g, "");
    const rawCat = lines[i + 2].replace(/^"|"$/g, "");
    if (!rawPath || !rawCat || rawCat.startsWith("http")) continue;
    const fname = basename(rawPath).replace(/\.pxd$/i, "").toUpperCase();
    map.set(fname, rawCat);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Sub-code extractor
// ---------------------------------------------------------------------------

/**
 * Extract the 2-letter sub-code from an internal filename like R1BS100.
 * Pattern: single letter + digit + 2-letter code + digits (e.g. R1BS100).
 */
export function extractSubCode(filename: string): string | null {
  const m = filename.toUpperCase().match(/^[A-Z]\d([A-Z]{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// eJay Studio helpers
// ---------------------------------------------------------------------------

/** Extract BPM from a bank name like "Drum&Bass_160bpm". */
export function studioBpmFromBank(bank: string): number | null {
  const m = bank.match(/(\d+)bpm/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Extract category from a source path like "Drum&Bass_160bpm/Bass/FILE.WAV". */
export function studioCategoryFromSource(source: string): string | null {
  const parts = source.replace(/\\/g, "/").split("/");
  // source path: <bank>/<category>/filename.wav
  return parts.length >= 3 ? parts[1] : null;
}

// ---------------------------------------------------------------------------
// Core enrichment
// ---------------------------------------------------------------------------

export function enrichProduct(
  productDir: string,
  dryRun: boolean,
  pxddanceMap: Map<string, string> | null,
): EnrichStats | null {
  const productName = basename(productDir);

  // Locate metadata.json — may be nested (e.g. Dance_eJay1/dance/metadata.json)
  const manifests = findManifests(productDir);
  if (manifests.length === 0) {
    console.log(`  [skip] ${productName}: no metadata.json found`);
    return null;
  }

  const stats: EnrichStats = {
    product: productName,
    bpmAdded: 0,
    categoryFixed: 0,
    beatsRecomputed: 0,
    totalSamples: 0,
  };

  for (const mpath of manifests) {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(mpath, "utf8"));
    } catch (err) {
      console.warn(
        `  [skip] ${productName}: cannot parse ${mpath} — ${(err as Error).message}`,
      );
      continue;
    }
    let changed = false;

    for (const s of manifest.samples) {
      stats.totalSamples++;
      const isStudio = productName === "eJay_Studio";

      // --- BPM ---
      if (s.bpm === undefined) {
        let bpm: number | null = null;
        if (isStudio && s.bank) {
          bpm = studioBpmFromBank(s.bank);
        }
        // Studio one-shots (no BPM in bank name) default to 140
        if (bpm === null) {
          bpm = PRODUCT_BPM[productName] ?? (isStudio ? 140 : null);
        }
        if (bpm !== null) {
          s.bpm = bpm;
          stats.bpmAdded++;
          changed = true;
        }
      }

      // --- Category ---
      const needsCategory =
        s.category === undefined ||
        s.category === null ||
        (typeof s.category === "string" && /^\d+$/.test(s.category));

      // Detect alias-as-category: category is set but not a known channel name,
      // while the channel field holds a proper value.
      const hasAliasCategory =
        !needsCategory &&
        typeof s.category === "string" &&
        !VALID_CATEGORIES.has(s.category) &&
        s.channel !== undefined &&
        VALID_CATEGORIES.has(s.channel);

      if (needsCategory || hasAliasCategory) {
        let cat: string | null = null;

        if (isStudio && s.source) {
          cat = studioCategoryFromSource(s.source);
        } else if (
          (productName === "Rave" || productName === "GenerationPack1_Rave") &&
          s.source
        ) {
          cat = raveCategory(s.source, s.filename);
        } else if (productName === "GenerationPack1_HipHop" && (s.source || s.filename)) {
          cat = hiphopCategory(s.source ?? s.filename);
        } else if (productName === "Dance_eJay1" && pxddanceMap) {
          cat = dance1Category(s.source ?? s.filename, pxddanceMap);
        } else if (hasAliasCategory && s.channel) {
          // Category contains an alias string — replace with proper channel
          cat = s.channel;
        } else if (s.channel && needsCategory) {
          // Fallback: use existing channel field for products that already
          // have channel but corrupt/missing category
          cat = s.channel;
        }

        if (cat !== null) {
          s.category = cat;
          stats.categoryFixed++;
          changed = true;
        }
      }

      // --- Beats recomputation ---
      // Only recompute if we have both duration and BPM, and the current
      // beats value was computed at the wrong BPM (140 hardcoded).
      if (
        s.bpm !== undefined &&
        s.bpm !== 140 &&
        s.duration_sec !== undefined &&
        s.beats !== undefined
      ) {
        const expectedAtOldBpm = Math.round((s.duration_sec * 140) / 60);
        if (s.beats === expectedAtOldBpm) {
          s.beats = Math.round((s.duration_sec * s.bpm) / 60);
          stats.beatsRecomputed++;
          changed = true;
        }
      }
    }

    if (changed && !dryRun) {
      manifest.total_samples = manifest.samples.length;
      writeFileSync(mpath, JSON.stringify(manifest, null, 2) + "\n");
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Category resolvers
// ---------------------------------------------------------------------------

export function raveCategory(source: string, filename: string): string | null {
  const raw = basename(source || filename)
    .replace(/\.(pxd|wav)$/i, "")
    .toUpperCase();
  // INTRO.PXD → skip
  if (raw === "INTRO") return null;
  const sc = extractSubCode(raw);
  if (sc && RAVE_SUBCODE[sc]) return RAVE_SUBCODE[sc];
  // HYPER pattern: R1HG0001
  if (/^R\dHG/i.test(raw)) return "Hyper";
  return null;
}

/** GP1 HipHop Special/HX* filename prefix → category. */
const HX_PREFIX: Record<string, string> = {
  HXDRUM: "Drum",
  HXEFCT: "Effect",
  HXEFX: "Effect",
  HXGUIT: "Guitar",
  HXGUITAR: "Guitar",
  HXLOOP: "Loop",
  HXRAP: "Rap",
  HXSCRT: "Scratch",
  HXSCRATCH: "Scratch",
  HXSYNT: "Keys",
  HXSYNTH: "Keys",
  HXVC: "Voice",
};

export function hiphopCategory(source: string): string | null {
  const raw = basename(source)
    .replace(/\.(pxd|wav)$/i, "")
    .toUpperCase();
  const sc = extractSubCode(raw);
  if (sc && HIPHOP_SUBCODE[sc]) return HIPHOP_SUBCODE[sc];
  // SCRATCH samples: H1SC001
  if (/^H\dSC/i.test(raw)) return "Scratch";
  // HX* Special samples: HXDRUM01, HXLOOP01, etc.
  for (const [prefix, cat] of Object.entries(HX_PREFIX)) {
    if (raw.startsWith(prefix)) return cat;
  }
  return null;
}

export function dance1Category(
  source: string,
  pxddanceMap: Map<string, string>,
): string | null {
  const raw = basename(source)
    .replace(/\.(pxd|wav)$/i, "")
    .toUpperCase();
  const cat = pxddanceMap.get(raw);
  return cat ? capitalize(cat) : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

export function findManifests(dir: string): string[] {
  // Prefer the top-level metadata.json (created during reorganization).
  // Only fall back to nested subdirectories when no top-level exists.
  const direct = join(dir, "metadata.json");
  if (existsSync(direct)) return [direct];

  const results: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }];
  try {
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= 2) continue;
      for (const sub of readdirSync(current.path)) {
        const subPath = join(current.path, sub);
        if (!statSync(subPath).isDirectory()) continue;
        const nested = join(subPath, "metadata.json");
        if (existsSync(nested)) results.push(nested);
        queue.push({ path: subPath, depth: current.depth + 1 });
      }
    }
  } catch {
    // Ignore read errors
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/* v8 ignore start */
function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const dryRun = values["dry-run"] as boolean;
  const outputRoot = resolve("output");
  if (!existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) {
    console.error(`ERROR: output directory not found: ${outputRoot}`);
    process.exit(1);
  }

  // Load the DanceSP Pxddance for Dance_eJay1 enrichment
  const pxddancePath = resolve("archive/Dance_SuperPack/dance/EJAY/Pxddance");
  const pxddanceMap = existsSync(pxddancePath)
    ? parsePxddanceCatalog(pxddancePath)
    : null;

  if (pxddanceMap) {
    console.log(`Loaded Pxddance catalog: ${pxddanceMap.size} entries`);
  }

  // Determine target products
  let targets: string[];
  if (positionals.length > 0) {
    targets = positionals.map((p) => resolve(p));
  } else {
    targets = readdirSync(outputRoot)
      .filter((d: string) => statSync(join(outputRoot, d)).isDirectory())
      .map((d: string) => join(outputRoot, d));
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Enriching ${targets.length} products...\n`);

  const allStats: EnrichStats[] = [];
  for (const dir of targets.sort()) {
    const stats = enrichProduct(dir, dryRun, pxddanceMap);
    if (stats) {
      allStats.push(stats);
      const parts: string[] = [];
      if (stats.bpmAdded) parts.push(`bpm=${stats.bpmAdded}`);
      if (stats.categoryFixed) parts.push(`cat=${stats.categoryFixed}`);
      if (stats.beatsRecomputed) parts.push(`beats=${stats.beatsRecomputed}`);
      const summary = parts.length ? parts.join(" ") : "no changes";
      console.log(`  ${stats.product}: ${stats.totalSamples} samples — ${summary}`);
    }
  }

  // Summary
  const totals = allStats.reduce(
    (acc, s) => ({
      bpm: acc.bpm + s.bpmAdded,
      cat: acc.cat + s.categoryFixed,
      beats: acc.beats + s.beatsRecomputed,
      samples: acc.samples + s.totalSamples,
    }),
    { bpm: 0, cat: 0, beats: 0, samples: 0 },
  );
  console.log(
    `\nTotal: ${totals.samples} samples — bpm=${totals.bpm} cat=${totals.cat} beats=${totals.beats}`,
  );
}

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("enrich-metadata.ts") || process.argv[1].endsWith("enrich-metadata.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
