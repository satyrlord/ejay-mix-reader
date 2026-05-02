#!/usr/bin/env tsx

// Reads all output/<product>/metadata.json files and generates
// data/index.json with a lightweight product catalog for the frontend.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { detectFormat, parseMix } from "./mix-parser.js";
import { canonicalizeProduct, loadGen1Catalogs, PRODUCT_FALLBACKS } from "./mix-resolver.js";
import { normalisePxdPath, parsePxddanceFile } from "./gen1-catalog.js";
import { parseInfCatalog } from "./pxd-parser.js";
import type { MixFormat } from "./mix-types.js";
import {
  buildCategoryEntries,
  buildDefaultCategoryConfig,
  CATEGORY_CONFIG_FILENAME,
  EMBEDDED_MIX_MANIFEST_FILENAME,
  humanizeIdentifier,
  mergeSamplesByAudioPath,
  normalizeCategoryConfig,
  parseEmbeddedMixManifest,
  embeddedMixSamplesFromManifest,
  UNSORTED_CATEGORY_ID,
} from "../src/data.js";
import type {
  CategoryEntry,
  IndexData,
  MixFileEntry,
  MixFileMeta,
  MixLibraryEntry,
  Sample,
  SampleLookupEntry,
} from "../src/data.js";
import { irToMeta } from "./extract-mix-metadata.js";

// Re-export the shared schema so existing consumers (tests, callers) can
// keep importing it from this module without reaching into `src/`.
export type {
  CategoryEntry,
  IndexData,
  MixFileEntry,
  MixFileMeta,
  MixLibraryEntry,
  Sample,
  SampleLookupEntry,
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "output");
const ARCHIVE_DIR = join(ROOT, "archive");
const DATA_DIR = join(ROOT, "data");
const INDEX_FILE = join(DATA_DIR, "index.json");

/** Minimum valid `.mix` file size. Files smaller than this are skipped
 *  (covers the 2-byte `archive/Dance_eJay4/Mix/.mix` placeholder). */
const MIN_MIX_SIZE = 4;

/**
 * Map canonical product ids to their archive folder + case-specific `MIX/`
 * sub-folder. Products without a `.mix` folder (e.g. sample kits, the
 * GenerationPack1 re-releases) are intentionally absent.
 */
export const ARCHIVE_MIX_DIRS: Record<string, { archiveDir: string; archiveDirAliases?: string[]; mixSubdir: string; mixSubdirAliases?: string[] }> = {
  Dance_eJay1:     { archiveDir: "Dance_eJay1",     archiveDirAliases: ["Dance eJay 1"], mixSubdir: "MIX" },
  Dance_eJay2:     { archiveDir: "Dance_eJay2",     archiveDirAliases: ["Dance eJay 2", "Dance eJay 2 OLD", "Dance eJay 2 NEW"], mixSubdir: "MIX", mixSubdirAliases: ["D2/MIX"] },
  Dance_eJay3:     { archiveDir: "Dance_eJay3",     archiveDirAliases: ["Dance eJay 3"], mixSubdir: "MIX" },
  Dance_eJay4:     { archiveDir: "Dance_eJay4",     archiveDirAliases: ["Dance eJay 4"], mixSubdir: "Mix" },
  Dance_SuperPack: { archiveDir: "Dance_SuperPack", archiveDirAliases: ["Dance SuperPack"], mixSubdir: "MIX" },
  HipHop_eJay1:    {
    archiveDir: "HipHop 1",
    archiveDirAliases: ["HipHop eJay 1", "HipHop eJay 1/h"],
    mixSubdir: "MIX",
    mixSubdirAliases: ["h/MIX"],
  },
  HipHop_eJay2:    { archiveDir: "HipHop eJay 2",   archiveDirAliases: ["HipHop 2"], mixSubdir: "MIX" },
  HipHop_eJay3:    { archiveDir: "HipHop 3",        archiveDirAliases: ["HipHop eJay 3"], mixSubdir: "MIX" },
  HipHop_eJay4:    { archiveDir: "HipHop 4",        archiveDirAliases: ["HipHop eJay 4"], mixSubdir: "MIX" },
  House_eJay:      { archiveDir: "House_eJay",      archiveDirAliases: ["House eJay"], mixSubdir: "Mix" },
  Rave:            { archiveDir: "Rave",            archiveDirAliases: ["Rave eJay"], mixSubdir: "MIX" },
  Techno_eJay3:    { archiveDir: "Techno 3",        archiveDirAliases: ["Techno eJay 3"], mixSubdir: "MIX" },
  Techno_eJay:     { archiveDir: "TECHNO_EJAY",     archiveDirAliases: ["Techno eJay 2", "Techno eJay"], mixSubdir: "MIX", mixSubdirAliases: ["eJay/mix", "eJay/MIX"] },
  Xtreme_eJay:     { archiveDir: "Xtreme_eJay",     archiveDirAliases: ["Xtreme"], mixSubdir: "mix" },
};

