#!/usr/bin/env tsx

/**
 * mix-resolver.ts — Map `SampleRef` entries in a parsed `MixIR` to
 * concrete WAV files under the normalised `output/` corpus.
 *
 * The normalised corpus layout (produced by `scripts/normalize.ts`) is
 *   output/<Category>[/<Subcategory>]/<filename>.wav
 * with a single `output/metadata.json` manifest listing every sample. Each
 * record carries a `product` field naming the owning eJay edition and a
 * mixture of per-format identifiers:
 *
 *   * `source`          — Gen 1 PXD path (e.g. "AA/BINP.PXD")
 *   * `sample_id`       — Gen 2/3 numeric ID (stable across files)
 *   * `internal_name`   — Gen 2/3 internal PXD stem (e.g. "D5MA060")
 *   * `alias`           — Gen 2/3 human label (e.g. "kick3")
 *
 * Resolution strategy per MixIR format:
 *
 *   * **Format A** — `SampleRef.rawId` + Gen 1 MAX catalog → pxd path →
 *     `NormalizedSample.source` (case-insensitive).
 *   * **Format B** — `SampleRef.rawId` ↔ `NormalizedSample.sample_id`.
 *     Falls back to `internalName` stem match when the ID is out of range.
 *   * **Format C / D** — `SampleRef.displayName` ↔ `NormalizedSample.alias`
 *     (case-insensitive). Falls back to the filename stem.
 *
 * Cross-product fallback is driven by the MixIR `product` field plus an
 * ordered list in `PRODUCT_FALLBACKS` (e.g. Dance eJay 1 spills over into
 * Dance SuperPack). Catalog entries on the MixIR are inspected so external
 * expansion packs referenced by name (DMKIT1/2/3) are searched too.
 *
 * Unresolved refs emit a warning and leave `resolvedPath` as `null`. The
 * resolver never throws on missing data.
 */

import { existsSync, readFileSync } from "fs";
import { posix, resolve } from "path";

import {
  buildGen1Catalog,
  GEN1_PRODUCT_LAYOUT,
  resolveProductPaths,
  type Gen1Catalog,
} from "./gen1-catalog.js";
import type { CatalogEntry, MixIR, SampleRef, TrackPlacement } from "./mix-types.js";

// ── Types ────────────────────────────────────────────────────

export interface NormalizedSample {
  filename: string;
  product: string;
  category: string;
  subcategory?: string | null;
  alias?: string | null;
  source?: string | null;
  source_archive?: string | null;
  internal_name?: string | null;
  sample_id?: number | null;
  bpm?: number | null;
  duration_sec?: number | null;
  /** Allow the metadata file's extra fields without constraining callers. */
  [key: string]: unknown;
}

export interface NormalizedMetadata {
  samples: NormalizedSample[];
}

export interface ProductIndex {
  product: string;
  samples: NormalizedSample[];
  bySampleId: Map<number, NormalizedSample>;
  bySource: Map<string, NormalizedSample>;
  byInternalName: Map<string, NormalizedSample>;
  byAlias: Map<string, NormalizedSample[]>;
  byStem: Map<string, NormalizedSample>;
}

export interface ResolverIndex {
  outputRoot: string;
  archiveRoot: string;
  gen1: Map<string, Gen1Catalog>;
  products: Map<string, ProductIndex>;
}

export interface ResolverOptions {
  metadata: NormalizedMetadata;
  outputRoot?: string;
  archiveRoot?: string;
  /** Precomputed Gen 1 catalogs keyed by canonical product id. */
  gen1Catalogs?: Map<string, Gen1Catalog>;
}

export interface ResolutionReport {
  total: number;
  resolved: number;
  unresolved: number;
  warnings: string[];
  tracks: TrackPlacement[];
}

// ── Canonicalisation ─────────────────────────────────────────

/**
 * Map parser-emitted product labels (derived from the first catalog entry)
 * to canonical `output/<product>/` folder ids.
 */
