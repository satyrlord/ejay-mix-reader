#!/usr/bin/env tsx
/**
 * mix-format-cd-records.ts — Format C/D track record hex dumper
 *
 * Scans every Format C and D .mix file in the archive (or a specified file)
 * and writes a per-track hex dump to logs/format-cd/<product>/<mixname>.txt
 * for use in reverse-engineering beat/channel/data byte positions.
 *
 * Usage:
 *   npm run mix:dump-cd                                 # all Format C/D mixes
 *   npm run mix:dump-cd -- --file <path>               # single file
 *   npm run mix:dump-cd -- --product Dance_eJay3       # one product
 *
 *   tsx scripts/mix-format-cd-records.ts                    # all Format C/D mixes
 *   tsx scripts/mix-format-cd-records.ts --file <path>      # single file
 *   tsx scripts/mix-format-cd-records.ts --product Dance_eJay3  # one product
 *
 * For "big format" Format C records the 40-byte block preceding the temp path
 * is labelled at field level. The compact (8–12-byte gap) variant is also
 * labelled where the structure is known.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { MixBuffer, detectFormat, parseCatalogs } from "../src/mix-parser.js";
import { ARCHIVE_MIX_DIRS } from "./build-index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_DIR = join(ROOT, "archive");
const LOGS_DIR = join(ROOT, "logs", "format-cd");

// ── Temp-path regex — matches the pxd32p?.tmp style paths used by Format C/D ─
const TEMP_PATH_RE = /[A-Z]:\\[^\x00\xff]{0,120}?pxd32p[a-z]\.tmp[.,]?/gi;

interface TrackRecord {
  trackIndex: number;
  format: "C" | "D";
  pathStart: number;
  pathEnd: number;
  path: string;
  /** Gap between end of name field and start of temp path */
  gap: number | null;
  /** Parsed name from the name-length-prefix field before the path */
  displayName: string | null;
  /** For Format C big-format (gap=40) fields parsed from the fixed layout */
  beat: number | null;
  channel: number | null;
  dataLength: number | null;
}

function hexByte(b: number): string {
  return b.toString(16).padStart(2, "0").toUpperCase();
}

function hexLine(buf: MixBuffer, from: number, to: number): string {
  const parts: string[] = [];
  for (let i = from; i < to && i < buf.length; i++) {
    parts.push(hexByte(buf.at(i) ?? 0));
  }
  return parts.join(" ");
}

function printableAscii(buf: MixBuffer, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to && i < buf.length; i++) {
    const b = buf.at(i) ?? 0;
    out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  }
  return out;
}

function hexDump(buf: MixBuffer, from: number, to: number, lineBytes = 16): string[] {
  const lines: string[] = [];
  for (let base = from; base < to; base += lineBytes) {
    const end = Math.min(base + lineBytes, to);
    const hex = hexLine(buf, base, end).padEnd(lineBytes * 3 - 1, " ");
    const asc = printableAscii(buf, base, end);
    lines.push(`  ${(base).toString(16).padStart(6, "0")}  ${hex}  |${asc}|`);
  }
  return lines;
}

/**
 * Locate Format C/D track records by scanning for temp-path strings in the
 * buffer region after catalog data ends.
 */
