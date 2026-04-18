#!/usr/bin/env tsx

/**
 * gen1-catalog.ts — Parse Gen 1 sample-ID → PXD-path catalogs.
 *
 * Gen 1 eJay products (Dance eJay 1, Dance SuperPack, Rave eJay, HipHop eJay 1
 * via GenerationPack1, plus the GP1 re-releases) store the authoritative
 * `uint16 sample_id → pxd_path` mapping in a plain-text `MAX` catalog file.
 * Line number (0-indexed) is the sample ID; the content is the relative PXD
 * path.  Two on-disk dialects exist:
 *
 *   * **Quoted** (Dance 1 / SuperPack / GP1-Dance): each line is
 *     `"subdir\filename.pxd"\r\n`. Empty entries appear as `""`.
 *   * **Unquoted** (Rave / GP1-Rave / GP1-HipHop): each line is a raw
 *     `subdir\filename.pxd\r\n` (no surrounding quotes).
 *
 * A companion `Pxddance` file (SuperPack / GP1-Dance only) provides 6-field
 * records — path, stereo flag, category, variant, group, version — for the
 * first 1352 IDs (the Dance eJay 1 base kit). Where available, this is used
 * to enrich each catalog entry with category/group metadata.
 *
 * Dance 1 additionally ships a `PXD.TXT` whose 18-line header encodes 9 pairs
 * of `(start_id, count)` giving per-channel ID ranges. We parse it to fall
 * back to category info when no Pxddance file is present.
 *
 * Usage:
 *   tsx scripts/gen1-catalog.ts --product Dance_SuperPack
 *   tsx scripts/gen1-catalog.ts --product Dance_eJay1 --out output/Dance_eJay1/gen1-catalog.json
 *   tsx scripts/gen1-catalog.ts --max path/to/MAX [--pxddance path/to/Pxddance]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { parseArgs } from "util";

// --- Types ---

export interface Gen1CatalogEntry {
  /** Sample ID (zero-based line number in the MAX file). */
  id: number;
  /** Normalised forward-slash, lower-case PXD path (e.g. "ba/aaaf.pxd"). */
  path: string;
  /** First path segment, upper-case (e.g. "BA", "DMKIT1"). Null when empty. */
  bank: string | null;
  /** Basename without extension, upper-case (e.g. "AAAF"). Null when empty. */
  file: string | null;
  /** Channel / category label (e.g. "loop", "drum"). Null when unknown. */
  category: string | null;
  /** Group label from Pxddance (e.g. "Grp. 1"). Null when unknown. */
  group: string | null;
  /** Version / alias label from Pxddance (e.g. "Vers1"). Null when unknown. */
  version: string | null;
}

export interface Gen1Catalog {
  /** Source product (e.g. "Dance_SuperPack"). May be null for ad-hoc runs. */
  product: string | null;
  /** Absolute path to the MAX file that was parsed. */
  maxPath: string;
  /** Absolute path to the Pxddance file, when one was used. */
  pxddancePath: string | null;
  /** Total number of sample IDs (including empty slots). */
  totalIds: number;
  /** Number of non-empty entries. */
  populatedIds: number;
  /** All entries, indexed by `id`. Empty slots are included with nulls. */
  entries: Gen1CatalogEntry[];
}

export interface PxddanceRecord {
  path: string;
  category: string;
  group: string;
  version: string;
}

/** 9 channel ranges parsed from Dance 1 PXD.TXT header. */
export interface PxdTxtChannelRanges {
  ranges: Array<{ startId: number; count: number; endId: number }>;
}

// --- Product layout ---

/**
 * Per-product paths to the Gen 1 catalog artefacts, relative to the workspace
 * `archive/` root. Only Gen 1 products are listed. SuperPack and GP1-Dance
 * share byte-identical MAX/Pxddance files; we still list them separately so
 * callers can target either copy.
 */
export const GEN1_PRODUCT_LAYOUT: Record<
  string,
  { max: string; pxddance?: string; pxdtxt?: string }