export const PRODUCT_ALIASES: Record<string, string> = {
  Dance_eJay_10: "Dance_eJay1",
  Dance_eJay_20: "Dance_eJay2",
  Dance_eJay_30: "Dance_eJay3",
  Dance_eJay_40: "Dance_eJay4",
  Dance_eJay_SuperPack: "Dance_SuperPack",
  Techno_eJay_30: "Techno_eJay3",
  Techno_eJay_40: "Techno_eJay",
  HipHop_eJay_20: "HipHop_eJay2",
  HipHop_eJay_30: "HipHop_eJay3",
  HipHop_eJay_40: "HipHop_eJay4",
  House_eJay_10: "House_eJay",
  Xtreme_eJay_10: "Xtreme_eJay",
  Rave_eJay_101: "Rave",
  Rave_eJay: "Rave",
};

/** Return the canonical product id for a parser-emitted label. */
export function canonicalizeProduct(label: string): string {
  return PRODUCT_ALIASES[label] ?? label;
}

/**
 * Ordered cross-product fallback chain. When a sample cannot be resolved in
 * the primary product, these secondary products are searched in order.
 */
export const PRODUCT_FALLBACKS: Record<string, string[]> = {
  Dance_eJay1: ["Dance_SuperPack", "SampleKit_DMKIT1", "SampleKit_DMKIT2"],
  Dance_SuperPack: ["Dance_eJay1", "SampleKit_DMKIT1", "SampleKit_DMKIT2"],
  GenerationPack1_HipHop: ["HipHop_eJay2", "HipHop_eJay3"],
  HipHop_eJay1: ["GenerationPack1_HipHop", "HipHop_eJay2", "HipHop_eJay3"],
};

/** Map MixIR catalog names to canonical product ids used as fallbacks. */
const CATALOG_PRODUCT_HINTS: Array<{ match: RegExp; product: string }> = [
  { match: /DanceMachine\s*Sample[-\s]*Kit\s*Vol\.?\s*1/i, product: "SampleKit_DMKIT1" },
  { match: /DanceMachine\s*Sample[-\s]*Kit\s*Vol\.?\s*2/i, product: "SampleKit_DMKIT2" },
  { match: /Space\s*Sounds/i, product: "SampleKit_DMKIT3" },
  { match: /Dance\s*eJay\s*1/i, product: "Dance_eJay1" },
  { match: /Dance\s*eJay\s*2/i, product: "Dance_eJay2" },
  { match: /Dance\s*eJay\s*3/i, product: "Dance_eJay3" },
  { match: /Dance\s*eJay\s*4/i, product: "Dance_eJay4" },
  { match: /Dance\s*SuperPack|Super\s*Pack/i, product: "Dance_SuperPack" },
];

/** Translate MixIR catalogs to a list of canonical product ids. */
export function productsFromCatalogs(catalogs: CatalogEntry[]): string[] {
  const ids: string[] = [];
  for (const c of catalogs) {
    for (const { match, product } of CATALOG_PRODUCT_HINTS) {
      if (match.test(c.name) && !ids.includes(product)) {
        ids.push(product);
        break;
      }
    }
  }
  return ids;
}

// ── Index builder ────────────────────────────────────────────

function normaliseSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/\\/g, "/").toLowerCase();
}

function filenameStem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  return stem.toLowerCase();
}

function sampleRelativePath(sample: NormalizedSample): string {
  const subdir = sample.subcategory
    ? posix.join(sample.category, sample.subcategory)
    : sample.category;
  return posix.join(subdir, sample.filename);
}

function addToMultiMap(
  map: Map<string, NormalizedSample[]>,
  key: string,
  sample: NormalizedSample,
): void {
  const existing = map.get(key);
  if (existing) existing.push(sample);
  else map.set(key, [sample]);
}

/**
 * Group samples by product and build O(1) lookup maps per identifier. The
 * returned indexes are case-insensitive on all string keys.
 */
