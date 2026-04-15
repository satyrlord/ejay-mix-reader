#!/usr/bin/env tsx

/**
 * reorganize.ts — Reorganize extracted eJay samples into channel-based folder structure.
 *
 * Reads metadata.json files produced by pxd-parser.ts and moves WAV files into
 * per-channel subfolders based on the internal filename prefix.
 *
 * Usage:
 *   tsx tools/reorganize.ts output/Dance_eJay2
 *   tsx tools/reorganize.ts output/Dance_eJay2 --dry-run
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, extname, join, normalize, relative } from "path";
import { parseArgs } from "util";

// Maps the type code embedded in internal filenames to eJay channel tabs.
export const CHANNEL_MAP: Record<string, string> = {
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
  // Rap
  RP: "Rap", ZZ: "Rap", RM: "Rap", RN: "Rap", VX: "Rap",
  // Vocals
  VA: "Voice", VB: "Voice", VC: "Voice", VF: "Voice", VM: "Voice",
  // Sound effects
  FX: "Effect",
  // Saxophone
  SX: "Xtra",
  // Keys / melodic instruments
  PN: "Keys", ON: "Keys", SY: "Keys", KY: "Seq",
  // Scratch loops
  ST: "Scratch", RX: "Scratch", SRC: "Scratch",
  // Wave
  EY: "Wave",
  // Techno eJay HYP stem names
  BASS: "Bass", KICK: "Drum", SNARE: "Drum", HIHAT: "Drum", CLAP: "Drum",
  PERC: "Drum", SYNTH: "Keys", ROBOT: "Xtra",
  // Extra / misc
  EX: "Xtra",
};

// Keywords in the INF category field → channel. Used as fallback.
export const CATEGORY_HINTS: Array<[string, string]> = [
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

// Regex patterns for internal name parsing
const D5_RE = /^[A-Z]\d([A-Z]+)\d+/i;    // Dance eJay 2: D<digit><CODE><seq>
const DA_RE = /^DA([A-Z]{2})/i;            // Dance eJay 4: DA<2-letter-code>
const X_RE = /^X[A-Z]([A-Z]{2})X[A-Z]/i;  // Xtreme eJay: X<pack><2-letter-code>X<pack>
const HS_RE = /^HS\d[A-F]([A-Z]{2,})\d/i; // House eJay: HS<digit><pack><CODE><seq>
const HH4_RE = /^HIPHOP_([A-Z]+)\d/i;     // HipHop 4: HIPHOP_<CODE><seq>
const PFX_RE = /^([A-Z]+)\d+/i;           // Direct prefix: letters before first digit

// HipHop 4 channel map
export const HH4_CHANNEL_MAP: Record<string, string> = {
  LOOP: "Loop", DRUMA: "Drum", DRUMB: "Drum", DRUMC: "Drum", DRUMD: "Drum", DRUME: "Drum",
  GA: "Drum", GB: "Drum", GC: "Drum", GD: "Drum", GE: "Drum", GF: "Drum",
  BASS: "Bass", SYNTH: "Keys", PIANO: "Keys", ORGAN: "Keys",
  GUITAR: "Guitar", FEMALE: "Ladies", MALE: "Fellas", FX: "Effect",
  EXTRA: "Xtra", SCRATCH: "Scratch",
};

// Product-specific prefix overrides
export const PRODUCT_PREFIX_OVERRIDES: Record<string, Array<[string, string]>> = {
  techno_ejay3: [["SRC", "Sphere"]],
};

/**
 * Return the eJay channel folder for a sample, or 'Xtra' if unknown.
 */
export function getChannel(internalName: string, category = "", productName = ""): string {
  const name = internalName.toUpperCase();
  const product = productName.toLowerCase();

  // Product-specific prefix overrides
  const overrides = PRODUCT_PREFIX_OVERRIDES[product] ?? [];
  for (const [prefix, channel] of overrides) {
    if (name.startsWith(prefix)) return channel;
  }

  // 1. HipHop 4
  let m = HH4_RE.exec(name);
  if (m) return HH4_CHANNEL_MAP[m[1].toUpperCase()] ?? "Xtra";

  // 2. House eJay
  m = HS_RE.exec(name);
  if (m) {
    const code = m[1].toUpperCase();
    if (code === "EX") return "Groove";
    return CHANNEL_MAP[code] ?? "Xtra";
  }

  // 3. Dance eJay 2
  m = D5_RE.exec(name);
  if (m) return CHANNEL_MAP[m[1]] ?? "Xtra";

  // 4. Dance eJay 4
  m = DA_RE.exec(name);
  if (m) return CHANNEL_MAP[m[1].toUpperCase()] ?? "Xtra";

  // 5. Xtreme eJay
  m = X_RE.exec(name);
  if (m) return CHANNEL_MAP[m[1].toUpperCase()] ?? "Xtra";

  // 6. Direct prefix — longest match
  m = PFX_RE.exec(name);
  if (m) {
    const code = m[1];
    for (let length = code.length; length > 0; length--) {
      const sub = code.slice(0, length);
      if (sub in CHANNEL_MAP) return CHANNEL_MAP[sub];
    }
  }

  // 7. Category-keyword fallback
  if (category) {
    const cat = category.toLowerCase();
    for (const [hint, channel] of CATEGORY_HINTS) {
      if (cat.includes(hint)) return channel;
    }
  }

  return "Xtra";
}

interface SampleRecord {
  filename: string;
  internal_name?: string;
  source?: string;
  source_archive?: string;
  category?: string;
  channel?: string;
  [key: string]: unknown;
}

interface MetadataFile {
  samples: SampleRecord[];
  [key: string]: unknown;
}

