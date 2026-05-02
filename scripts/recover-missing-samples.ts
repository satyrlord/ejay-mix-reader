#!/usr/bin/env tsx

/**
 * recover-missing-samples.ts — Full pipeline for auditing and recovering missing samples.
 *
 * Steps:
 *   1. Delete any existing report at --report path.
 *   2. Scan every .mix file in --archive against output/metadata.json and write a
 *      fresh missing-beats report (same logic as gen-missing-beats-report.ts).
 *   3. Scan output/ and --external for the listed WAV files, copy found samples
 *      into the correct output/ category folder, and append new entries to
 *      output/metadata.json.
 *
 * Usage:
 *   tsx scripts/recover-missing-samples.ts [options]
 *
 * Options:
 *   --dry-run            Print what would be done without copying files or writing JSON.
 *   --archive <path>     Archive dir to scan for .mix files (default: archive/).
 *   --report <path>      Report file path (default: logs/missing-beats-report.json).
 *   --metadata <path>    Sample metadata path (default: output/metadata.json).
 *   --external <paths>   Comma-separated list of external sample library roots
 *                        (default: "F:\_samples\eJay,F:\_samples\Magix").
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, relative, resolve } from "path";
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
import { readWavInfo } from "./wav-decode.js";
import { applyDpcm, decodePxdFile, SAMPLE_RATE } from "./pxd-parser.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ARCHIVE_DIR = join(ROOT, "archive");
const DEFAULT_REPORT_PATH = join(ROOT, "logs", "missing-beats-report.json");
const DEFAULT_METADATA_PATH = join(ROOT, "output", "metadata.json");
const DEFAULT_EXTERNAL_PATH = "F:\\_samples\\eJay,F:\\_samples\\Magix";

const OUTPUT_DIR = join(ROOT, "output");

// Map relative paths from archive/ root to canonical product IDs.
// Longest-match wins — more specific entries must come first.
const PATH_PRODUCT_HINTS: Array<[string, string]> = [
  ["Dance_SuperPack/eJay SampleKit/DMKIT1/", "Dance_SuperPack"],
  ["Dance_SuperPack/eJay SampleKit/DMKIT2/", "Dance_SuperPack"],
  ["Dance SuperPack/eJay SampleKit/DMKIT1/", "Dance_SuperPack"],
  ["Dance SuperPack/eJay SampleKit/DMKIT2/", "Dance_SuperPack"],
  ["Dance_SuperPack/", "Dance_SuperPack"],
  ["Dance SuperPack/", "Dance_SuperPack"],
  ["Dance_eJay1/", "Dance_eJay1"],
  ["Dance eJay 1/", "Dance_eJay1"],
  ["Dance_eJay2/", "Dance_eJay2"],
  ["Dance eJay 2/", "Dance_eJay2"],
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
  ["GenerationPack1/Dance/", "GenerationPack1_Dance"],
  ["GenerationPack1/HipHop/", "GenerationPack1_HipHop"],
  ["GenerationPack1/Rave/", "GenerationPack1_Rave"],
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

/**
 * Basenames (lowercase) of known eJay application resource sounds that are
 * embedded in .mix reference lists but are not music samples and should never
 * appear in the missing-beats report.
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

/** Source path patterns that identify utility / app-resource sounds. */
const UTILITY_SOURCE_PATTERNS: RegExp[] = [
  /^counter\//i,               // beat-counter samples: counter/01 classic.wav etc.
  /[/\\]eJay[/\\]eJay[/\\]/i,  // app-internal resource path: ejay/eJay/...
  /^eJay[/\\]eJay[/\\]/i,      // same, at path root
  /^D_ejay\d[/\\]ejay[/\\]/i,  // Dance eJay 2/3 resource path prefix
];


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

export interface MetaSample {
  filename: string;
  source: string;
  bank?: string;
  alias?: string | null;
  format?: string;
  channel?: string;
  bpm?: number | null;
  category: string;
  subcategory: string | null;
  product: string;
  original_filename: string;
  original_category: string | null;
  duration_sec?: number;
  beats?: number | null;
  decoded_size?: number;
  sample_rate?: number;
  bit_depth?: number;
  channels?: number;
  detail?: string | null;
  internal_name?: string | null;
}