type RawSample = Sample;

interface RawMetadata {
  samples: RawSample[];
}

export function deriveDisplayName(folderId: string): string {
  return humanizeIdentifier(folderId, { compactDmkit: true });
}

export function countWavFiles(dirPath: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += countWavFiles(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
        count++;
      }
    }
  } catch {
    // Directory not readable — return 0
  }
  return count;
}

function readRootCatalogSamples(outputDir: string): RawSample[] {
  const metaPath = join(outputDir, "metadata.json");
  if (!existsSync(metaPath)) return [];

  try {
    const parsed: unknown = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { samples?: unknown }).samples)
    ) {
      return (parsed as RawMetadata).samples;
    }
  } catch {
    // Ignore and fall back to scanning the normalized folder tree.
  }

  return [];
}

function readEmbeddedMixManifestSamples(outputDir: string): RawSample[] {
  const manifestPath = join(outputDir, UNSORTED_CATEGORY_ID, EMBEDDED_MIX_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return [];

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const manifest = parseEmbeddedMixManifest(parsed);
    return manifest ? embeddedMixSamplesFromManifest(manifest) : [];
  } catch {
    return [];
  }
}

function readCategoryConfig(outputDir: string): { categories: CategoryEntry[] } | null {
  const configPath = join(outputDir, CATEGORY_CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    const config = normalizeCategoryConfig(parsed);
    if (!config) return null;
    return { categories: buildCategoryEntries([], config.categories) };
  } catch {
    return null;
  }
}

function scanNormalizedSamples(outputDir: string): RawSample[] {
  const samples: RawSample[] = [];
  const entries = readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const categoryDir = join(outputDir, entry.name);
    if (existsSync(join(categoryDir, "metadata.json"))) {
      continue;
    }

    collectCategorySamples(categoryDir, entry.name, [], samples);
  }

  return samples;
}

function collectCategorySamples(
  dirPath: string,
  categoryName: string,
  pathParts: string[],
  samples: RawSample[],
): void {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectCategorySamples(fullPath, categoryName, [...pathParts, entry.name], samples);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".wav")) continue;

    const subcategory = pathParts.length > 0 ? pathParts[0] : null;
    const filename = pathParts.length > 1
      ? `${pathParts.slice(1).join("/")}/${entry.name}`
      : entry.name;

    samples.push({
      filename,
      alias: entry.name.replace(/\.wav$/i, ""),
      category: categoryName,
      subcategory,
    });
  }
}

/**
 * Locate the MIX sub-folder for a product, accepting any case variant
 * (`MIX/`, `Mix/`, `mix/`) without reaching into `ARCHIVE_MIX_DIRS`. Returns
 * the absolute path when found, otherwise null.
 */
export function findMixSubdir(productArchivePath: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(productArchivePath);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.toLowerCase() !== "mix") continue;
    const full = join(productArchivePath, entry);
    try {
      if (statSync(full).isDirectory()) return full;
    } catch {
      // Unreadable entry — skip.
    }
  }
  return null;
}

function archiveDirCandidates(productId: string): string[] {
  const layout = ARCHIVE_MIX_DIRS[productId];
  if (!layout) return [];
  return [layout.archiveDir, ...(layout.archiveDirAliases ?? [])];
}

export function resolveProductArchivePath(productId: string, archiveDir: string): string | null {
  for (const candidate of archiveDirCandidates(productId)) {
    const productArchivePath = join(archiveDir, candidate);
    if (existsSync(productArchivePath)) return productArchivePath;
  }
  return null;
}