export function buildProductIndexes(
  metadata: NormalizedMetadata,
): Map<string, ProductIndex> {
  const products = new Map<string, ProductIndex>();
  for (const sample of metadata.samples) {
    if (!sample.product) continue;
    let idx = products.get(sample.product);
    if (!idx) {
      idx = {
        product: sample.product,
        samples: [],
        bySampleId: new Map(),
        bySource: new Map(),
        byInternalName: new Map(),
        byAlias: new Map(),
        byStem: new Map(),
      };
      products.set(sample.product, idx);
    }
    idx.samples.push(sample);

    if (typeof sample.sample_id === "number") {
      idx.bySampleId.set(sample.sample_id, sample);
    }
    const src = normaliseSource(sample.source ?? null);
    if (src) {
      idx.bySource.set(src, sample);
      // Also index by basename so lookups that only have the file stem work.
      const base = src.split("/").pop() ?? src;
      idx.byStem.set(filenameStem(base), sample);
    }
    if (sample.internal_name) {
      idx.byInternalName.set(sample.internal_name.toLowerCase(), sample);
    }
    if (sample.alias) {
      addToMultiMap(idx.byAlias, sample.alias.toLowerCase(), sample);
    }
    if (sample.filename) {
      const stem = filenameStem(sample.filename);
      if (!idx.byStem.has(stem)) idx.byStem.set(stem, sample);
    }
  }
  return products;
}

/**
 * Load Gen 1 catalogs for every known product, reading MAX files under the
 * given `archiveRoot`. Missing products are skipped silently (returns an
 * empty map when `archiveRoot` does not exist).
 */
export function loadGen1Catalogs(archiveRoot: string): Map<string, Gen1Catalog> {
  const out = new Map<string, Gen1Catalog>();
  if (!existsSync(archiveRoot)) return out;
  for (const product of Object.keys(GEN1_PRODUCT_LAYOUT)) {
    try {
      const paths = resolveProductPaths(product, archiveRoot);
      if (!existsSync(paths.maxPath)) continue;
      const maxText = readFileSync(paths.maxPath, "utf8");
      const pxddanceText =
        paths.pxddancePath && existsSync(paths.pxddancePath)
          ? readFileSync(paths.pxddancePath, "utf8")
          : undefined;
      const pxdtxtText =
        paths.pxdtxtPath && existsSync(paths.pxdtxtPath)
          ? readFileSync(paths.pxdtxtPath, "utf8")
          : undefined;
      out.set(
        product,
        buildGen1Catalog({
          maxText,
          pxddanceText,
          pxdtxtText,
          product,
          maxPath: paths.maxPath,
          pxddancePath: paths.pxddancePath,
        }),
      );
    } catch {
      // Unknown layout or unreadable MAX — skip.
    }
  }
  return out;
}

/**
 * Gen 1 catalog aliases: parser-emitted product labels that should share
 * a Gen 1 catalog with another product (e.g. HipHop_eJay1 uses the
 * GenerationPack1_HipHop MAX catalog because there is no standalone
 * HipHop 1 archive directory).
 */
const GEN1_CATALOG_ALIASES: Record<string, string> = {
  HipHop_eJay1: "GenerationPack1_HipHop",
};

/**
 * Build a fully-populated `ResolverIndex` from normalised metadata plus
 * (optionally) Gen 1 catalogs. Gen 1 catalogs are lazy-loaded from
 * `archiveRoot` when not provided.
 */
export function buildResolverIndex(opts: ResolverOptions): ResolverIndex {
  const outputRoot = resolve(opts.outputRoot ?? "output");
  const archiveRoot = resolve(opts.archiveRoot ?? "archive");
  const gen1 = opts.gen1Catalogs ?? loadGen1Catalogs(archiveRoot);

  // Propagate Gen 1 catalog aliases so products without their own MAX
  // file inherit a compatible catalog from a related product.
  for (const [alias, canonical] of Object.entries(GEN1_CATALOG_ALIASES)) {
    if (!gen1.has(alias) && gen1.has(canonical)) {
      gen1.set(alias, gen1.get(canonical)!);
    }
  }

  const products = buildProductIndexes(opts.metadata);
  return { outputRoot, archiveRoot, gen1, products };
}