export interface MetadataJson {
  generated_at: string;
  total_samples: number;
  per_category: Record<string, number>;
  samples: MetaSample[];
}

// ---------------------------------------------------------------------------
// Constants — recovery category maps
// ---------------------------------------------------------------------------

// eJay channel name → output category folder name
const CHANNEL_TO_OUTPUT: Record<string, string> = {
  Drum: "Drum",
  Bass: "Bass",
  Guitar: "Guitar",
  Loop: "Loop",
  Layer: "Pads",
  Seq: "Sequence",
  Rap: "Voice",
  Voice: "Voice",
  Effect: "Effect",
  Xtra: "Extra",
  Keys: "Keys",
  Scratch: "Scratch",
  Wave: "Unsorted",
};

// Source sub-directory name → output category (case-insensitive lookup keys)
const SOURCE_DIR_CATEGORY: Record<string, string> = {
  bass: "Bass",
  drum: "Drum",
  drums: "Drum",
  guitar: "Guitar",
  guitars: "Guitar",
  keys: "Keys",
  keyboards: "Keys",
  piano: "Keys",
  organ: "Keys",
  lead: "Keys",
  leads: "Keys",
  synth: "Keys",
  synths: "Keys",
  pad: "Pads",
  pads: "Pads",
  strings: "Pads",
  string: "Pads",
  atmospheres: "Pads",
  fx: "Effect",
  effect: "Effect",
  effects: "Effect",
  voice: "Voice",
  voices: "Voice",
  vocal: "Voice",
  vocals: "Voice",
  rap: "Voice",
  vox: "Voice",
  scratch: "Scratch",
  loop: "Loop",
  loops: "Loop",
  beat: "Loop",
  beats: "Loop",
  sequence: "Sequence",
  seq: "Sequence",
  orchestral: "Orchestral",
  orchestra: "Orchestral",
};

// Filename prefix → eJay channel (inlined from reorganize.ts CHANNEL_MAP)
const CHANNEL_MAP: Record<string, string> = {
  // Drum machine hits
  MA: "Drum", MB: "Drum", MC: "Drum", MD: "Drum", ME: "Drum", MF: "Drum", MG: "Drum",
  // Drum beat loops
  DA: "Drum", DB: "Drum", DC: "Drum", DD: "Drum", DE: "Drum", DF: "Drum",
  // HipHop 2 drum hits
  GA: "Drum", GB: "Drum", GC: "Drum", GCA: "Drum", GDA: "Drum", GDB: "Drum",
  GDC: "Drum", GDD: "Drum", GDE: "Drum",
  // Gen 3 drum variants
  GD: "Drum", GE: "Drum", GF: "Drum", GS: "Drum", GH: "Drum", GP: "Drum",
  // Bass
  BS: "Bass",
  // Guitar / riffs
  GT: "Guitar",
  // Audio loops
  LA: "Loop", LC: "Loop", HS: "Loop", BT: "Loop",
  // Layered / atmospheric pads
  LY: "Layer", SR: "Layer",
  // Sequenced melodies
  SQ: "Seq", HA: "Seq", HB: "Seq", HM: "Seq", HX: "Seq",
  // Rap vocals
  RP: "Rap", ZZ: "Rap", RM: "Rap", RN: "Rap", VX: "Rap",
  // Vocals
  VA: "Voice", VB: "Voice", VC: "Voice", VF: "Voice", VM: "Voice",
  // Sound effects
  FX: "Effect",
  // Saxophone / extra
  SX: "Xtra",
  // Keys / melodic instruments
  PN: "Keys", ON: "Keys", SY: "Keys", KY: "Seq",
  // Scratch loops
  ST: "Scratch", SC: "Scratch", RX: "Scratch", SRC: "Scratch",
  // Wave
  EY: "Wave",
  // Techno eJay keyword prefixes
  BASS: "Bass", KICK: "Drum", SNARE: "Drum", HIHAT: "Drum", CLAP: "Drum",
  PERC: "Drum", SYNTH: "Keys", ROBOT: "Xtra",
  // Extra / misc
  EX: "Xtra",
};