function extractTrackRecords(
  buf: MixBuffer,
  format: "C" | "D",
  afterCatalogs: number,
): TrackRecord[] {
  const text = buf.toString("latin1", 0, buf.length);
  const pathMatches: Array<{ index: number; path: string }> = [];
  const re = new RegExp(TEMP_PATH_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index >= afterCatalogs) {
      pathMatches.push({ index: match.index, path: match[0] });
    }
  }

  const records: TrackRecord[] = [];

  if (format === "D") {
    // Format D: consecutive paired temp paths, name field precedes first path
    let i = 0;
    while (i < pathMatches.length) {
      const left = pathMatches[i];
      // Advance past paired second path if present
      if (i + 1 < pathMatches.length) {
        const next = pathMatches[i + 1];
        const gapBetweenPaths = next.index - (left.index + left.path.length);
        if (gapBetweenPaths >= 0 && gapBetweenPaths <= 4) i++;
      }
      const nameField = findNameField(buf, afterCatalogs, left.index);
      records.push({
        trackIndex: records.length,
        format: "D",
        pathStart: left.index,
        pathEnd: left.index + left.path.length,
        path: left.path,
        gap: nameField?.gap ?? null,
        displayName: nameField?.name ?? null,
        beat: null,
        channel: null,
        dataLength: null,
      });
      i++;
    }
    return records;
  }

  // Format C: skip paired paths (only use first of each pair for record)
  for (let i = 0; i < pathMatches.length; i++) {
    const first = pathMatches[i];
    const second = pathMatches[i + 1];
    if (second) {
      const gap = second.index - (first.index + first.path.length);
      if (gap >= 0 && gap <= 4) i++;
    }

    const nameField = findNameField(buf, afterCatalogs, first.index);
    let beat: number | null = null;
    let channel: number | null = null;
    let dataLength: number | null = null;

    if (nameField?.gap === 40 && first.index >= 22) {
      dataLength = buf.readUInt32LE(first.index - 22);
      beat = buf.readUInt32LE(first.index - 18);
      channel = buf.readUInt8(first.index - 13);
    }

    records.push({
      trackIndex: records.length,
      format: "C",
      pathStart: first.index,
      pathEnd: first.index + first.path.length,
      path: first.path,
      gap: nameField?.gap ?? null,
      displayName: nameField?.name ?? null,
      beat,
      channel,
      dataLength,
    });
  }

  return records;
}

function findNameField(
  buf: MixBuffer,
  lowerBound: number,
  pathStart: number,
): { offset: number; name: string; gap: number } | null {
  // Big format (gap === 40)
  const nameEnd40 = pathStart - 40;
  if (nameEnd40 >= lowerBound) {
    for (let nameLen = 2; nameLen <= 54; nameLen++) {
      const offset = nameEnd40 - nameLen - 2;
      if (offset < lowerBound) break;
      if (offset + 2 > buf.length) continue;
      if (buf.readUInt16LE(offset) !== nameLen) continue;
      const name = buf.toString("latin1", offset + 2, nameEnd40 - 2);
      if (!/^[A-Za-z0-9_ .()-]*$/.test(name)) continue;
      return { offset, name, gap: 40 };
    }
  }

  // Compact format (gap 8–12)
  const minOffset = Math.max(lowerBound, pathStart - 64);
  for (let offset = pathStart - 2; offset >= minOffset; offset--) {
    if (offset + 2 > buf.length) continue;
    const nameLen = buf.readUInt16LE(offset);
    if (nameLen < 2 || nameLen > 32) continue;
    const nameStart = offset + 2;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > pathStart) continue;
    const gap = pathStart - nameEnd;
    if (gap < 8 || gap > 12) continue;
    const name = buf.toString("latin1", nameStart, nameEnd);
    if (!/^[A-Za-z0-9_ .()-]*$/.test(name)) continue;
    return { offset, name, gap };
  }

  return null;
}

