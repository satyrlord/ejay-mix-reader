#!/usr/bin/env tsx

/**
 * mix-grid-analyzer.ts — Analyse Format A (Gen 1) `.mix` files.
 *
 * Format A structure (empirically verified on Dance 1, Rave, HipHop 1,
 * Dance SuperPack and GenerationPack 1 Dance/Rave/HipHop):
 *
 *   Offset  Size  Field
 *   ------  ----  -----
 *   0x00    2     App signature (uint16 LE):
 *                   0x0A06 = Dance 1 / SuperPack / GP1 Dance
 *                   0x0A07 = Rave / GP1 Rave
 *                   0x0A08 = HipHop 1 / GP1 HipHop
 *   0x02    2     Aux header field (uint16 LE). Zero in most files,
 *                 non-zero in a minority (e.g. FREAK, X_Perm, TRANCE).
 *                 Semantics unresolved — likely a checksum or sub-
 *                 variant marker. Surfaced as `headerAux` for follow-up.
 *   0x04    N     Grid data: uint16 LE sample IDs, row width 16 bytes
 *                 (8 columns × uint16 per row). `0x0000` = empty cell.
 *   ...     Z     Zero padding (≥ 32 bytes) separating grid from trailer.
 *   ...     M     Optional trailer: short structured block containing
 *                 an ASCII product signature ("Dance eJay 1.01",
 *                 "DanceMachine Sample-Kit Vol. 2", ...) or an imported
 *                 WAV path (Rave NODRUGS.MIX), followed by a constant
 *                 byte sequence ending with `01 00 02`.
 *
 * Cell width is uint16 LE across every Gen 1 product. The earlier
 * hypothesis that Rave/HipHop used a byte-wide grid was caused by ASCII
 * trailer bytes (e.g. "ve" = 0x6576) being misread as grid cells; once
 * the trailer is excluded the remaining grid fits comfortably in the
 * 14-bit ID space of the MAX catalogs.
 *
 * Usage:
 *   tsx tools/mix-grid-analyzer.ts --file PATH
 *   tsx tools/mix-grid-analyzer.ts --dir archive/Rave/MIX
 *   tsx tools/mix-grid-analyzer.ts --all [--out output/<product>/mix-grid.json]
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { parseArgs } from "util";

// --- Constants ---

export const FORMAT_A_HEADER_BYTES = 4;
export const FORMAT_A_ROW_BYTES = 16;
export const FORMAT_A_CELL_BYTES = 2;
export const FORMAT_A_COLS = FORMAT_A_ROW_BYTES / FORMAT_A_CELL_BYTES; // 8
export const TRAILER_ZERO_RUN_THRESHOLD = 32;

export const APP_ID_DANCE = 0x0a06;
export const APP_ID_RAVE = 0x0a07;
export const APP_ID_HIPHOP = 0x0a08;

export type FormatAProduct = "dance" | "rave" | "hiphop";

/**
 * Map the 16-bit app signature at offset 0x00 to a product label.
 *
 * Only the low 16 bits of offset 0 are used. The high 16 bits (offset
 * 0x02–0x03) vary per file and are treated as an opaque aux field for
 * now — likely a checksum or sub-variant marker. See the `headerAux`
 * field on `FormatAAnalysis` for the raw value.
 */
export function productFromAppId(appId: number): FormatAProduct | null {
  const sig = appId & 0xffff;
  if (sig === APP_ID_DANCE) return "dance";
  if (sig === APP_ID_RAVE) return "rave";
  if (sig === APP_ID_HIPHOP) return "hiphop";
  return null;
}

// --- Types ---

export interface GridCell {
  readonly row: number;
  readonly col: number;
  readonly offset: number;
  readonly id: number;
}

export interface FormatATrailer {
  readonly start: number;
  readonly end: number; // inclusive
  readonly length: number;
  readonly hex: string;
  readonly ascii: string;
  readonly strings: readonly string[];
}

export interface FormatAAnalysis {
  readonly isFormatA: boolean;
  readonly appId: number;           // uint16 LE at 0x00
  readonly headerAux: number;       // uint16 LE at 0x02 (opaque per-file field)
  readonly product: FormatAProduct | null;
  readonly fileSize: number;
  readonly gridStart: number;
  readonly gridEnd: number;         // inclusive offset of last grid byte; -1 if empty grid
  readonly activeRowCount: number;  // ceil((gridEnd + 1 - gridStart) / FORMAT_A_ROW_BYTES)
  readonly cellCount: number;
  readonly uniqueIdCount: number;
  readonly maxId: number;
  readonly minId: number;
  readonly idHistogram: ReadonlyMap<number, number>;
  readonly cells: readonly GridCell[];
  readonly trailer: FormatATrailer | null;
}

// --- Pure helpers ---

/**
 * Returns the last non-zero byte offset, or -1 if the buffer is entirely zero.
 */
export function findLastNonZero(buf: Buffer): number {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] !== 0) return i;
  }
  return -1;
}