// Keywords from INF category field → eJay channel (inlined from reorganize.ts CATEGORY_HINTS)
const CATEGORY_HINTS: Array<[string, string]> = [
  ["drum loop", "Drum"], ["drum", "Drum"], ["kick", "Drum"], ["snare", "Drum"],
  ["hihat", "Drum"], ["hi-hat", "Drum"], ["hihats", "Drum"], ["clap", "Drum"],
  ["cymbal", "Drum"], ["perc", "Drum"],
  ["bass", "Bass"],
  ["guitar", "Guitar"],
  ["scratch", "Scratch"],
  ["loop", "Loop"],
  ["piano", "Keys"], ["organ", "Keys"], ["synth", "Keys"], ["chord", "Keys"],
  ["melody", "Keys"], ["arp", "Keys"], ["keys", "Keys"],
  ["string", "Layer"], ["pad", "Layer"],
  ["fx", "Effect"], ["effect", "Effect"],
  ["rap", "Rap"],
  ["vox", "Voice"], ["voice", "Voice"], ["vocal", "Voice"],
  ["seq", "Seq"],
];

// Prefix key order: longest first so longer prefixes take precedence
const CHANNEL_MAP_KEYS = Object.keys(CHANNEL_MAP).sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// Helpers — report generation
// ---------------------------------------------------------------------------

/** Returns true if ids describes a non-musical eJay application resource. */
export function isUtilitySample(ids: { filename: string; source: string }): boolean {
  const base = ids.filename.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (UTILITY_FILENAMES.has(base)) return true;
  for (const pat of UTILITY_SOURCE_PATTERNS) {
    if (pat.test(ids.source)) return true;
  }
  return false;
}

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

  // Format A fallback: preserve the real Gen 1 catalog path/stem so recovery
  // can search external libraries by the actual sample name.
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
// Helpers — recovery
// ---------------------------------------------------------------------------

/**
 * Strip extension, separators (space/underscore/dash/dot), and zero-pad any
 * trailing numeric suffix so "cowbellhigh 7" and "cowbellhigh07" collide.
 */
export function normalizeBasename(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[\s_\-.]+/g, "")
    .replace(/(\d+)/g, (n) => n.padStart(2, "0"));
}

function normalizeIndexedStem(name: string): string | null {
  const base = basename(name).toLowerCase();
  const match = /^(.+?)[._ -](\d{1,3})$/.exec(base);
  if (!match) return null;
  return `${normalizeBasename(match[1])}${match[2].padStart(2, "0")}`;
}

function buildLookupKeys(entry: ReportEntry, outName: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined): void => {
    const key = value?.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  const addValue = (value: string): void => {
    const base = basename(value);
    add(base);
    add(normalizeBasename(base));
    add(normalizeIndexedStem(base));
  };

  addValue(entry.source);
  addValue(outName);
  if (entry.internal_name) add(normalizeIndexedStem(entry.internal_name));

  return keys;
}

function findIndexedFile(index: Map<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const match = index.get(key);
    if (match) return match;
  }
  return undefined;
}

/**
 * Recursively index all .wav files under dir.
 * Adds entries as `lowercase_basename → absolute_path` (first found wins),
 * plus a secondary `normalizeBasename(...)` key for fuzzy matching.
 */
export function buildFileIndex(dir: string, index: Map<string, string>): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      buildFileIndex(full, index);
    } else if (/\.wav$/i.test(entry)) {
      const key = entry.toLowerCase();
      if (!index.has(key)) {
        index.set(key, full);
      }
      const norm = normalizeBasename(entry);
      if (norm && !index.has(norm)) {
        index.set(norm, full);
      }
    }
  }
}

interface ArchiveAudioIndex {
  bySuffix: Map<string, string>;
  byBasename: Map<string, string>;
  filesIndexed: number;
}