export function resolveProductMixDir(
  productId: string,
  archiveDir: string,
): { productArchivePath: string; mixDir: string } | null {
  const layout = ARCHIVE_MIX_DIRS[productId];
  if (!layout) return null;
  const productArchivePath = resolveProductArchivePath(productId, archiveDir);
  if (!productArchivePath) return null;

  const explicitMixCandidates = [layout.mixSubdir, ...(layout.mixSubdirAliases ?? [])];
  for (const relMixPath of explicitMixCandidates) {
    const mixDir = join(productArchivePath, relMixPath);
    if (existsSync(mixDir)) {
      return { productArchivePath, mixDir };
    }
  }

  const mixDir = findMixSubdir(productArchivePath);
  if (!mixDir) return null;
  return { productArchivePath, mixDir };
}

/**
 * Scan a `.mix` directory and return one inventory entry per valid file.
 * Files smaller than `MIN_MIX_SIZE` and files that `detectFormat()` cannot
 * classify are skipped with a warning so the index stays clean.
 * Each entry is enriched with parsed `MixFileMeta` when the file parses
 * successfully.
 *
 * @param mixDir Absolute path to the directory that contains `.mix` files.
 * @param productId Optional product identifier forwarded to `parseMix` so the
 * parser can apply product-specific quirks when decoding the mix grid. When
 * omitted, `parseMix` uses heuristic format detection alone.
 */
export function scanMixDir(mixDir: string, productId?: string): MixFileEntry[] {
  let entries: string[];
  try {
    entries = readdirSync(mixDir);
  } catch {
    return [];
  }
  const mixes: MixFileEntry[] = [];
  for (const entry of entries.sort()) {
    if (!/\.mix$/i.test(entry)) continue;
    const full = join(mixDir, entry);
    let size: number;
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (size < MIN_MIX_SIZE) {
      console.warn(`WARNING: ${full} is ${size} bytes — skipping (below ${MIN_MIX_SIZE}-byte minimum)`);
      continue;
    }
    let buf: Buffer;
    try {
      buf = readFileSync(full);
    } catch {
      console.warn(`WARNING: could not read ${full} — skipping`);
      continue;
    }
    let format: MixFormat | null;
    try {
      format = detectFormat(buf);
    } catch {
      format = null;
    }
    if (!format) {
      console.warn(`WARNING: ${full} has an unrecognised format — skipping`);
      continue;
    }
    let meta: MixFileMeta | undefined;
    try {
      const ir = parseMix(buf, productId);
      const extracted = irToMeta(ir);
      if (extracted) meta = extracted;
    } catch (err) {
      // Metadata extraction failures are non-fatal — entry still included.
      console.warn(`WARNING: could not extract metadata from ${full}: ${String(err)}`);
    }
    const fileEntry: MixFileEntry = { filename: entry, sizeBytes: size, format };
    if (meta) fileEntry.meta = meta;
    mixes.push(fileEntry);
  }
  return mixes;
}

/**
 * Build the `.mix` inventory for a single product by looking up its archive
 * path in `ARCHIVE_MIX_DIRS` and delegating to `scanMixDir`. Returns an
 * empty array for products without a registered archive folder or whose
 * MIX sub-folder is absent.
 */
export function collectProductMixes(productId: string, archiveDir: string): MixFileEntry[] {
  if (!ARCHIVE_MIX_DIRS[productId]) return [];
  const resolved = resolveProductMixDir(productId, archiveDir);
  if (!resolved) return [];
  return scanMixDir(resolved.mixDir, productId);
}

/**
 * Humanize a single `_userdata` path segment. Leading underscores are
 * stripped (e.g. `_unsorted` → "Unsorted") before the segment is passed
 * through `humanizeIdentifier` so that names like `Dance2` render as
 * "Dance 2".
 */
function humanizeUserdataSegment(seg: string): string {
  return humanizeIdentifier(seg.startsWith("_") ? seg.slice(1) : seg, { compactDmkit: true });
}

/**
 * Derive a human-readable label for a `_userdata` group from its path
 * segments relative to `archive/_userdata`. Segments are joined with " – "
 * and prefixed with "User: " to distinguish them from product archives.
 * Example: ["Dance and House", "Dance2"] → "User: Dance and House – Dance 2"
 */
export function userdataGroupLabel(relParts: string[]): string {
  return `User: ${relParts.map(humanizeUserdataSegment).join(" \u2013 ")}`;
}