/**
 * Locate the `grid end` / `trailer start` boundary.
 *
 * Scans **forward** from the header and returns the first zero run whose
 * length is at least `threshold` bytes. The grid is treated as the data
 * before that run; everything after (up to and including the final
 * non-zero byte) is the trailer.
 *
 * A forward scan is used because some Format A files contain multiple
 * non-zero blocks after the main grid (e.g. HipHop 1 `.mix` embeds a
 * `"HipHop"` marker at ~0x2bd0 plus a structured tail at ~0x317a). The
 * musical grid is consistently the first block; the rest is metadata.
 *
 * Returns `gridEnd = lastNonZero` / `trailerStart = lastNonZero + 1`
 * when no qualifying gap is present (no trailer, e.g. Dance 1 mixes).
 */
export function locateGridAndTrailer(
  buf: Buffer,
  headerBytes: number = FORMAT_A_HEADER_BYTES,
  threshold: number = TRAILER_ZERO_RUN_THRESHOLD,
): { gridEnd: number; trailerStart: number } {
  const lastNonZero = findLastNonZero(buf);
  if (lastNonZero < headerBytes) {
    return { gridEnd: lastNonZero, trailerStart: lastNonZero + 1 };
  }

  let gridEnd = -1;
  let zeroRun = 0;
  let runStart = -1;
  for (let i = headerBytes; i <= lastNonZero; i++) {
    if (buf[i] === 0) {
      if (zeroRun === 0) runStart = i;
      zeroRun++;
      continue;
    }
    if (zeroRun >= threshold && gridEnd === -1) {
      gridEnd = runStart - 1;
      return { gridEnd, trailerStart: i };
    }
    zeroRun = 0;
    runStart = -1;
  }

  // No zero run ≥ threshold encountered → no trailer.
  return { gridEnd: lastNonZero, trailerStart: lastNonZero + 1 };
}

/**
 * Extract printable-ASCII substrings of length ≥ `minLength` from a buffer.
 */
export function extractAsciiStrings(buf: Buffer, minLength: number = 4): string[] {
  const out: string[] = [];
  let current = "";
  for (const b of buf) {
    if (b >= 0x20 && b < 0x7f) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= minLength) out.push(current);
      current = "";
    }
  }
  if (current.length >= minLength) out.push(current);
  return out;
}

function toHex(buf: Buffer): string {
  const parts: string[] = [];
  for (const b of buf) parts.push(b.toString(16).padStart(2, "0"));
  return parts.join(" ");
}

function toAsciiSafe(buf: Buffer): string {
  let out = "";
  for (const b of buf) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  return out;
}

/**
 * Parse the Format A grid and trailer. Returns `{ isFormatA: false, ... }`
 * (with defaulted fields) when the app identifier does not match any
 * known Gen 1 product or the file is smaller than a header.
 */
export function analyzeFormatA(buf: Buffer): FormatAAnalysis {
  const fileSize = buf.length;
  if (fileSize < FORMAT_A_HEADER_BYTES) {
    return {
      isFormatA: false,
      appId: 0,
      headerAux: 0,
      product: null,
      fileSize,
      gridStart: FORMAT_A_HEADER_BYTES,
      gridEnd: -1,
      activeRowCount: 0,
      cellCount: 0,
      uniqueIdCount: 0,
      maxId: 0,
      minId: 0,
      idHistogram: new Map(),
      cells: [],
      trailer: null,
    };
  }

  const appId = buf.readUInt16LE(0);
  const headerAux = buf.readUInt16LE(2);
  const product = productFromAppId(appId);
  const isFormatA = product !== null;

  const { gridEnd, trailerStart } = locateGridAndTrailer(buf);
  const gridStart = FORMAT_A_HEADER_BYTES;

  // Extract cells (only up to the aligned pair-boundary at or below gridEnd).
  const cells: GridCell[] = [];
  const histogram = new Map<number, number>();
  let maxId = 0;
  let minId = Number.POSITIVE_INFINITY;
  const cellUpperBound = gridEnd >= gridStart
    ? gridEnd + 1 - ((gridEnd + 1 - gridStart) % FORMAT_A_CELL_BYTES)
    : gridStart;
  for (let off = gridStart; off + FORMAT_A_CELL_BYTES <= cellUpperBound; off += FORMAT_A_CELL_BYTES) {
    const id = buf.readUInt16LE(off);
    if (id === 0) continue;
    const localOffset = off - gridStart;
    const row = Math.floor(localOffset / FORMAT_A_ROW_BYTES);
    const col = (localOffset % FORMAT_A_ROW_BYTES) / FORMAT_A_CELL_BYTES;
    cells.push({ row, col, offset: off, id });
    histogram.set(id, (histogram.get(id) ?? 0) + 1);
    if (id > maxId) maxId = id;
    if (id < minId) minId = id;
  }

  const activeGridBytes = gridEnd >= gridStart ? gridEnd + 1 - gridStart : 0;
  const activeRowCount = Math.ceil(activeGridBytes / FORMAT_A_ROW_BYTES);

  // Build trailer record if one exists.
  let trailer: FormatATrailer | null = null;
  const lastNonZero = findLastNonZero(buf);
  if (trailerStart <= lastNonZero && trailerStart > gridEnd + 1) {
    const slice = buf.subarray(trailerStart, lastNonZero + 1);
    trailer = {
      start: trailerStart,
      end: lastNonZero,
      length: slice.length,
      hex: toHex(slice),
      ascii: toAsciiSafe(slice),
      strings: extractAsciiStrings(slice, 4),
    };
  }

  return {
    isFormatA,
    appId,
    headerAux,
    product,
    fileSize,
    gridStart,
    gridEnd,
    activeRowCount,
    cellCount: cells.length,
    uniqueIdCount: histogram.size,
    maxId: cells.length > 0 ? maxId : 0,
    minId: cells.length > 0 ? minId : 0,
    idHistogram: histogram,
    cells,
    trailer,
  };
}