interface DestinationChoice {
  filename: string;
  fullPath: string;
  hadConflict: boolean;
}

function splitPathParts(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}

function chooseDestination(
  productDir: string,
  channel: string,
  originalFilename: string,
  sourceArchive: string,
  srcPath: string,
): DestinationChoice {
  const destDir = join(productDir, channel);
  const sourceBase = basename(originalFilename);
  const ext = extname(sourceBase);
  const stem = basename(sourceBase, ext);

  const candidates: string[] = [sourceBase, `${sourceArchive} ${stem}${ext}`];
  let fallback = 2;
  while (candidates.length < 200) {
    candidates.push(`${sourceArchive} ${stem} (${fallback})${ext}`);
    fallback++;
  }

  let chosen: string | undefined;
  let hadConflict = false;

  for (const candidate of candidates) {
    const targetPath = join(destDir, candidate);
    if (!existsSync(targetPath) || normalize(targetPath) === normalize(srcPath)) {
      chosen = candidate;
      break;
    }
    hadConflict = true;
  }

  if (chosen === undefined) {
    throw new Error(
      `chooseDestination: all ${candidates.length} candidate names for "${sourceBase}" in ${destDir} are taken`,
    );
  }

  return {
    filename: chosen,
    fullPath: join(destDir, chosen),
    hadConflict,
  };
}

/**
 * Walk productDir for metadata.json files and return a flat list of
 * (sourceSubdir, sampleRecord) tuples.
 */
export function collectMetadata(productDir: string): Array<[string, SampleRecord]> {
  const records: Array<[string, SampleRecord]> = [];

  function walk(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name === "metadata.json") {
          try {
            const data: MetadataFile = JSON.parse(readFileSync(fullPath, "utf-8"));
            for (const sample of data.samples ?? []) {
              records.push([dir, sample]);
            }
          } catch {
            // skip corrupt metadata
          }
        }
      }
    } catch {
      return;
    }
  }

  walk(productDir);
  return records;
}

/**
 * Move WAV files into channel-based subfolders within productDir.
 */
export function reorganize(productDir: string, dryRun = false): void {
  const records = collectMetadata(productDir);
  if (records.length === 0) {
    console.log(`No metadata.json found under ${productDir}`);
    return;
  }

  const rootMetaPath = join(productDir, "metadata.json");
  let preservedTopLevel: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(rootMetaPath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      preservedTopLevel = { ...(parsed as Record<string, unknown>) };
      delete preservedTopLevel.samples;
    }
  } catch {
    preservedTopLevel = {};
  }

  const productName = basename(normalize(productDir));

  let moved = 0;
  let skipped = 0;
  let conflicts = 0;
  const mergedSamples: SampleRecord[] = [];

  for (const [sourceDir, sample] of records) {
    const filename = sample.filename ?? "";
    if (!filename) {
      skipped++;
      continue;
    }

    const srcPath = join(sourceDir, ...splitPathParts(filename));
    if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
      skipped++;
      continue;
    }

    let internalName = sample.internal_name ?? "";
    if (!internalName) {
      const source = sample.source ?? "";
      if (source) {
        internalName = basename(source, extname(source));
      }
    }
    const category = sample.category ?? "";
    const channel = getChannel(internalName, category, productName);

    const archive = sample.source_archive ?? basename(sourceDir);
    const choice = chooseDestination(productDir, channel, filename, archive, srcPath);
    const destFilename = choice.filename;
    const destPath = choice.fullPath;
    if (choice.hadConflict) conflicts++;

    const updatedSample: SampleRecord = { ...sample };
    updatedSample.filename = destFilename;
    updatedSample.channel = channel;
    mergedSamples.push(updatedSample);

    if (dryRun) {
      console.log(`  ${channel.padEnd(8)}  ${relative(productDir, srcPath)}  →  ${channel}/${destFilename}`);
      moved++;
      continue;
    }

    mkdirSync(join(productDir, channel), { recursive: true });
    renameSync(srcPath, destPath);
    moved++;
  }

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}${moved} samples ${dryRun ? "would be " : ""}moved, ` +
    `${conflicts} collision(s) renamed, ${skipped} skipped (missing files)`,
  );

  if (!dryRun) {
    const mergedPath = join(productDir, "metadata.json");
    if (mergedSamples.length === 0) {
      try {
        if (existsSync(mergedPath) && statSync(mergedPath).isFile()) {
          unlinkSync(mergedPath);
        }
      } catch {
        // keep the original move result even if cleanup fails
      }
      console.log(`No valid samples found — not writing ${mergedPath}`);
      return;
    }

    const mergedPayload: Record<string, unknown> = {
      ...preservedTopLevel,
      samples: mergedSamples,
    };
    if ("total_samples" in mergedPayload) {
      mergedPayload.total_samples = mergedSamples.length;
    }

    writeFileSync(
      mergedPath,
      JSON.stringify(mergedPayload, null, 2),
      "utf-8",
    );
    console.log(`Wrote merged metadata.json (${mergedSamples.length} samples) → ${mergedPath}`);
  }
}

// --- CLI ---

/* v8 ignore start */
function main(): void {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length === 0) {
    console.error("Usage: tsx tools/reorganize.ts <product_dir> [--dry-run]");
    process.exit(1);
  }

  const productDir = positionals[0];
  if (!existsSync(productDir) || !statSync(productDir).isDirectory()) {
    console.error(`Directory not found: ${productDir}`);
    process.exit(1);
  }

  reorganize(productDir, values["dry-run"]);
}

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("reorganize.ts") || process.argv[1].endsWith("reorganize.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
