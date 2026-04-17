#!/usr/bin/env tsx

/**
 * normalize.ts — Flatten all extracted eJay samples into a single category tree.
 *
 * Reads every `output/<product>/metadata.json` and produces
 * `output/_normalized/<Category>[/<Subcategory>]/<filename>.wav` plus a
 * consolidated metadata.json. Copies by default so the per-product tree stays
 * intact; pass `--move` to relocate files instead.
 *
 * Usage:
 *   tsx tools/normalize.ts
 *   tsx tools/normalize.ts --dry-run
 *   tsx tools/normalize.ts --output-root output --dest output/_normalized --move
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join, normalize as pathNormalize } from "path";
import { parseArgs } from "util";

import { collectMetadata, getChannel } from "./reorganize.js";

// ── Final taxonomy ───────────────────────────────────────────

export const FINAL_CATEGORIES = [
  "Loop",
  "Drum",
  "Bass",
  "Guitar",
  "Keys",
  "Sequence",
  "Voice",
  "Effect",
  "Scratch",
  "Orchestral",
  "Pads",
  "Extra",
  "Unsorted",
] as const;

export const DRUM_SUBS = ["kick", "snare", "clap", "toms", "crash", "hi-hats", "perc"] as const;

export const VOICE_SUBS = [
  "rap male",
  "rap female",
  "sing male",
  "sing female",
  "robot",
  "misc",
] as const;

// Prefixes that getChannel() maps to "Drum" but that are actually drum beat
// loops in Dance eJay 1/2. Detected by direct-prefix match against the
// internal name; Dance eJay 4 filenames like `DAMA001` go through DA_RE first
// and never reach this test.
const DRUM_LOOP_NAME_RE = /^(DA|DB|DC|DD|DE|DF)\d/i;

// Keywords that promote any sample to Orchestral regardless of the coarse
// channel assignment. Checked against alias + category + internal_name.
const ORCHESTRAL_KEYWORDS = [
  "orchestr", "symphon", "philharmonic", "pizzicato",
  "violin", "viola", "cello", "contrabass", "strings", "string ",
  "flute", "clarinet", "oboe", "bassoon", "piccolo", "woodwind",
  "sax", "saxophone",
  "brass", "trumpet", "trombone", "horn", "tuba", "fanfare",
  "choir", "chorale",
];

// Drum subcategory detection. Order matters — earlier patterns win.
const DRUM_SUB_PATTERNS: Array<[RegExp, typeof DRUM_SUBS[number]]> = [
  [/\b(kick|bd|bassdrum|bass[\s_-]?drum)\b/, "kick"],
  [/\b(clap|clp)\b/, "clap"],
  [/\b(snare|sd|rim|rimshot)\b/, "snare"],
  [/\b(hat|hh|hi[\s_-]?hat|openhat|closedhat|closed[\s_-]?hat|open[\s_-]?hat)\b/, "hi-hats"],
  [/\btom/, "toms"],
  [/\b(crash|ride|cymbal|splash|china)\b/, "crash"],
  [/\b(conga|bongo|shaker|tamb|cowbell|clave|triangle|block|perc)/, "perc"],
];

// ── Types ────────────────────────────────────────────────────

export interface NormalizedSample {
  filename: string;
  category: typeof FINAL_CATEGORIES[number];
  subcategory: string | null;
  product: string;
  source_archive?: string;
  internal_name?: string;
  alias?: string;
  original_filename: string;
  original_category?: string;
  [key: string]: unknown;
}

interface RawSample {
  filename?: string;
  internal_name?: string;
  source?: string;
  source_archive?: string;
  alias?: string;
  category?: string;
  [key: string]: unknown;
}

// ── Classification helpers ───────────────────────────────────

function textBlob(sample: RawSample): string {
  return [sample.alias, sample.category, sample.internal_name]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

export function isOrchestral(sample: RawSample): boolean {
  const text = textBlob(sample);
  if (!text) return false;
  return ORCHESTRAL_KEYWORDS.some((kw) => text.includes(kw));
}

export function classifyDrumSub(sample: RawSample): typeof DRUM_SUBS[number] {
  const text = textBlob(sample);
  for (const [re, sub] of DRUM_SUB_PATTERNS) {
    if (re.test(text)) return sub;
  }
  return "perc";
}

export function classifyVoiceSub(
  sample: RawSample,
  channelHint: "male" | "female" | "rap" | null,
): typeof VOICE_SUBS[number] {
  const text = textBlob(sample);

  if (/\b(robot|vocoder|talkbox|talk[\s_-]?box|cyber)\b/.test(text)) {
    return "robot";
  }

  let gender: "male" | "female" | null = null;
  if (/\b(female|fem|woman|girl|lady|ladies)\b/.test(text)) gender = "female";
  else if (/\b(male|man|guy|boy|fella|fellas)\b/.test(text)) gender = "male";
  if (!gender && (channelHint === "male" || channelHint === "female")) gender = channelHint;

  let style: "rap" | "sing" | null = null;
  if (/\b(rap|mc|spit|flow|rhyme)\b/.test(text)) style = "rap";
  else if (/\b(sing|sung|vocal|vox|melody|hook|chorus|shout|chant)/.test(text)) style = "sing";
  if (!style && channelHint === "rap") style = "rap";

  if (style && gender) return `${style} ${gender}` as typeof VOICE_SUBS[number];
  return "misc";
}

/** Result of category mapping: primary category + optional subcategory. */
export interface Classification {
  category: typeof FINAL_CATEGORIES[number];
  subcategory: string | null;
}

