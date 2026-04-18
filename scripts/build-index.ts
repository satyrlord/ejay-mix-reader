#!/usr/bin/env tsx

// Reads all output/<product>/metadata.json files and generates
// data/index.json with a lightweight product catalog for the frontend.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { detectFormat } from "./mix-parser.js";
import type { MixFormat } from "./mix-types.js";
import {
  buildCategoryEntries,
  buildDefaultCategoryConfig,
  CATEGORY_CONFIG_FILENAME,
  normalizeCategoryConfig,
} from "../src/data.js";
import type {
  CategoryEntry,
  IndexData,
  MixFileEntry,
  MixLibraryEntry,
  Sample,
  SampleLookupEntry,
} from "../src/data.js";

// Re-export the shared schema so existing consumers (tests, callers) can
// keep importing it from this module without reaching into `src/`.
export type {
  CategoryEntry,
  IndexData,
  MixFileEntry,
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
export const ARCHIVE_MIX_DIRS: Record<string, { archiveDir: string; mixSubdir: string }> = {
  Dance_eJay1:     { archiveDir: "Dance_eJay1",     mixSubdir: "MIX" },
  Dance_eJay2:     { archiveDir: "Dance_eJay2",     mixSubdir: "MIX" },
  Dance_eJay3:     { archiveDir: "Dance_eJay3",     mixSubdir: "MIX" },
  Dance_eJay4:     { archiveDir: "Dance_eJay4",     mixSubdir: "Mix" },
  Dance_SuperPack: { archiveDir: "Dance_SuperPack", mixSubdir: "MIX" },
  HipHop_eJay2:    { archiveDir: "HipHop 2",        mixSubdir: "MIX" },
  HipHop_eJay3:    { archiveDir: "HipHop 3",        mixSubdir: "MIX" },
  HipHop_eJay4:    { archiveDir: "HipHop 4",        mixSubdir: "MIX" },
  House_eJay:      { archiveDir: "House_eJay",      mixSubdir: "Mix" },
  Rave:            { archiveDir: "Rave",            mixSubdir: "MIX" },
  Techno_eJay3:    { archiveDir: "Techno 3",        mixSubdir: "MIX" },
  Techno_eJay:     { archiveDir: "TECHNO_EJAY",     mixSubdir: "MIX" },
  Xtreme_eJay:     { archiveDir: "Xtreme_eJay",     mixSubdir: "mix" },
};

interface RawSample extends Sample {}

interface RawMetadata {
  samples: RawSample[];
}

export function deriveDisplayName(folderId: string): string {
  return folderId
    .replace(/_/g, " ")
    .replace(/(\d+)$/, " $1")
    .replace(/\bDMKIT (\d+)\b/g, "DMKIT$1")
    .replace(/  +/g, " ")
    .trim();
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

/**
 * Scan a `.mix` directory and return one inventory entry per valid file.
 * Files smaller than `MIN_MIX_SIZE` and files that `detectFormat()` cannot
 * classify are skipped with a warning so the index stays clean.
 */
export function scanMixDir(mixDir: string): MixFileEntry[] {
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
    let format: MixFormat | null;
    try {
      format = detectFormat(readFileSync(full));
    } catch {
      format = null;
    }
    if (!format) {
      console.warn(`WARNING: ${full} has an unrecognised format — skipping`);
      continue;
    }
    mixes.push({ filename: entry, sizeBytes: size, format });
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
  const layout = ARCHIVE_MIX_DIRS[productId];
  if (!layout) return [];
  const productArchivePath = join(archiveDir, layout.archiveDir);
  if (!existsSync(productArchivePath)) return [];
  const mixDir = findMixSubdir(productArchivePath);
  if (!mixDir) return [];
  return scanMixDir(mixDir);
}

/**
 * Walk every product registered in `ARCHIVE_MIX_DIRS` and build the full
 * `.mix` library. Products whose archive folder is missing or whose MIX
 * directory is empty are omitted so the browser UI never sees dead entries.
 */
export function buildMixLibrary(archiveDir: string = ARCHIVE_DIR): MixLibraryEntry[] {
  const entries: MixLibraryEntry[] = [];
  for (const productId of Object.keys(ARCHIVE_MIX_DIRS).sort()) {
    const mixes = collectProductMixes(productId, archiveDir);
    if (mixes.length === 0) continue;
    entries.push({ id: productId, name: deriveDisplayName(productId), mixes });
  }
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
  const samples = rawSamples.length > 0 ? rawSamples : scanNormalizedSamples(outputDir);
  const configuredCategories = readCategoryConfig(outputDir)?.categories ?? buildCategoryEntries([], buildDefaultCategoryConfig().categories);
  const categories = buildCategoryEntries(
    samples,
    configuredCategories.map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: [...category.subcategories],
    })),
  );

  const sampleIndex = buildSampleIndex(outputDir);

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
export function buildSampleIndex(outputDir: string): Record<string, SampleLookupEntry> {
  const metaPath = join(outputDir, "metadata.json");
  if (!existsSync(metaPath)) return {};

  interface MetaSample {
    filename?: string;
    alias?: string;
    category?: string;
    subcategory?: string;
    product?: string;
    source?: string;
  }

  let meta: { samples?: MetaSample[] };
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return {};
  }
  if (!Array.isArray(meta.samples)) return {};

  const index: Record<string, SampleLookupEntry> = {};

  for (const sample of meta.samples) {
    const product = sample.product;
    if (!product) continue;

    if (!index[product]) {
      index[product] = { byAlias: {}, bySource: {}, byStem: {} };
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

    if (sample.source) {
      entry.bySource[sample.source.replace(/\\/g, "/").toLowerCase()] = relPath;
    }

    const dot = filename.lastIndexOf(".");
    const stem = (dot >= 0 ? filename.slice(0, dot) : filename).toLowerCase();
    if (!entry.byStem[stem]) {
      entry.byStem[stem] = relPath;
    }
  }

  return index;
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