> = {
  Dance_eJay1: {
    max: "Dance_eJay1/dance/DMACHINE/MAX.TXT",
    pxdtxt: "Dance_eJay1/dance/DMACHINE/PXD.TXT",
  },
  Dance_SuperPack: {
    max: "Dance_SuperPack/dance/EJAY/MAX",
    pxddance: "Dance_SuperPack/dance/EJAY/Pxddance",
  },
  Rave: {
    max: "Rave/RAVE/EJAY/MAX",
  },
  GenerationPack1_Dance: {
    max: "GenerationPack1/Dance/dance/EJAY/MAX",
    pxddance: "GenerationPack1/Dance/dance/EJAY/Pxddance",
  },
  GenerationPack1_Rave: {
    max: "GenerationPack1/Rave/RAVE/EJAY/MAX",
  },
  GenerationPack1_HipHop: {
    max: "GenerationPack1/HipHop/HIPHOP/EJAY/MAX",
  },
};

// --- Parsers ---

/**
 * Split a catalog text file into its per-line entries, tolerating CRLF or LF
 * endings and stripping surrounding quotes when present. A trailing blank
 * line (from the final CRLF) is dropped so line N of the output corresponds
 * to sample ID N.
 */
export function splitCatalogLines(text: string): string[] {
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const lines = text.split(/\r\n|\n/);
  // Drop the trailing empty element produced by a terminating newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.map((line) => {
    // Quoted dialect: strip one layer of surrounding double quotes.
    if (line.length >= 2 && line.startsWith('"') && line.endsWith('"')) {
      return line.slice(1, -1);
    }
    return line;
  });
}

/**
 * Normalise a raw PXD path from a catalog. Returns `{ path, bank, file }`
 * where `path` uses forward slashes and lower-case, `bank` is the upper-case
 * first segment, and `file` is the upper-case basename without extension.
 * An empty input yields nulls in every field.
 */
export function normalisePxdPath(raw: string): {
  path: string;
  bank: string | null;
  file: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { path: "", bank: null, file: null };
  }
  const unified = trimmed.replace(/\\/g, "/").toLowerCase();
  const segments = unified.split("/");
  const bank = segments.length > 1 ? segments[0].toUpperCase() : null;
  const basename = segments[segments.length - 1];
  const dot = basename.lastIndexOf(".");
  const stem = dot >= 0 ? basename.slice(0, dot) : basename;
  const file = stem.toUpperCase() || null;
  return { path: unified, bank, file };
}

/**
 * Parse a MAX / MAX.TXT file. Returns the list of normalised PXD paths,
 * one per sample ID.
 */
export function parseMaxFile(text: string): string[] {
  return splitCatalogLines(text);
}

/**
 * Parse a Pxddance catalog. Each record is 6 consecutive lines:
 *
 *   "<subdir>\<file>.pxd"
 *   ""                      (stereo/reserved flag; blank for mono)
 *   "<category>"            (e.g. "loop", "drum")
 *   "<variant>"             (a single digit/string; role not yet confirmed)
 *   "<group>"               (e.g. "Grp. 1")
 *   "<version>"             (e.g. "Vers1")
 *
 * Records with an empty path are preserved with empty-string fields.
 */
export function parsePxddanceFile(text: string): PxddanceRecord[] {
  const lines = splitCatalogLines(text);
  const records: PxddanceRecord[] = [];
  for (let i = 0; i + 5 < lines.length; i += 6) {
    records.push({
      path: lines[i],
      category: lines[i + 2],
      group: lines[i + 4],
      version: lines[i + 5],
    });
  }
  return records;
}

/**
 * Parse the 18-line header of a Dance 1 PXD.TXT file into 9 channel ranges.
 * Each range is `(startId, count)` and the channels appear in the product's
 * native tab order (loop, drum, bass, guitar, sequence, voice, rap, effect,
 * xtra).
 */
export function parsePxdTxtChannelRanges(text: string): PxdTxtChannelRanges {
  const lines = splitCatalogLines(text);
  const ranges: PxdTxtChannelRanges["ranges"] = [];
  for (let i = 0; i < 18 && i + 1 < lines.length; i += 2) {
    const startId = Number.parseInt(lines[i], 10);
    const count = Number.parseInt(lines[i + 1], 10);
    if (Number.isNaN(startId) || Number.isNaN(count)) {
      break;
    }
    ranges.push({ startId, count, endId: startId + count - 1 });
  }
  return { ranges };
}