export function classify(sample: RawSample, productName: string): Classification {
  const internalName = sample.internal_name
    ?? (sample.source ? basename(sample.source, extname(sample.source)) : "");
  const category = sample.category ?? "";

  // 1. Orchestral keyword wins over the coarse channel assignment.
  if (isOrchestral(sample)) {
    return { category: "Orchestral", subcategory: null };
  }

  const channel = getChannel(internalName, category, productName);

  // 2. Drum beat-loop override: DA–DF direct prefixes go to Loop, not Drum.
  if (channel === "Drum" && DRUM_LOOP_NAME_RE.test(internalName)) {
    return { category: "Loop", subcategory: null };
  }

  switch (channel) {
    case "Drum":
      return { category: "Drum", subcategory: classifyDrumSub(sample) };
    case "Bass":
      return { category: "Bass", subcategory: null };
    case "Guitar":
      return { category: "Guitar", subcategory: null };
    case "Keys":
    case "Seq":
      return { category: "Keys", subcategory: null };
    case "Loop":
    case "Groove":
      return { category: "Loop", subcategory: null };
    case "Layer":
    case "Sphere":
    case "Wave":
      return { category: "Pads", subcategory: null };
    case "Voice":
      return { category: "Voice", subcategory: classifyVoiceSub(sample, null) };
    case "Rap":
      return { category: "Voice", subcategory: classifyVoiceSub(sample, "rap") };
    case "Ladies":
      return { category: "Voice", subcategory: classifyVoiceSub(sample, "female") };
    case "Fellas":
      return { category: "Voice", subcategory: classifyVoiceSub(sample, "male") };
    case "Effect":
      return { category: "Effect", subcategory: null };
    case "Scratch":
      return { category: "Scratch", subcategory: null };
    case "Xtra":
      return { category: "Extra", subcategory: null };
    /* v8 ignore next 2 — getChannel() never returns anything outside the cases above */
    default:
      return { category: "Unsorted", subcategory: null };
  }
}

// ── Destination naming ───────────────────────────────────────

function splitPathParts(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}

export function chooseFlatFilename(
  destDir: string,
  originalFilename: string,
  product: string,
  taken: Set<string>,
): string {
  const base = basename(originalFilename);
  const ext = extname(base);
  const stem = basename(base, ext);

  const candidates: string[] = [
    base,
    `${product}__${stem}${ext}`,
  ];
  for (let i = 2; i < 200; i++) {
    candidates.push(`${product}__${stem} (${i})${ext}`);
  }

  for (const candidate of candidates) {
    const full = join(destDir, candidate);
    if (taken.has(full)) continue;
    if (existsSync(full)) {
      taken.add(full);
      continue;
    }
    taken.add(full);
    return candidate;
  }
  throw new Error(
    `chooseFlatFilename: all ${candidates.length} candidate names for "${base}" in ${destDir} are taken`,
  );
}

// ── Main pipeline ────────────────────────────────────────────