function formatRecord(buf: MixBuffer, rec: TrackRecord, contextBytes = 80): string {
  const lines: string[] = [];
  lines.push(`── Track ${rec.trackIndex} ──────────────────────────────────────────────`);
  lines.push(`  displayName  : ${rec.displayName ?? "(none)"}`);
  lines.push(`  pathStart    : 0x${rec.pathStart.toString(16).padStart(6, "0")} (${rec.pathStart})`);
  lines.push(`  path         : ${rec.path}`);
  lines.push(`  nameGap      : ${rec.gap ?? "(unknown)"}`);

  if (rec.format === "C" && rec.gap === 40) {
    lines.push(`  dataLength   : ${rec.dataLength ?? "(n/a)"}  @offset 0x${(rec.pathStart - 22).toString(16)}`);
    lines.push(`  beat         : ${rec.beat ?? "(n/a)"}  @offset 0x${(rec.pathStart - 18).toString(16)}`);
    lines.push(`  channel      : ${rec.channel ?? "(n/a)"}  @offset 0x${(rec.pathStart - 13).toString(16)}`);
    lines.push(`  40-byte block: pathStart-40 to pathStart-1`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 40, rec.pathStart - 22)}  [name gap / state]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 22, rec.pathStart - 18)}  [dataLength LE32]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 18, rec.pathStart - 14)}  [beat/zeitpos LE32]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 14, rec.pathStart - 13)}  [pad byte]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 13, rec.pathStart - 12)}  [channel byte]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 12, rec.pathStart - 4)}   [8-byte state]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 4, rec.pathStart - 2)}    [mystery word]`);
    lines.push(`    ${hexLine(buf, rec.pathStart - 2, rec.pathStart)}         [pathLen LE16]`);
  }

  // Context hex dump: contextBytes before pathStart through end of path
  const contextFrom = Math.max(0, rec.pathStart - contextBytes);
  const contextTo = Math.min(buf.length, rec.pathEnd + 8);
  lines.push(`  context hex dump (offset 0x${contextFrom.toString(16)}–0x${contextTo.toString(16)}):`);
  lines.push(...hexDump(buf, contextFrom, contextTo));
  lines.push("");

  return lines.join("\n");
}

function processFile(mixPath: string, productId: string, outDir: string): void {
  let buf: Buffer;
  try {
    buf = readFileSync(mixPath);
  } catch {
    console.warn(`  SKIP (unreadable): ${mixPath}`);
    return;
  }
  const mb = new MixBuffer(buf);
  const fmt = detectFormat(mb);
  if (fmt !== "C" && fmt !== "D") return;

  // Find afterCatalogs offset: scan for catalog block after the fixed header.
  // The catalog parser needs a starting offset — use a conservative heuristic
  // (skip the first 128 bytes to get past headers/title section).
  let afterCatalogs = 128;
  try {
    const result = parseCatalogs(mb, afterCatalogs);
    afterCatalogs = result.endOffset;
  } catch {
    // Catalog parse failed — fall back to full scan from offset 0
    afterCatalogs = 0;
  }

  const records = extractTrackRecords(mb, fmt as "C" | "D", afterCatalogs);
  if (records.length === 0) return;

  const lines: string[] = [];
  lines.push(`Format ${fmt} — ${productId}/${basename(mixPath)}`);
  lines.push(`File: ${mixPath}`);
  lines.push(`Size: ${buf.length} bytes  |  Tracks: ${records.length}  |  afterCatalogs: 0x${afterCatalogs.toString(16)}`);
  lines.push("");

  for (const rec of records) {
    lines.push(formatRecord(mb, rec));
  }

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${basename(mixPath)}.txt`);
  writeFileSync(outFile, lines.join("\n"), "utf-8");
  console.log(`  wrote ${records.length} records → ${outFile}`);
}

function runForProduct(productId: string): void {
  const layout = ARCHIVE_MIX_DIRS[productId];
  if (!layout) {
    console.warn(`Unknown product: ${productId}`);
    return;
  }
  const productDir = join(ARCHIVE_DIR, layout.archiveDir);
  if (!existsSync(productDir)) {
    console.warn(`Archive folder missing: ${productDir}`);
    return;
  }

  // Find the mix subdirectory (case-insensitive)
  let mixDir: string | null = null;
  for (const entry of readdirSync(productDir)) {
    if (entry.toLowerCase() === "mix") {
      const full = join(productDir, entry);
      if (statSync(full).isDirectory()) { mixDir = full; break; }
    }
  }
  if (!mixDir) return;

  const outDir = join(LOGS_DIR, productId);
  for (const entry of readdirSync(mixDir).sort()) {
    if (!/\.mix$/i.test(entry)) continue;
    processFile(join(mixDir, entry), productId, outDir);
  }
}

const { values: args } = parseArgs({
  options: {
    file:    { type: "string" },
    product: { type: "string" },
  },
  strict: false,
});

const argFile = typeof args.file === "string" ? args.file : undefined;
const argProduct = typeof args.product === "string" ? args.product : undefined;

if (argFile) {
  // Single file mode
  const abs = argFile.startsWith("/") || /^[A-Z]:\\/i.test(argFile)
    ? argFile
    : join(process.cwd(), argFile);
  const productId = argProduct ?? "Unknown";
  const outDir = join(LOGS_DIR, productId);
  console.log(`Processing ${abs} …`);
  processFile(abs, productId, outDir);
} else if (argProduct) {
  console.log(`Processing product: ${argProduct}`);
  runForProduct(argProduct);
} else {
  // All Format C/D products
  console.log("Scanning all Format C/D mixes …");
  for (const productId of Object.keys(ARCHIVE_MIX_DIRS).sort()) {
    runForProduct(productId);
  }
}