/**
 * Recursively walk `dir` looking for subdirectories that directly contain
 * at least one `.mix` file. Results are appended to `results` with the
 * relative path from the starting directory recorded as `relParts`.
 */
function collectMixLeafDirs(
  dir: string,
  relParts: string[],
  results: Array<{ relParts: string[]; absPath: string }>,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  let hasMix = false;
  const subdirs: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        subdirs.push(entry);
      } else if (st.isFile() && /\.mix$/i.test(entry)) {
        hasMix = true;
      }
    } catch {
      // Unreadable entry — skip.
    }
  }
  if (hasMix && relParts.length > 0) {
    results.push({ relParts, absPath: dir });
  }
  for (const sub of subdirs) {
    collectMixLeafDirs(join(dir, sub), [...relParts, sub], results);
  }
}

const USERDATA_SUBDIR = "_userdata";
const USERDATA_SUBDIR_ALIASES = [USERDATA_SUBDIR, "_user"] as const;

function resolveUserdataDir(archiveDir: string): string | null {
  for (const subdir of USERDATA_SUBDIR_ALIASES) {
    const candidate = join(archiveDir, subdir);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Scan the user-mix tree (preferring `archive/_userdata`, falling back to
 * `archive/_user`) for subdirectory groups that directly contain `.mix`
 * files and return a `MixLibraryEntry` for each. Group IDs remain canonical
 * `_userdata/<relPath>` so `resolveMixUrl` can reconstruct the file-system
 * path from the URL (the browser percent-encodes the `/`).
 */
export function buildUserdataMixLibrary(archiveDir: string): MixLibraryEntry[] {
  const userdataDir = resolveUserdataDir(archiveDir);
  if (!userdataDir) return [];

  const found: Array<{ relParts: string[]; absPath: string }> = [];
  collectMixLeafDirs(userdataDir, [], found);
  found.sort((a, b) => a.relParts.join("/").localeCompare(b.relParts.join("/")));

  const entries: MixLibraryEntry[] = [];
  for (const { relParts, absPath } of found) {
    const mixes = scanMixDir(absPath);
    if (mixes.length === 0) continue;
    entries.push({
      id: `${USERDATA_SUBDIR}/${relParts.join("/")}`,
      name: userdataGroupLabel(relParts),
      mixes,
    });
  }
  return entries;
}

/**
 * Walk every product registered in `ARCHIVE_MIX_DIRS` and build the full
 * `.mix` library. Products whose archive folder is missing or whose MIX
 * directory is empty are omitted so the browser UI never sees dead entries.
 * User-created mixes from `archive/_userdata` are appended after the product
 * entries.
 */
export function buildMixLibrary(archiveDir: string = ARCHIVE_DIR): MixLibraryEntry[] {
  const entries: MixLibraryEntry[] = [];
  for (const productId of Object.keys(ARCHIVE_MIX_DIRS).sort()) {
    const mixes = collectProductMixes(productId, archiveDir);
    if (mixes.length === 0) continue;
    entries.push({ id: productId, name: deriveDisplayName(productId), mixes });
  }
  entries.push(...buildUserdataMixLibrary(archiveDir));
  return entries;
}

export function buildIndex(
  outputDir: string = OUTPUT_DIR,
  archiveDir: string = ARCHIVE_DIR,
): IndexData {
  if (!existsSync(outputDir)) {
    console.warn(`WARNING: output directory not found at ${outputDir} — generating empty index`);
    return { categories: [], mixLibrary: buildMixLibrary(archiveDir) };
  }

  const rawSamples = readRootCatalogSamples(outputDir);
  const scannedSamples = rawSamples.length > 0 ? rawSamples : scanNormalizedSamples(outputDir);
  const samples = mergeSamplesByAudioPath(scannedSamples, readEmbeddedMixManifestSamples(outputDir));
  const configuredCategories = readCategoryConfig(outputDir)?.categories ?? buildCategoryEntries([], buildDefaultCategoryConfig().categories);
  const categories = buildCategoryEntries(
    samples,
    configuredCategories.map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: [...category.subcategories],
    })),
  );

  const sampleIndex = buildSampleIndex(outputDir, archiveDir);

  return {
    categories,
    mixLibrary: buildMixLibrary(archiveDir),
    ...(Object.keys(sampleIndex).length > 0 ? { sampleIndex } : {}),
  };
}