/**
 * Dance eJay 1 channel tab order, matching the 9 pairs in PXD.TXT.
 * Used only as a fallback when no Pxddance file is available.
 */
export const DANCE1_CHANNEL_ORDER = [
  "loop",
  "drum",
  "bass",
  "guitar",
  "sequence",
  "voice",
  "rap",
  "effect",
  "xtra",
] as const;

/**
 * Resolve a sample ID to a category label using the Dance 1 PXD.TXT channel
 * ranges. Returns null when no range contains the ID.
 */
export function categoryFromPxdTxt(
  id: number,
  ranges: PxdTxtChannelRanges,
): string | null {
  for (let i = 0; i < ranges.ranges.length; i += 1) {
    const r = ranges.ranges[i];
    if (id >= r.startId && id <= r.endId) {
      return DANCE1_CHANNEL_ORDER[i] ?? null;
    }
  }
  return null;
}

// --- Builder ---

export interface BuildCatalogOptions {
  /** Text content of the MAX / MAX.TXT catalog. Required. */
  maxText: string;
  /** Text content of the Pxddance catalog, when available. */
  pxddanceText?: string;
  /** Text content of the Dance 1 PXD.TXT, when available. */
  pxdtxtText?: string;
  /** Product key (e.g. "Dance_SuperPack") for the output record. */
  product?: string;
  /** Absolute path of the MAX file (for the output record). */
  maxPath: string;
  /** Absolute path of the Pxddance file (for the output record). */
  pxddancePath?: string | null;
}

/**
 * Build a `Gen1Catalog` from already-read catalog contents. Pure function —
 * does no I/O so it is cheap to test.
 */
export function buildGen1Catalog(opts: BuildCatalogOptions): Gen1Catalog {
  const paths = parseMaxFile(opts.maxText);
  const pxddance = opts.pxddanceText
    ? parsePxddanceFile(opts.pxddanceText)
    : [];
  const channelRanges = opts.pxdtxtText
    ? parsePxdTxtChannelRanges(opts.pxdtxtText)
    : null;

  // Build a path→Pxddance lookup so enrichment is O(1) per entry. Paths in
  // Pxddance are already in the canonical quoted-catalog form but we
  // normalise both sides to guarantee a match.
  const pxdByPath = new Map<string, PxddanceRecord>();
  for (const rec of pxddance) {
    const key = normalisePxdPath(rec.path).path;
    if (key !== "") {
      pxdByPath.set(key, rec);
    }
  }

  const entries: Gen1CatalogEntry[] = [];
  let populated = 0;
  for (let id = 0; id < paths.length; id += 1) {
    const { path, bank, file } = normalisePxdPath(paths[id]);
    if (path !== "") {
      populated += 1;
    }
    const enrich = pxdByPath.get(path);
    const category =
      enrich?.category ||
      (channelRanges ? categoryFromPxdTxt(id, channelRanges) : null) ||
      null;
    entries.push({
      id,
      path,
      bank,
      file,
      category,
      group: enrich?.group || null,
      version: enrich?.version || null,
    });
  }

  return {
    product: opts.product ?? null,
    maxPath: opts.maxPath,
    pxddancePath: opts.pxddancePath ?? null,
    totalIds: entries.length,
    populatedIds: populated,
    entries,
  };
}

// --- CLI ---

export interface CliOptions {
  product?: string;
  maxPath?: string;
  pxddancePath?: string;
  pxdtxtPath?: string;
  outPath?: string;
  archiveRoot: string;
  outputRoot: string;
}

/**
 * Resolve the concrete MAX / Pxddance / PXD.TXT paths for a given product
 * key, using `GEN1_PRODUCT_LAYOUT` relative to the archive root.
 */