// ── Lookup helpers ───────────────────────────────────────────

function lookupInProduct(
  idx: ProductIndex,
  ref: SampleRef,
  gen1: Gen1Catalog | undefined,
): NormalizedSample | null {
  // Format B/C/D: prefer numeric sample_id when the ref carries a plausible one.
  if (ref.rawId > 0 && idx.bySampleId.has(ref.rawId)) {
    return idx.bySampleId.get(ref.rawId)!;
  }

  // Format A: resolve rawId via the Gen 1 MAX catalog, then match its path.
  if (gen1 && ref.rawId > 0 && ref.rawId < gen1.entries.length) {
    const entry = gen1.entries[ref.rawId];
    if (entry.path) {
      const byPath = idx.bySource.get(entry.path);
      if (byPath) return byPath;
      if (entry.file) {
        const byStem = idx.byStem.get(entry.file.toLowerCase());
        if (byStem) return byStem;
      }
    }
  }

  // Format B fallback: internalName stem (e.g. "humn.9" → "humn").
  if (ref.internalName) {
    const lower = ref.internalName.toLowerCase();
    const stem = lower.split(".")[0] ?? lower;
    const direct = idx.byInternalName.get(lower);
    if (direct) return direct;
    const byStem = idx.byStem.get(stem);
    if (byStem) return byStem;
  }

  // Format C/D: displayName → alias.
  if (ref.displayName) {
    const lower = ref.displayName.toLowerCase();
    const matches = idx.byAlias.get(lower);
    if (matches && matches.length > 0) return matches[0];
    const byStem = idx.byStem.get(lower);
    if (byStem) return byStem;
  }

  return null;
}

function buildLookupOrder(mix: MixIR): string[] {
  const primary = canonicalizeProduct(mix.product);
  const order = [primary];
  for (const hint of productsFromCatalogs(mix.catalogs)) {
    if (!order.includes(hint)) order.push(hint);
  }
  for (const fallback of PRODUCT_FALLBACKS[primary] ?? []) {
    if (!order.includes(fallback)) order.push(fallback);
  }
  return order;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve every `TrackPlacement.sampleRef` on `mix` against `index`. Returns
 * a new array of tracks with `resolvedPath` populated where possible (never
 * mutates the input). Unresolvable refs keep `resolvedPath: null` and
 * contribute a warning to the returned report.
 */
export function resolveMix(mix: MixIR, index: ResolverIndex): ResolutionReport {
  const order = buildLookupOrder(mix);
  const warnings: string[] = [];
  let resolved = 0;
  let unresolved = 0;

  const tracks: TrackPlacement[] = mix.tracks.map((track) => {
    for (const productId of order) {
      const productIdx = index.products.get(productId);
      if (!productIdx) continue;
      const gen1 = index.gen1.get(productId);
      const match = lookupInProduct(productIdx, track.sampleRef, gen1);
      if (match) {
        resolved += 1;
        return {
          ...track,
          sampleRef: {
            ...track.sampleRef,
            resolvedPath: sampleRelativePath(match),
          },
        };
      }
    }
    unresolved += 1;
    warnings.push(describeUnresolved(track.sampleRef, order));
    return track;
  });

  return {
    total: mix.tracks.length,
    resolved,
    unresolved,
    warnings,
    tracks,
  };
}

function describeUnresolved(ref: SampleRef, order: string[]): string {
  const hints: string[] = [];
  if (ref.rawId > 0) hints.push(`rawId=${ref.rawId}`);
  if (ref.internalName) hints.push(`internal=${ref.internalName}`);
  if (ref.displayName) hints.push(`display=${ref.displayName}`);
  const label = hints.length > 0 ? hints.join(" ") : "<no identifiers>";
  return `unresolved ${label} (tried: ${order.join(", ") || "<none>"})`;
}