/**
 * Build per-product sample lookup maps from the shared `output/metadata.json`.
 * Returns an empty object when the metadata file is missing or unparseable.
 */
export function buildSampleIndex(
  outputDir: string,
  archiveDir: string = ARCHIVE_DIR,
): Record<string, SampleLookupEntry> {
  if (!existsSync(outputDir)) return {};

  interface MetaSample {
    filename?: string;
    alias?: string;
    category?: string;
    subcategory?: string;
    product?: string;
    source?: string;
    internal_name?: string;
    sample_id?: number;
    beats?: number;
  }

  const baseSamples = readRootCatalogSamples(outputDir);
  const scannedSamples = baseSamples.length > 0 ? baseSamples : scanNormalizedSamples(outputDir);
  const samples = mergeSamplesByAudioPath(scannedSamples, readEmbeddedMixManifestSamples(outputDir)) as MetaSample[];
  if (samples.length === 0) return {};

  const index: Record<string, SampleLookupEntry> = {};

  for (const sample of samples) {
    const product = sample.product;
    if (!product) continue;

    if (!index[product]) {
      index[product] = {
        byAlias: {},
        bySource: {},
        byStem: {},
        byInternalName: {},
        bySampleId: {},
        byGen1Id: {},
        byPath: {},
        byPathBeats: {},
      };
    }
    const entry = index[product];

    const category = sample.category;
    const subcategory = sample.subcategory;
    const filename = sample.filename;
    if (!filename || !category) continue;

    const relPath = subcategory
      ? `${category}/${subcategory}/${filename}`
      : `${category}/${filename}`;

    if (sample.alias) {
      entry.byAlias[sample.alias.toLowerCase()] = relPath;
    }

    if (typeof sample.internal_name === "string" && sample.internal_name.length > 0) {
      entry.byInternalName[sample.internal_name.toLowerCase()] = relPath;
    }

    if (typeof sample.sample_id === "number" && Number.isFinite(sample.sample_id)) {
      entry.bySampleId[String(sample.sample_id)] = relPath;
    }

    // Forward map path → human label, so the mix renderer can resolve a
    // displayable name from a resolved audio path. Prefer the sample's
    // alias, then internal_name, then the filename stem.
    const byPath = entry.byPath ?? (entry.byPath = {});
    if (!byPath[relPath]) {
      const dotPos = filename.lastIndexOf(".");
      const stemLabel = dotPos >= 0 ? filename.slice(0, dotPos) : filename;
      byPath[relPath] = sample.alias || sample.internal_name || stemLabel;
    }

    if (typeof sample.beats === "number" && Number.isFinite(sample.beats) && sample.beats > 0) {
      const byPathBeats = entry.byPathBeats ?? (entry.byPathBeats = {});
      if (typeof byPathBeats[relPath] !== "number") {
        byPathBeats[relPath] = sample.beats;
      }
    }

    if (sample.source) {
      const normalizedSource = sample.source.replace(/\\/g, "/").toLowerCase();
      entry.bySource[normalizedSource] = relPath;

      const sourceBase = normalizedSource.split("/").pop() ?? normalizedSource;
      const sourceDot = sourceBase.lastIndexOf(".");
      const sourceStem = (sourceDot >= 0 ? sourceBase.slice(0, sourceDot) : sourceBase).toLowerCase();
      if (!entry.byStem[sourceStem]) {
        entry.byStem[sourceStem] = relPath;
      }
    }

    const dot = filename.lastIndexOf(".");
    const stem = (dot >= 0 ? filename.slice(0, dot) : filename).toLowerCase();
    if (!entry.byStem[stem]) {
      entry.byStem[stem] = relPath;
    }
  }

  appendGen1Lookups(index, archiveDir);
  appendGen2CompoundAliases(index, archiveDir);

  return index;
}

/**
 * INF catalog paths for Gen 2 Format B products, relative to the archive root.
 * Each INF file maps internal filenames (e.g. "D5MA066") to a group prefix
 * (e.g. "euro") and an alias (e.g. "kick5"). The concatenation of group+alias
 * forms the compound name ("eurokick5") stored in Format B .mix files.
 */