export interface NormalizeOptions {
  outputRoot: string;
  dest: string;
  move?: boolean;
  dryRun?: boolean;
}

export interface NormalizeResult {
  processed: number;
  skipped: number;
  perCategory: Record<string, number>;
  samples: NormalizedSample[];
}

/**
 * List product directories under outputRoot. A product dir is any direct
 * child that contains a metadata.json file.
 */
export function listProductDirs(outputRoot: string): string[] {
  if (!existsSync(outputRoot)) return [];
  const dirs: string[] = [];
  for (const entry of readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue; // skip _normalized, _unsorted, etc.
    const metaPath = join(outputRoot, entry.name, "metadata.json");
    if (existsSync(metaPath)) dirs.push(join(outputRoot, entry.name));
  }
  return dirs;
}

function subcategoryPath(category: string, subcategory: string | null): string {
  return subcategory ? join(category, subcategory) : category;
}

/** Pre-create the full category tree so the layout is stable even if empty. */
export function scaffoldTree(dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const cat of FINAL_CATEGORIES) {
    if (cat === "Drum") {
      for (const sub of DRUM_SUBS) mkdirSync(join(dest, cat, sub), { recursive: true });
    } else if (cat === "Voice") {
      for (const sub of VOICE_SUBS) mkdirSync(join(dest, cat, sub), { recursive: true });
    } else {
      mkdirSync(join(dest, cat), { recursive: true });
    }
  }
}

export function normalize(options: NormalizeOptions): NormalizeResult {
  const { outputRoot, dest, move = false, dryRun = false } = options;

  const productDirs = listProductDirs(outputRoot);
  const perCategory: Record<string, number> = {};
  const samples: NormalizedSample[] = [];
  const taken = new Set<string>();
  let processed = 0;
  let skipped = 0;

  if (!dryRun) scaffoldTree(dest);

  for (const productDir of productDirs) {
    const product = basename(pathNormalize(productDir));
    const records = collectMetadata(productDir);

    for (const [sourceDir, sample] of records) {
      const filename = typeof sample.filename === "string" ? sample.filename : "";
      if (!filename) {
        skipped++;
        continue;
      }

      const srcPath = join(sourceDir, ...splitPathParts(filename));
      if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
        skipped++;
        continue;
      }

      const { category, subcategory } = classify(sample, product);
      const destSubdir = join(dest, subcategoryPath(category, subcategory));
      if (!dryRun) mkdirSync(destSubdir, { recursive: true });

      const chosen = chooseFlatFilename(destSubdir, filename, product, taken);
      const destPath = join(destSubdir, chosen);

      if (!dryRun) {
        if (move) renameSync(srcPath, destPath);
        else copyFileSync(srcPath, destPath);
      }

      const key = subcategory ? `${category}/${subcategory}` : category;
      perCategory[key] = (perCategory[key] ?? 0) + 1;

      const record: NormalizedSample = {
        ...sample,
        filename: chosen,
        category,
        subcategory,
        product,
        original_filename: filename,
        original_category: typeof sample.category === "string" ? sample.category : undefined,
      };
      samples.push(record);
      processed++;
    }
  }

  if (!dryRun) {
    const payload = {
      generated_at: new Date().toISOString(),
      total_samples: samples.length,
      per_category: perCategory,
      samples,
    };
    writeFileSync(join(dest, "metadata.json"), JSON.stringify(payload, null, 2), "utf-8");
  }

  return { processed, skipped, perCategory, samples };
}

// ── CLI ──────────────────────────────────────────────────────

/* v8 ignore start */
function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "output-root": { type: "string", default: "output" },
      dest: { type: "string", default: "output/_normalized" },
      move: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  const result = normalize({
    outputRoot: values["output-root"] as string,
    dest: values.dest as string,
    move: values.move as boolean,
    dryRun: values["dry-run"] as boolean,
  });

  const prefix = values["dry-run"] ? "[DRY RUN] " : "";
  console.log(`${prefix}${result.processed} samples processed, ${result.skipped} skipped`);
  const entries = Object.entries(result.perCategory).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, count] of entries) {
    console.log(`  ${key.padEnd(24)} ${count}`);
  }
}

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("normalize.ts") || process.argv[1].endsWith("normalize.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