function normalizeArchivePath(pathValue: string): string {
  return pathValue
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function buildArchiveAudioIndex(archiveDir: string): ArchiveAudioIndex {
  const bySuffix = new Map<string, string>();
  const byBasename = new Map<string, string>();
  let filesIndexed = 0;

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(full);
        continue;
      }

      if (!st.isFile() || !/\.(pxd|wav)$/i.test(entry)) {
        continue;
      }

      const rel = normalizeArchivePath(relative(archiveDir, full));
      if (!rel) continue;

      const parts = rel.split("/").filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const suffix = parts.slice(i).join("/");
        if (!bySuffix.has(suffix)) {
          bySuffix.set(suffix, full);
        }
      }

      const base = parts[parts.length - 1];
      if (base && !byBasename.has(base)) {
        byBasename.set(base, full);
      }

      filesIndexed++;
    }
  };

  if (existsSync(archiveDir)) {
    walk(archiveDir);
  }

  return { bySuffix, byBasename, filesIndexed };
}

function resolveArchiveSourcePath(entry: ReportEntry, index: ArchiveAudioIndex): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined): void => {
    if (!value) return;
    const normalized = normalizeArchivePath(value.trim());
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  add(entry.source);

  const sourceExt = extname(entry.source).toLowerCase();
  if (!sourceExt) {
    add(`${entry.source}.pxd`);
    add(`${entry.source}.wav`);
  }

  add(basename(entry.source));
  add(basename(entry.filename));

  for (const candidate of candidates) {
    const bySuffix = index.bySuffix.get(candidate);
    if (bySuffix) return bySuffix;

    const byBasename = index.byBasename.get(basename(candidate));
    if (byBasename) return byBasename;
  }

  return null;
}

function buildWavBuffer(
  pcmData: Buffer,
  sampleRate = SAMPLE_RATE,
  numChannels = 1,
  sampleWidth = 2,
): Buffer {
  const dataSize = pcmData.length;
  const byteRate = sampleRate * numChannels * sampleWidth;
  const blockAlign = numChannels * sampleWidth;
  const bitsPerSample = sampleWidth * 8;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function recoverFromArchiveSource(
  entry: ReportEntry,
  index: ArchiveAudioIndex,
  warn: (message: string) => void,
): { sourcePath: string; wavData: Buffer } | null {
  const sourcePath = resolveArchiveSourcePath(entry, index);
  if (!sourcePath) return null;

  let srcData: Buffer;
  try {
    srcData = readFileSync(sourcePath);
  } catch (err) {
    warn(`  WARN: Could not read archive source ${sourcePath}: ${(err as Error).message}`);
    return null;
  }

  if (/\.wav$/i.test(sourcePath) || srcData.subarray(0, 4).toString("ascii") === "RIFF") {
    return { sourcePath, wavData: srcData };
  }

  const decoded = decodePxdFile(srcData);
  if (!decoded) return null;

  const pcm16 = applyDpcm(decoded.pcm);
  return {
    sourcePath,
    wavData: buildWavBuffer(pcm16, SAMPLE_RATE, 1, 2),
  };
}

/** Infer the output category folder name for a report entry. */
export function inferCategory(entry: ReportEntry, resolvedPath?: string): string {
  // 1. Use the entry's category field via CATEGORY_HINTS
  if (entry.category) {
    const lc = entry.category.toLowerCase();
    for (const [hint, channel] of CATEGORY_HINTS) {
      if (lc.includes(hint)) {
        return CHANNEL_TO_OUTPUT[channel] ?? "Unsorted";
      }
    }
    if (SOURCE_DIR_CATEGORY[lc]) return SOURCE_DIR_CATEGORY[lc];
  }

  // 2. Inspect the resolved file path's parent directories — vendor library
  //    layouts like ".../_original/HipHop_eJay3/Drum/kick-08.wav" carry the
  //    category in a path segment.
  if (resolvedPath) {
    const rparts = resolvedPath.replace(/\\/g, "/").split("/");
    for (let i = rparts.length - 2; i >= 0; i--) {
      const part = rparts[i].toLowerCase();
      if (SOURCE_DIR_CATEGORY[part]) return SOURCE_DIR_CATEGORY[part];
    }
  }

  // 3. Inspect source path directory components for category clues
  const parts = entry.source.replace(/\\/g, "/").split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i].toLowerCase();
    if (SOURCE_DIR_CATEGORY[part]) return SOURCE_DIR_CATEGORY[part];
  }

  // 4. Try CHANNEL_MAP on the output filename prefix (uppercase, no extension)
  const nameUpper = basename(entry.filename).toUpperCase().replace(/\.[^.]+$/, "");
  for (const key of CHANNEL_MAP_KEYS) {
    if (nameUpper.startsWith(key)) {
      const channel = CHANNEL_MAP[key];
      return CHANNEL_TO_OUTPUT[channel] ?? "Unsorted";
    }
  }

  return "Unsorted";
}