const GEN2_INF_PATHS: Record<string, string[]> = {
  Dance_eJay2: [
    "Dance_eJay2/D_ejay2/PXD/DANCE20.INF",
    "Dance eJay 2/D_EJAY2/PXD/DANCE20.INF",
    "Dance eJay 2/D2/PXD/dance20.inf",
    "Dance eJay 2 OLD/D_EJAY2/PXD/DANCE20.INF",
    "Dance eJay 2 NEW/D2/PXD/Dancesk4.inf",
    "Dance eJay 2 NEW/D2/PXD/Dancesk5.inf",
    "Dance eJay 2 NEW/D2/PXD/Dancesk6.inf",
  ],
  Techno_eJay: [
    "TECHNO_EJAY/EJAY/PXD/RAVE20.INF",
    "Techno eJay 2/eJay/PXD/rave20.inf",
  ],
  Dance_eJay3: [
    "Dance_eJay3/eJay/pxd/dance30.inf",
    "Dance eJay 3/eJay/pxd/dance30.inf",
  ],
  Dance_eJay4: [
    "Dance_eJay4/ejay/PXD/DANCE40.inf",
    "Dance eJay 4/eJay/PXD/DANCE40.inf",
  ],
  HipHop_eJay2: [
    "HipHop eJay 2/PXD/HipHop20.inf",
    "HipHop eJay 2/PXD/hiphop20.inf",
    "HipHop 2/PXD/HipHop20.inf",
    "HipHop 2/PXD/hiphop20.inf",
    "HipHop 2/eJay/pxd/HipHop20.inf",
    "HipHop eJay 2/eJay/pxd/HipHop20.inf",
  ],
  HipHop_eJay3: [
    "HipHop 3/eJay/pxd/hiphop30.inf",
    "HipHop eJay 3/eJay/pxd/hiphop30.inf",
  ],
  HipHop_eJay4: [
    "HipHop 4/eJay/pxd/HipHop40.inf",
    "HipHop eJay 4/eJay/pxd/HipHop40.inf",
  ],
  House_eJay: [
    "House_eJay/ejay/PXD/HOUSE10.inf",
    "House eJay/ejay/PXD/HOUSE10.inf",
  ],
  Techno_eJay3: [
    "Techno 3/eJay/pxd/rave30.inf",
    "Techno eJay 3/eJay/pxd/rave30.inf",
  ],
  Xtreme_eJay: [
    "Xtreme_eJay/eJay/PXD/xejay10.inf",
    "Xtreme/eJay/PXD/xejay10.inf",
  ],
};

/**
 * Augment each product's `byInternalName` lookup with compound alias keys
 * built from Gen 2 INF catalog files (group prefix + alias, e.g. "eurokick5").
 * This lets Format B .mix files that embed compound names as their internal
 * sample reference resolve correctly via `byInternalName`.
 *
 * Also adds a hyphen-stripped variant (e.g. "darabuka2" from "dara-buka2") to
 * handle the minor transcription difference seen in some Techno_eJay mixes.
 */
function appendGen2CompoundAliases(
  index: Record<string, SampleLookupEntry>,
  archiveDir: string,
): void {
  if (!existsSync(archiveDir) || Object.keys(index).length === 0) return;

  for (const [product, infPaths] of Object.entries(GEN2_INF_PATHS)) {
    const entry = index[product];
    if (!entry) continue;

    for (const relPath of infPaths) {
      const infAbsPath = join(archiveDir, relPath);
      if (!existsSync(infAbsPath)) continue;

      let infEntries: ReturnType<typeof parseInfCatalog>;
      try {
        infEntries = parseInfCatalog(infAbsPath);
      } catch {
        continue;
      }

      for (const infEntry of infEntries) {
        if (!infEntry.category && !infEntry.alias) continue;
        const compound = (infEntry.category + infEntry.alias).toLowerCase().trim();
        if (!compound || compound === infEntry.alias.toLowerCase().trim()) continue;

        // Resolve the audio path via the internal filename already indexed.
        const resolved = entry.byInternalName[infEntry.filename.toLowerCase()];
        if (!resolved) continue;

        if (!entry.byInternalName[compound]) {
          entry.byInternalName[compound] = resolved;
        }
        // Hyphen-stripped variant handles minor transcription drift
        // (e.g. "dara-buka2" in INF vs "darabuka2" stored in some mixes).
        const stripped = compound.replace(/-/g, "");
        if (stripped !== compound && !entry.byInternalName[stripped]) {
          entry.byInternalName[stripped] = resolved;
        }
      }
    }
  }
}

