#!/usr/bin/env tsx

// Reads all output/<product>/metadata.json files and generates
// data/index.json with a lightweight product catalog for the frontend.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "output");
const DATA_DIR = join(ROOT, "data");
const INDEX_FILE = join(DATA_DIR, "index.json");

interface RawSample {
  filename: string;
  alias?: string;
  category?: string;
  channel?: string;
  duration_sec?: number;
  beats?: number;
}

interface RawMetadata {
  samples: RawSample[];
}

export interface ProductEntry {
  id: string;
  name: string;
  channels: string[];
  sampleCount: number;
}

export interface IndexData {
  products: ProductEntry[];
}

function deriveDisplayName(folderId: string): string {
  return folderId
    .replace(/_/g, " ")
    .replace(/(\d+)$/, " $1")
    .replace(/  +/g, " ")
    .trim();
}

function getChannels(samples: RawSample[], productDir: string): string[] {
  const channelSet = new Set<string>();

  // Try to derive from channel subdirectories on disk
  const productPath = join(OUTPUT_DIR, productDir);
  const entries = readdirSync(productPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      channelSet.add(entry.name.toLowerCase());
    }
  }

  // Fallback: derive from sample metadata
  if (channelSet.size === 0) {
    for (const s of samples) {
      const ch = s.channel ?? s.category;
      if (ch) channelSet.add(ch.toLowerCase());
    }
  }

  return [...channelSet].sort();
}

function countWavFiles(dirPath: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
        count++;
      }
    }
  } catch {
    // Directory not readable — return 0
  }
  return count;
}

function buildIndex(): IndexData {
  if (!existsSync(OUTPUT_DIR)) {
    console.warn(`WARNING: output directory not found at ${OUTPUT_DIR} — generating empty index`);
    return { products: [] };
  }

  const products: ProductEntry[] = [];

  const dirs = readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const dir of dirs) {
    const metaPath = join(OUTPUT_DIR, dir, "metadata.json");
    const hasMeta = existsSync(metaPath);

    let rawSamples: RawSample[] = [];
    if (hasMeta) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as RawMetadata).samples)
        ) {
          rawSamples = (parsed as RawMetadata).samples;
        } else {
          const keys =
            typeof parsed === "object" && parsed !== null
              ? Object.keys(parsed as object)
              : typeof parsed;
          console.warn(
            `WARNING: ${metaPath} has unexpected shape (found: ${JSON.stringify(keys)}) — treating as missing`,
          );
        }
      } catch {
        console.warn(`WARNING: ${metaPath} is corrupt — treating as missing`);
      }
    }

    const channels = getChannels(rawSamples, dir);

    // Count .wav files from sub-directories when metadata is absent or yielded no samples
    let sampleCount = rawSamples.length;
    if (sampleCount === 0) {
      const productPath = join(OUTPUT_DIR, dir);
      const subDirs = readdirSync(productPath, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const sub of subDirs) {
        sampleCount += countWavFiles(join(productPath, sub.name));
      }
    }

    // Only include products with at least one channel
    if (channels.length === 0) continue;

    products.push({
      id: dir,
      name: deriveDisplayName(dir),
      channels,
      sampleCount,
    });
  }

  return { products };
}

// --- main ---
mkdirSync(DATA_DIR, { recursive: true });
const index = buildIndex();
writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
console.log(`data/index.json: ${index.products.length} products, ${index.products.reduce((s, p) => s + p.sampleCount, 0)} total samples`);