/** Extract BPM encoded in a path segment like "Drum&Bass_160bpm" or "HipHop_90bpm". */
export function bpmFromPath(path: string): number | null {
  const m = path.match(/[_\-/\\]?(\d{2,3})bpm/i);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v >= 40 && v <= 300 ? v : null;
}

/** Round duration × bpm/60 to the nearest standard loop beat count. */
export function computeBeats(duration: number, bpm: number): number | null {
  if (duration <= 0 || bpm <= 0) return null;
  const raw = (duration * bpm) / 60;
  const standard = [1, 2, 4, 8, 16, 32, 64];
  for (const s of standard) {
    if (Math.abs(raw - s) / s < 0.05) return s;
  }
  // Accept non-standard values that are whole numbers in a reasonable range
  const rounded = Math.round(raw);
  return rounded >= 1 && rounded <= 64 ? rounded : null;
}

/** Canonical output filename: strip any path prefix embedded in entry.filename. */
export function getOutputFilename(entry: ReportEntry): string {
  return basename(entry.filename);
}

function reportIdentityKey(entry: Pick<ReportEntry, "product" | "source">): string {
  return `${entry.product}::${entry.source.trim().toLowerCase()}`;
}

function sampleIdentityKey(sample: Pick<MetaSample, "product" | "source">): string | null {
  const product = sample.product?.trim();
  const source = sample.source?.trim().toLowerCase();
  if (!product || !source) return null;
  return `${product}::${source}`;
}