// --- File / directory helpers ---

export function analyzeFile(filePath: string): FormatAAnalysis {
  const buf = readFileSync(filePath);
  return analyzeFormatA(buf);
}

export interface MixFileSummary {
  readonly path: string;
  readonly fileSize: number;
  readonly appId: string;
  readonly headerAux: number;
  readonly product: FormatAProduct | null;
  readonly gridEnd: number;
  readonly activeRowCount: number;
  readonly cellCount: number;
  readonly uniqueIdCount: number;
  readonly maxId: number;
  readonly trailerLength: number;
  readonly trailerStrings: readonly string[];
}

export function summarise(filePath: string, analysis: FormatAAnalysis): MixFileSummary {
  return {
    path: filePath,
    fileSize: analysis.fileSize,
    appId: "0x" + analysis.appId.toString(16).padStart(4, "0"),
    headerAux: analysis.headerAux,
    product: analysis.product,
    gridEnd: analysis.gridEnd,
    activeRowCount: analysis.activeRowCount,
    cellCount: analysis.cellCount,
    uniqueIdCount: analysis.uniqueIdCount,
    maxId: analysis.maxId,
    trailerLength: analysis.trailer?.length ?? 0,
    trailerStrings: analysis.trailer?.strings ?? [],
  };
}

export function listMixFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isFile() && /\.mix$/i.test(name)) out.push(p);
  }
  return out.sort();
}

// --- CLI ---

/* v8 ignore start */

const KNOWN_GEN1_MIX_DIRS = [
  "archive/Dance_eJay1/MIX",
  "archive/Dance_SuperPack/MIX",
  "archive/Rave/MIX",
  "archive/GenerationPack1/Dance/MIX",
  "archive/GenerationPack1/Rave/MIX",
  "archive/GenerationPack1/HipHop/MIX",
];

function formatSummary(s: MixFileSummary): string {
  const product = s.product ?? "?";
  const strings = s.trailerStrings.length > 0
    ? ` trailer=[${s.trailerStrings.slice(0, 2).map(x => JSON.stringify(x)).join(", ")}]`
    : "";
  return `  ${s.path}` +
    ` size=${s.fileSize}` +
    ` app=${s.appId}(${product})` +
    ` gridEnd=0x${s.gridEnd.toString(16)}` +
    ` rows=${s.activeRowCount}` +
    ` cells=${s.cellCount}` +
    ` uniqIds=${s.uniqueIdCount}` +
    ` maxId=${s.maxId}` +
    ` trailer=${s.trailerLength}B` +
    strings;
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" },
      dir: { type: "string" },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      out: { type: "string" },
    },
    strict: true,
  });

  const summaries: MixFileSummary[] = [];

  const collect = (paths: string[]): void => {
    for (const p of paths) {
      const analysis = analyzeFile(p);
      summaries.push(summarise(p, analysis));
    }
  };

  if (values.file) {
    collect([resolve(values.file)]);
  } else if (values.dir) {
    collect(listMixFiles(values.dir));
  } else if (values.all) {
    for (const d of KNOWN_GEN1_MIX_DIRS) collect(listMixFiles(d));
  } else {
    console.error("Usage: tsx tools/mix-grid-analyzer.ts (--file PATH | --dir PATH | --all) [--json] [--out PATH]");
    return 2;
  }

  if (values.json || values.out) {
    const json = JSON.stringify(summaries, null, 2);
    if (values.out) {
      mkdirSync(dirname(resolve(values.out)), { recursive: true });
      writeFileSync(values.out, json);
      console.log(`Wrote ${summaries.length} records to ${values.out}`);
    } else {
      console.log(json);
    }
    return 0;
  }

  for (const s of summaries) console.log(formatSummary(s));
  console.log(`\n${summaries.length} file(s) analysed.`);
  return 0;
}

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("mix-grid-analyzer.ts") || process.argv[1].endsWith("mix-grid-analyzer.js"));
if (isDirectRun) {
  process.exit(main());
}

/* v8 ignore stop */