const GEN1_BROWSER_CATALOG_ALIASES: Record<string, string> = {
  HipHop_eJay1: "GenerationPack1_HipHop",
};

const RAVE_PXD_ID_OFFSET = 731;
const RAVE_PXD_PATH_CANDIDATES = [
  "Rave eJay/eJay/eJay/PXD",
  "Rave/RAVE/EJAY/PXD",
  "GenerationPack1/Rave/RAVE/EJAY/PXD",
];

const HIPHOP1_PXD_ID_OFFSET = 731;
const HIPHOP1_PXD_PATH_CANDIDATES = [
  "HipHop eJay 1/h/eJay/eJay/PXD",
  "HipHop 1/h/eJay/eJay/PXD",
  "HipHop eJay 1/HIPHOP/EJAY/PXD",
  "HipHop 1/HIPHOP/EJAY/PXD",
  "GenerationPack1/HipHop/HIPHOP/EJAY/PXD",
];

const DANCE1_PXDDANCE_ID_OFFSET = 731;
const DANCE1_PXDDANCE_PATH_CANDIDATES = [
  "Dance eJay 1/eJay/eJay/Pxddance",
  "Dance eJay 1/dance/EJAY/Pxddance",
  "Dance_eJay1/eJay/eJay/Pxddance",
  "Dance_eJay1/dance/EJAY/Pxddance",
];

function appendDance1PxddanceLookups(
  index: Record<string, SampleLookupEntry>,
  archiveDir: string,
): void {
  const dance1 = index.Dance_eJay1;
  if (!dance1) return;

  let pxdDancePath: string | null = null;
  for (const relPath of DANCE1_PXDDANCE_PATH_CANDIDATES) {
    const candidate = join(archiveDir, relPath);
    if (existsSync(candidate)) {
      pxdDancePath = candidate;
      break;
    }
  }
  if (!pxdDancePath) return;

  let records: ReturnType<typeof parsePxddanceFile>;
  try {
    records = parsePxddanceFile(readFileSync(pxdDancePath, "utf8"));
  } catch {
    return;
  }

  const byGen1Id = dance1.byGen1Id ?? (dance1.byGen1Id = {});
  for (let i = 0; i < records.length; i += 1) {
    const rawId = DANCE1_PXDDANCE_ID_OFFSET + i;
    const normalized = normalisePxdPath(records[i].path);
    if (!normalized.path) continue;

    const fromSource = dance1.bySource[normalized.path];
    if (fromSource) {
      byGen1Id[String(rawId)] = fromSource;
      continue;
    }

    const fileStem = normalized.file?.toLowerCase() ?? null;
    if (!fileStem) continue;
    const fromStem = dance1.byStem[fileStem];
    if (fromStem) {
      byGen1Id[String(rawId)] = fromStem;
    }
  }
}

function appendRavePxdLookups(
  index: Record<string, SampleLookupEntry>,
  archiveDir: string,
): void {
  const rave = index.Rave;
  if (!rave) return;

  let pxdCatalogPath: string | null = null;
  for (const relPath of RAVE_PXD_PATH_CANDIDATES) {
    const candidate = join(archiveDir, relPath);
    if (existsSync(candidate)) {
      pxdCatalogPath = candidate;
      break;
    }
  }
  if (!pxdCatalogPath) return;

  let records: ReturnType<typeof parsePxddanceFile>;
  try {
    records = parsePxddanceFile(readFileSync(pxdCatalogPath, "utf8"));
  } catch {
    return;
  }

  const byGen1Id = rave.byGen1Id ?? (rave.byGen1Id = {});
  for (let i = 0; i < records.length; i += 1) {
    const rawId = RAVE_PXD_ID_OFFSET + i;
    const normalized = normalisePxdPath(records[i].path);
    if (!normalized.path) continue;

    const fromSource = rave.bySource[normalized.path];
    if (fromSource) {
      byGen1Id[String(rawId)] = fromSource;
      continue;
    }

    const fileStem = normalized.file?.toLowerCase() ?? null;
    if (!fileStem) continue;
    const fromStem = rave.byStem[fileStem];
    if (fromStem) {
      byGen1Id[String(rawId)] = fromStem;
    }
  }
}