export function resolveProductPaths(
  product: string,
  archiveRoot: string,
): { maxPath: string; pxddancePath: string | null; pxdtxtPath: string | null } {
  const layout = GEN1_PRODUCT_LAYOUT[product];
  if (!layout) {
    throw new Error(
      `Unknown Gen 1 product "${product}". Known: ${Object.keys(GEN1_PRODUCT_LAYOUT).join(", ")}`,
    );
  }
  return {
    maxPath: resolve(archiveRoot, layout.max),
    pxddancePath: layout.pxddance ? resolve(archiveRoot, layout.pxddance) : null,
    pxdtxtPath: layout.pxdtxt ? resolve(archiveRoot, layout.pxdtxt) : null,
  };
}

export function runCli(opts: CliOptions): Gen1Catalog {
  let maxPath: string;
  let pxddancePath: string | null;
  let pxdtxtPath: string | null;

  if (opts.maxPath) {
    maxPath = resolve(opts.maxPath);
    pxddancePath = opts.pxddancePath ? resolve(opts.pxddancePath) : null;
    pxdtxtPath = opts.pxdtxtPath ? resolve(opts.pxdtxtPath) : null;
  } else if (opts.product) {
    const resolved = resolveProductPaths(opts.product, opts.archiveRoot);
    maxPath = resolved.maxPath;
    pxddancePath = resolved.pxddancePath;
    pxdtxtPath = resolved.pxdtxtPath;
  } else {
    throw new Error("runCli: either `product` or `maxPath` is required");
  }

  if (!existsSync(maxPath)) {
    throw new Error(`MAX catalog not found: ${maxPath}`);
  }

  const maxText = readFileSync(maxPath, "utf8");
  const pxddanceText =
    pxddancePath && existsSync(pxddancePath)
      ? readFileSync(pxddancePath, "utf8")
      : undefined;
  const pxdtxtText =
    pxdtxtPath && existsSync(pxdtxtPath)
      ? readFileSync(pxdtxtPath, "utf8")
      : undefined;

  const catalog = buildGen1Catalog({
    maxText,
    pxddanceText,
    pxdtxtText,
    product: opts.product,
    maxPath,
    pxddancePath,
  });

  const outPath =
    opts.outPath ??
    (opts.product
      ? join(opts.outputRoot, opts.product, "gen1-catalog.json")
      : null);

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  }

  return catalog;
}

// --- Entry point ---

/* v8 ignore start */
function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      product: { type: "string" },
      max: { type: "string" },
      pxddance: { type: "string" },
      pxdtxt: { type: "string" },
      out: { type: "string" },
      "archive-root": { type: "string" },
      "output-root": { type: "string" },
    },
  });
  return {
    product: values.product as string | undefined,
    maxPath: values.max as string | undefined,
    pxddancePath: values.pxddance as string | undefined,
    pxdtxtPath: values.pxdtxt as string | undefined,
    outPath: values.out as string | undefined,
    archiveRoot: resolve((values["archive-root"] as string) ?? "archive"),
    outputRoot: resolve((values["output-root"] as string) ?? "output"),
  };
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("gen1-catalog.ts");

if (isMain) {
  const opts = parseCli(process.argv.slice(2));
  if (opts.product) {
    const cat = runCli(opts);
    const dest =
      opts.outPath ?? join(opts.outputRoot, opts.product, "gen1-catalog.json");
    process.stdout.write(
      `${opts.product}: ${cat.populatedIds}/${cat.totalIds} IDs populated → ${dest}\n`,
    );
  } else if (opts.maxPath) {
    const cat = runCli(opts);
    process.stdout.write(
      `${cat.maxPath}: ${cat.populatedIds}/${cat.totalIds} IDs populated\n`,
    );
  } else {
    // Build every known Gen 1 product.
    for (const product of Object.keys(GEN1_PRODUCT_LAYOUT)) {
      const layout = GEN1_PRODUCT_LAYOUT[product];
      const maxPath = resolve(opts.archiveRoot, layout.max);
      if (!existsSync(maxPath)) {
        process.stdout.write(`${product}: MAX not found (${maxPath}) — skipped\n`);
        continue;
      }
      const cat = runCli({ ...opts, product });
      const dest = join(opts.outputRoot, product, "gen1-catalog.json");
      process.stdout.write(
        `${product}: ${cat.populatedIds}/${cat.totalIds} IDs populated → ${dest}\n`,
      );
    }
  }
}
/* v8 ignore stop */