function outputLocationKey(category: string, subcategory: string | null | undefined, filename: string): string {
  const base = basename(filename).toLowerCase();
  const categoryKey = category.toLowerCase();
  const subcategoryKey = subcategory?.trim().toLowerCase();
  return subcategoryKey ? `${categoryKey}/${subcategoryKey}/${base}` : `${categoryKey}/${base}`;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
export interface RunRecoveryOptions {
  dryRun?: boolean;
  archiveDir?: string;
  reportPath?: string;
  metadataPath?: string;
  externalPath?: string;
  outputDir?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface RunRecoveryDeps {
  parseMixFn?: typeof parseMix;
  buildResolverIndexFn?: typeof buildResolverIndex;
  resolveMixFn?: typeof resolveMix;
  canonicalizeProductFn?: typeof canonicalizeProduct;
  readWavInfoFn?: typeof readWavInfo;
}

export interface RecoveryRunResult {
  dryRun: boolean;
  archiveDir: string;
  reportPath: string;
  metadataPath: string;
  externalPath: string;
  outputDir: string;
  deletedExistingReport: boolean;
  indexedSamples: number;
  mixFileCount: number;
  parsedOk: number;
  parseFailed: number;
  totalRefs: number;
  resolvedCount: number;
  unresolvedCount: number;
  generatedReport: MissingBeatsReport;
  outputIndexSize: number;
  externalRoots: string[];
  externalIndexSizes: Array<{ root: string; added: number; total: number }>;
  alreadyKnown: number;
  found: number;
  notFound: number;
  copied: number;
  newEntries: MetaSample[];
  notFoundList: string[];
}

export function runRecovery(
  options: RunRecoveryOptions = {},
  deps: RunRecoveryDeps = {},
): RecoveryRunResult {
  const dryRun = options.dryRun ?? false;
  const archiveDir = resolve(options.archiveDir ?? DEFAULT_ARCHIVE_DIR);
  const reportPath = resolve(options.reportPath ?? DEFAULT_REPORT_PATH);
  const metadataPath = resolve(options.metadataPath ?? DEFAULT_METADATA_PATH);
  const externalPath = options.externalPath ?? DEFAULT_EXTERNAL_PATH;
  const outputDir = resolve(options.outputDir ?? OUTPUT_DIR);
  const log = options.log ?? (() => undefined);
  const warn = options.warn ?? (() => undefined);
  const parseMixFn = deps.parseMixFn ?? parseMix;
  const buildResolverIndexFn = deps.buildResolverIndexFn ?? buildResolverIndex;
  const resolveMixFn = deps.resolveMixFn ?? resolveMix;
  const canonicalizeProductFn = deps.canonicalizeProductFn ?? canonicalizeProduct;
  const readWavInfoFn = deps.readWavInfoFn ?? readWavInfo;

  if (dryRun) log("[DRY RUN] No files will be copied or JSON modified.\n");

  const deletedExistingReport = existsSync(reportPath);
  if (deletedExistingReport) {
    if (!dryRun) {
      rmSync(reportPath);
      log(`Deleted existing report: ${reportPath}`);
    } else {
      log(`[DRY RUN] Would delete existing report: ${reportPath}`);
    }
  }

  log("\n--- Phase 2: Generate missing-beats report ---");
  log(`Loading metadata from ${metadataPath} ...`);
  const metaJson: MetadataJson = JSON.parse(readFileSync(metadataPath, "utf8"));
  log(`  ${metaJson.samples.length} samples indexed`);

  const resolverIndex = buildResolverIndexFn({
    metadata: metaJson as unknown as NormalizedMetadata,
    outputRoot: outputDir,
    archiveRoot: archiveDir,
  });

  log(`\nScanning .mix files under ${archiveDir} ...`);
  const mixFiles = findMixFiles(archiveDir);
  log(`  ${mixFiles.length} .mix files found`);

  const seen = new Set<string>();
  const reportEntries: ReportEntry[] = [];
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

    const mixReport = resolveMixFn(ir, resolverIndex);
    totalRefs += mixReport.total;
    resolvedCount += mixReport.resolved;
    unresolvedCount += mixReport.unresolved;

    const product = canonicalizeProductFn(ir.product);
    const gen1Catalogs = (resolverIndex as { gen1?: Map<string, { entries: Gen1CatalogEntry[] }> }).gen1;
    for (const track of mixReport.tracks) {
      if (track.sampleRef.resolvedPath !== null) continue;

      const gen1Entry = gen1EntryForRef(product, track.sampleRef, gen1Catalogs);
      const ids = refIdentifiers(track.sampleRef, gen1Entry);
      if (isUtilitySample(ids)) continue;
      if (track.sampleRef.rawId === 0 && !track.sampleRef.internalName && !track.sampleRef.displayName) continue;

      const key = dedupKey(product, ids);
      if (seen.has(key)) continue;
      seen.add(key);

      reportEntries.push({
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

  const generatedReport: MissingBeatsReport = {
    generated_at: new Date().toISOString(),
    total_missing_beats: reportEntries.length,
    per_product: [...perProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([product, missing_beats]) => ({ product, missing_beats })),
    samples: reportEntries.sort((a, b) => {
      const pc = a.product.localeCompare(b.product);
      return pc !== 0 ? pc : a.filename.localeCompare(b.filename);
    }),
  };

  if (!dryRun) {
    const reportDir = dirname(reportPath);
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify(generatedReport, null, 2) + "\n", "utf8");
    log(`\nWrote ${reportPath} (${generatedReport.total_missing_beats} unique missing samples)`);
  } else {
    log(`\n[DRY RUN] Would write ${reportPath} with ${generatedReport.total_missing_beats} entries`);
  }

  log(`\n  .mix files parsed:  ${parsedOk}`);
  log(`  .mix files skipped: ${parseFailed}`);
  log(`  Total refs:         ${totalRefs}  (resolved: ${resolvedCount}, unresolved: ${unresolvedCount})`);
  log(`  Unique missing:     ${generatedReport.total_missing_beats}`);
  log("\n  Per product:");
  for (const { product, missing_beats } of generatedReport.per_product) {
    log(`    ${product.padEnd(28)} ${missing_beats}`);
  }

  log("\n--- Phase 3: Recover missing samples ---");

  const knownSampleKeys = new Set<string>();
  const knownOutputLocations = new Set<string>();
  for (const sample of metaJson.samples) {
    const identityKey = sampleIdentityKey(sample);
    if (identityKey) knownSampleKeys.add(identityKey);
    knownOutputLocations.add(outputLocationKey(sample.category, sample.subcategory, sample.filename));
  }

  log("Scanning output/ ...");
  const outputIndex = new Map<string, string>();
  buildFileIndex(outputDir, outputIndex);
  log(`  ${outputIndex.size} WAV files indexed in output/`);

  const externalRoots = externalPath
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const externalIndex = new Map<string, string>();
  const externalIndexSizes: Array<{ root: string; added: number; total: number }> = [];
  for (const root of externalRoots) {
    log(`Scanning ${root} ...`);
    const before = externalIndex.size;
    buildFileIndex(root, externalIndex);
    const added = externalIndex.size - before;
    externalIndexSizes.push({ root, added, total: externalIndex.size });
    log(`  ${added} WAV files indexed (total: ${externalIndex.size})`);
  }

  log("Scanning archive sources (.pxd/.wav) ...");
  const archiveAudioIndex = buildArchiveAudioIndex(archiveDir);
  log(`  ${archiveAudioIndex.filesIndexed} source files indexed in archive/`);

  let alreadyKnown = 0;
  let found = 0;
  let notFound = 0;
  let copied = 0;
  const newEntries: MetaSample[] = [];
  const notFoundList: string[] = [];

  for (const entry of generatedReport.samples) {
    const outName = getOutputFilename(entry);
    const identityKey = reportIdentityKey(entry);

    if (knownSampleKeys.has(identityKey)) {
      alreadyKnown++;
      continue;
    }

    const lookupKeys = buildLookupKeys(entry, outName);
    let sourcePath =
      findIndexedFile(outputIndex, lookupKeys) ??
      findIndexedFile(externalIndex, lookupKeys);

    const archiveFallback = !sourcePath
      ? recoverFromArchiveSource(entry, archiveAudioIndex, warn)
      : null;
    if (!sourcePath && archiveFallback) {
      sourcePath = archiveFallback.sourcePath;
    }

    if (!sourcePath) {
      notFound++;
      notFoundList.push(`${entry.product}: ${entry.filename}`);
      continue;
    }

    found++;
    const category = inferCategory(entry, sourcePath);
    const destDir = join(outputDir, category);
    const destPath = join(destDir, outName);
    const outputKey = outputLocationKey(category, null, outName);

    if (knownOutputLocations.has(outputKey)) {
      alreadyKnown++;
      continue;
    }

    let wavInfo = null;
    try {
      const buf = archiveFallback?.wavData ?? readFileSync(sourcePath);
      wavInfo = readWavInfoFn(buf);
    } catch (e) {
      warn(`  WARN: Could not read WAV header for ${sourcePath}: ${(e as Error).message}`);
    }

    const bpm = bpmFromPath(entry.source) ?? bpmFromPath(entry.filename) ?? null;
    const beats = wavInfo && bpm ? computeBeats(wavInfo.duration, bpm) : null;
    const srcParts = entry.source.replace(/\\/g, "/").split("/");
    const bank = entry.product === "eJay_Studio" && srcParts.length >= 2 ? srcParts[0] : undefined;

    const newEntry: MetaSample = {
      filename: outName,
      source: entry.source,
      ...(bank !== undefined ? { bank } : {}),
      alias: entry.alias ?? null,
      format: entry.format ?? "wav",
      category,
      subcategory: null,
      product: entry.product,
      original_filename: outName,
      original_category: entry.category,
      ...(wavInfo !== null
        ? {
            duration_sec: Math.round(wavInfo.duration * 10000) / 10000,
            decoded_size: wavInfo.dataSize,
            sample_rate: wavInfo.sampleRate,
            bit_depth: wavInfo.bitDepth,
            channels: wavInfo.channels,
          }
        : {}),
      bpm,
      beats,
      ...(entry.detail ? { detail: entry.detail } : {}),
      ...(entry.internal_name ? { internal_name: entry.internal_name } : {}),
    };

    const needsCopy = !existsSync(destPath) && sourcePath !== destPath;
    if (!dryRun) {
      if (needsCopy) {
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        if (archiveFallback) {
          writeFileSync(destPath, archiveFallback.wavData);
        } else {
          copyFileSync(sourcePath, destPath);
        }
        copied++;
      }
      newEntries.push(newEntry);
    } else {
      if (needsCopy) {
        if (archiveFallback) {
          log(`  [DRY RUN] Would decode/copy: ${sourcePath}`);
        } else {
          log(`  [DRY RUN] Would copy: ${sourcePath}`);
        }
        log(`             → ${destPath}`);
        copied++;
      } else {
        log(`  [DRY RUN] Found (no copy needed): ${sourcePath} → ${category}`);
      }
      newEntries.push(newEntry);
    }

    knownSampleKeys.add(identityKey);
    knownOutputLocations.add(outputKey);
  }

  if (!dryRun && newEntries.length > 0) {
    metaJson.samples.push(...newEntries);
    metaJson.total_samples = metaJson.samples.length;

    const perCat: Record<string, number> = {};
    for (const s of metaJson.samples) {
      const key = s.subcategory ? `${s.category}/${s.subcategory}` : s.category;
      perCat[key] = (perCat[key] ?? 0) + 1;
    }
    metaJson.per_category = perCat;
    metaJson.generated_at = new Date().toISOString();

    writeFileSync(metadataPath, JSON.stringify(metaJson, null, 2) + "\n", "utf8");
    log(`\nUpdated ${metadataPath} with ${newEntries.length} new entries.`);
  } else if (dryRun && newEntries.length > 0) {
    log(`\n[DRY RUN] Would add ${newEntries.length} new metadata entries.`);
  }

  log("\n=== Recovery Summary ===");
  log(`  Already in metadata:  ${alreadyKnown}`);
  log(`  Found & processed:    ${found}`);
  log(`  Files copied/linked:  ${copied}`);
  log(`  Not found anywhere:   ${notFound}`);

  if (notFoundList.length > 0) {
    const showCount = Math.min(notFoundList.length, 30);
    log(`\nNot found (showing ${showCount} of ${notFoundList.length}):`);
    for (const n of notFoundList.slice(0, showCount)) {
      log(`  - ${n}`);
    }
  }

  return {
    dryRun,
    archiveDir,
    reportPath,
    metadataPath,
    externalPath,
    outputDir,
    deletedExistingReport,
    indexedSamples: metaJson.samples.length - newEntries.length,
    mixFileCount: mixFiles.length,
    parsedOk,
    parseFailed,
    totalRefs,
    resolvedCount,
    unresolvedCount,
    generatedReport,
    outputIndexSize: outputIndex.size,
    externalRoots,
    externalIndexSizes,
    alreadyKnown,
    found,
    notFound,
    copied,
    newEntries,
    notFoundList,
  };
}

export function main(args: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      archive: { type: "string", default: DEFAULT_ARCHIVE_DIR },
      report: { type: "string", default: DEFAULT_REPORT_PATH },
      metadata: { type: "string", default: DEFAULT_METADATA_PATH },
      external: { type: "string", default: DEFAULT_EXTERNAL_PATH },
    },
  });

  runRecovery({
    dryRun: Boolean(values["dry-run"]),
    archiveDir: String(values["archive"]),
    reportPath: String(values["report"]),
    metadataPath: String(values["metadata"]),
    externalPath: String(values["external"]),
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });
  return 0;
}

/* istanbul ignore next -- CLI entry point */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}