function appendHipHop1PxdLookups(
  index: Record<string, SampleLookupEntry>,
  archiveDir: string,
): void {
  const hiphop1 = index.HipHop_eJay1;
  if (!hiphop1) return;

  let pxdCatalogPath: string | null = null;
  for (const relPath of HIPHOP1_PXD_PATH_CANDIDATES) {
    const candidate = join(archiveDir, relPath);
    if (existsSync(candidate)) {
      pxdCatalogPath = candidate;
      break;
    }
  }
  if (!pxdCatalogPath) return;

  let records: ReturnType<typeof parsePxddanceFile>;
  try {
    records = parsePxddanceFile(readFileSync(pxdCatalogPath, "utf8"));
  } catch {
    return;
  }

  const byGen1Id = hiphop1.byGen1Id ?? (hiphop1.byGen1Id = {});
  for (let i = 0; i < records.length; i += 1) {
    const rawId = HIPHOP1_PXD_ID_OFFSET + i;
    const normalized = normalisePxdPath(records[i].path);
    if (!normalized.path) continue;

    const fromSource = hiphop1.bySource[normalized.path];
    if (fromSource) {
      byGen1Id[String(rawId)] = fromSource;
      continue;
    }

    const fileStem = normalized.file?.toLowerCase() ?? null;
    if (!fileStem) continue;
    const fromStem = hiphop1.byStem[fileStem];
    if (fromStem) {
      byGen1Id[String(rawId)] = fromStem;
    }
  }
}

function appendGen1Lookups(
  index: Record<string, SampleLookupEntry>,
  archiveDir: string,
): void {
  if (!existsSync(archiveDir) || Object.keys(index).length === 0) {
    return;
  }

  // Rave's runtime sample-id mapping is derived from the PXD row table
  // (rawId = rowIndex + 731), not directly from MAX line numbers.
  appendRavePxdLookups(index, archiveDir);
  // Dance eJay 1 START-format mixes use a transformed Pxddance id window
  // (rawId = rowIndex + 731) for the core 1352 records.
  appendDance1PxddanceLookups(index, archiveDir);
  // HipHop eJay 1 START-format mixes use the HIPHOP/EJAY/PXD row table
  // (rawId = rowIndex + 731), not a direct MAX line-id mapping.
  appendHipHop1PxdLookups(index, archiveDir);

  const gen1Catalogs = loadGen1Catalogs(archiveDir);
  for (const [alias, canonical] of Object.entries(GEN1_BROWSER_CATALOG_ALIASES)) {
    if (!gen1Catalogs.has(alias) && gen1Catalogs.has(canonical)) {
      gen1Catalogs.set(alias, gen1Catalogs.get(canonical)!);
    }
  }

  for (const product of Object.keys(index)) {
    const canonicalProduct = canonicalizeProduct(product);
    const order = [canonicalProduct, ...(PRODUCT_FALLBACKS[canonicalProduct] ?? [])]
      .filter((value, position, list) => list.indexOf(value) === position);
    const byGen1Id = index[product].byGen1Id ?? (index[product].byGen1Id = {});

    for (const catalogProduct of order) {
      const gen1 = gen1Catalogs.get(catalogProduct);
      if (!gen1) continue;

      for (const entry of gen1.entries) {
        if (!entry.path || byGen1Id[String(entry.id)]) continue;

        const fileStem = entry.file?.toLowerCase() ?? null;
        for (const targetProduct of order) {
          const target = index[targetProduct];
          if (!target) continue;

          const bySource = target.bySource[entry.path];
          if (bySource) {
            byGen1Id[String(entry.id)] = bySource;
            break;
          }

          if (fileStem) {
            const byStem = target.byStem[fileStem];
            if (byStem) {
              byGen1Id[String(entry.id)] = byStem;
              break;
            }
          }
        }
      }
    }
  }
}

/* v8 ignore start -- CLI entrypoint, exercised via `npm run build`. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(DATA_DIR, { recursive: true });
  const index = buildIndex();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
  const mixTotal = index.mixLibrary.reduce((s, p) => s + p.mixes.length, 0);
  const sampleTotal = index.categories.reduce((sum, category) => sum + category.sampleCount, 0);
  console.log(
    `data/index.json: ${index.categories.length} categories, ` +
    `${sampleTotal} total samples, ` +
    `${mixTotal} mix files across ${index.mixLibrary.length} mix products`,
  );
}
/* v8 ignore stop */
