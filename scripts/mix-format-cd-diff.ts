#!/usr/bin/env tsx
/**
 * mix-format-cd-diff.ts — Structured diff analyzer for Format C/D track records.
 *
 * Primary mode:
 *   - Loads one product + one .mix file
 *   - Extracts C/D temp-path records
 *   - Groups records by sample-like key (displayName or tmp filename)
 *   - Produces per-group byte-diff hints near pathStart
 *   - Optionally scores candidate offsets for beat/channel-like fields
 *
 * Compare mode:
 *   - Loads two JSON reports produced by this script
 *   - Emits a merged markdown comparison of candidate offsets
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { MixBuffer, detectFormat, parseCatalogs } from "../src/mix-parser.js";
import { resolveProductMixDir } from "./build-index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ARCHIVE_DIR = join(ROOT, "archive");

const TEMP_PATH_RE = /[A-Z]:\\[^\x00\xff]{0,120}?pxd32p[a-z]\.tmp[.,]?/gi;

export type FieldName = "beat" | "channel";

export interface ParsedRecord {
  trackIndex: number;
  format: "C" | "D";
  pathStart: number;
  pathEnd: number;
  path: string;
  displayName: string | null;
  gap: number | null;
  beat: number | null;
  channel: number | null;
  dataLength: number | null;
  preWindowHex: string;
}

export interface GroupSummary {
  key: string;
  count: number;
  recordIndexes: number[];
  diffOffsets: number[];
  beatsKnown: number;
  channelsKnown: number;
}

export interface FieldCandidate {
  offset: number;
  width: 1 | 4;
  valueCount: number;
  uniqueCount: number;
  monotonicViolations: number;
  exampleValues: number[];
}

export interface FieldAnalysis {
  field: FieldName;
  width: 1 | 4;
  compactRecordCount: number;
  allCandidates: FieldCandidate[];
  compactCandidates: FieldCandidate[];
  lockstepPassed: boolean;
  lockstepOffset: number | null;
}

export interface DiffReport {
  product: string;
  mix: string;
  mixPath: string;
  format: "C" | "D";
  afterCatalogs: number;
  recordCount: number;
  records: ParsedRecord[];
  groups: GroupSummary[];
  fieldAnalysis?: FieldAnalysis;
}

export function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/mix-format-cd-diff.ts --product <id> --mix <file.mix> [--field beat|channel] [--assert-lockstep] [--out-json <path>] [--out-md <path>]",
    "  npx tsx scripts/mix-format-cd-diff.ts --compare <left.json> <right.json> [--out-md <path>]",
    "",
    "Examples:",
    "  npx tsx scripts/mix-format-cd-diff.ts --product Dance_eJay3 --mix start.mix --out-json logs/format-cd/diffs/Dance_eJay3/start.by-sample.json --out-md logs/format-cd/diffs/Dance_eJay3/start.by-sample.md",
    "  npx tsx scripts/mix-format-cd-diff.ts --product Dance_eJay3 --mix start.mix --field beat --assert-lockstep",
    "  npx tsx scripts/mix-format-cd-diff.ts --compare left.json right.json --out-md compare.md",
  ].join("\n");
}

export function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

export function readUInt8Safe(buf: MixBuffer, offset: number): number | null {
  if (offset < 0 || offset + 1 > buf.length) return null;
  return buf.readUInt8(offset);
}

export function readUInt32LESafe(buf: MixBuffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readUInt32LE(offset);
}

export function readWindowHex(buf: MixBuffer, start: number, end: number): string {
  const from = Math.max(0, start);
  const to = Math.min(buf.length, end);
  const bytes: string[] = [];
  for (let i = from; i < to; i++) {
    bytes.push(hexByte(buf.at(i) ?? 0));
  }
  return bytes.join(" ");
}

export function findNameField(
  buf: MixBuffer,
  lowerBound: number,
  pathStart: number,
): { offset: number; name: string; gap: number } | null {
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

export function extractRecords(buf: MixBuffer, format: "C" | "D", afterCatalogs: number): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const text = buf.toString("latin1", 0, buf.length);
  const pathMatches: Array<{ index: number; path: string }> = [];

  const re = new RegExp(TEMP_PATH_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index >= afterCatalogs) {
      pathMatches.push({ index: match.index, path: match[0] });
    }
  }

  if (format === "D") {
    let i = 0;
    while (i < pathMatches.length) {
      const left = pathMatches[i];
      if (!left) break;

      if (i + 1 < pathMatches.length) {
        const next = pathMatches[i + 1]!;
        const gapBetweenPaths = next.index - (left.index + left.path.length);
        if (gapBetweenPaths >= 0 && gapBetweenPaths <= 4) i++;
      }

      const nameField = findNameField(buf, afterCatalogs, left.index);
      records.push({
        trackIndex: records.length,
        format,
        pathStart: left.index,
        pathEnd: left.index + left.path.length,
        path: left.path,
        displayName: nameField?.name ?? null,
        gap: nameField?.gap ?? null,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: readWindowHex(buf, left.index - 24, left.index),
      });
      i++;
    }
    return records;
  }

  for (let i = 0; i < pathMatches.length; i++) {
    const first = pathMatches[i];
    if (!first) continue;

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
      dataLength = readUInt32LESafe(buf, first.index - 22);
      beat = readUInt32LESafe(buf, first.index - 18);
      channel = readUInt8Safe(buf, first.index - 13);
    }

    records.push({
      trackIndex: records.length,
      format,
      pathStart: first.index,
      pathEnd: first.index + first.path.length,
      path: first.path,
      displayName: nameField?.name ?? null,
      gap: nameField?.gap ?? null,
      beat,
      channel,
      dataLength,
      preWindowHex: readWindowHex(buf, first.index - 24, first.index),
    });
  }

  return records;
}

export function recordGroupKey(rec: ParsedRecord): string {
  if (rec.displayName && rec.displayName.trim().length > 0) {
    return `name:${rec.displayName.trim().toLowerCase()}`;
  }
  return `tmp:${basename(rec.path).toLowerCase()}`;
}

export function buildGroups(buf: MixBuffer, records: ParsedRecord[]): GroupSummary[] {
  const grouped = new Map<string, ParsedRecord[]>();

  for (const rec of records) {
    const key = recordGroupKey(rec);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(rec);
    else grouped.set(key, [rec]);
  }

  const summaries: GroupSummary[] = [];
  for (const [key, bucket] of grouped.entries()) {
    const diffOffsets: number[] = [];
    for (let rel = -24; rel <= -1; rel++) {
      const values = new Set<number>();
      for (const rec of bucket) {
        const b = readUInt8Safe(buf, rec.pathStart + rel);
        if (b !== null) values.add(b);
      }
      if (values.size > 1) diffOffsets.push(rel);
    }

    summaries.push({
      key,
      count: bucket.length,
      recordIndexes: bucket.map((rec) => rec.trackIndex),
      diffOffsets,
      beatsKnown: bucket.filter((rec) => rec.beat !== null).length,
      channelsKnown: bucket.filter((rec) => rec.channel !== null).length,
    });
  }

  return summaries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function scoreCandidates(
  buf: MixBuffer,
  records: ParsedRecord[],
  width: 1 | 4,
): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  const minOffset = -64;
  const maxOffset = -width;

  for (let rel = minOffset; rel <= maxOffset; rel++) {
    const values: number[] = [];

    for (const rec of records) {
      if (width === 1) {
        const value = readUInt8Safe(buf, rec.pathStart + rel);
        if (value !== null) values.push(value);
      } else {
        const value = readUInt32LESafe(buf, rec.pathStart + rel);
        if (value !== null) values.push(value);
      }
    }

    if (values.length < 4) continue;

    let monotonicViolations = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i]! < values[i - 1]!) monotonicViolations++;
    }

    const uniqueCount = new Set(values).size;
    candidates.push({
      offset: rel,
      width,
      valueCount: values.length,
      uniqueCount,
      monotonicViolations,
      exampleValues: values.slice(0, 8),
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.uniqueCount !== a.uniqueCount) return b.uniqueCount - a.uniqueCount;
      if (a.monotonicViolations !== b.monotonicViolations) return a.monotonicViolations - b.monotonicViolations;
      return Math.abs(a.offset) - Math.abs(b.offset);
    })
    .slice(0, 32);
}

export function scoreCompactGapCandidates(
  buf: MixBuffer,
  records: ParsedRecord[],
  width: 1 | 4,
): FieldCandidate[] {
  const eligible = records.filter((rec) => rec.gap !== null && rec.gap >= width);
  if (eligible.length === 0) return [];

  let maxGap = 0;
  for (const rec of eligible) {
    maxGap = Math.max(maxGap, rec.gap ?? 0);
  }

  const candidates: FieldCandidate[] = [];
  for (let rel = -maxGap; rel <= -width; rel++) {
    const values: number[] = [];

    for (const rec of eligible) {
      const gap = rec.gap ?? 0;
      // Only score offsets that are inside the post-name/pre-path gap.
      if (-rel > gap) continue;

      if (width === 1) {
        const value = readUInt8Safe(buf, rec.pathStart + rel);
        if (value !== null) values.push(value);
      } else {
        const value = readUInt32LESafe(buf, rec.pathStart + rel);
        if (value !== null) values.push(value);
      }
    }

    if (values.length < 4) continue;

    let monotonicViolations = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i]! < values[i - 1]!) monotonicViolations++;
    }

    candidates.push({
      offset: rel,
      width,
      valueCount: values.length,
      uniqueCount: new Set(values).size,
      monotonicViolations,
      exampleValues: values.slice(0, 8),
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.uniqueCount !== a.uniqueCount) return b.uniqueCount - a.uniqueCount;
      if (a.monotonicViolations !== b.monotonicViolations) return a.monotonicViolations - b.monotonicViolations;
      return Math.abs(a.offset) - Math.abs(b.offset);
    })
    .slice(0, 32);
}

export function lockstepCandidate(candidates: FieldCandidate[]): FieldCandidate | null {
  for (const candidate of candidates) {
    const minUnique = Math.min(candidate.valueCount, 4);
    const allowedViolations = Math.max(1, Math.floor(candidate.valueCount / 8));
    if (candidate.uniqueCount >= minUnique && candidate.monotonicViolations <= allowedViolations) {
      return candidate;
    }
  }
  return null;
}

export function toMarkdown(report: DiffReport): string {
  const lines: string[] = [];
  lines.push(`# C/D Diff Report`);
  lines.push("");
  lines.push(`- Product: ${report.product}`);
  lines.push(`- Mix: ${report.mix}`);
  lines.push(`- Format: ${report.format}`);
  lines.push(`- Record count: ${report.recordCount}`);
  lines.push(`- afterCatalogs: 0x${report.afterCatalogs.toString(16)}`);
  lines.push("");

  lines.push(`## Group Summary`);
  lines.push("");
  lines.push(`| Group | Count | Known beats | Known channels | Diff offsets (-24..-1) |`);
  lines.push(`|---|---:|---:|---:|---|`);
  for (const group of report.groups) {
    const offsets = group.diffOffsets.length > 0
      ? group.diffOffsets.map((offset) => String(offset)).join(", ")
      : "-";
    lines.push(`| ${group.key} | ${group.count} | ${group.beatsKnown} | ${group.channelsKnown} | ${offsets} |`);
  }
  lines.push("");

  if (report.fieldAnalysis) {
    const analysis = report.fieldAnalysis;
    lines.push(`## Field Candidates (${analysis.field})`);
    lines.push("");
    lines.push(`- Compact records: ${analysis.compactRecordCount}`);
    lines.push(`- Lockstep passed: ${analysis.lockstepPassed ? "yes" : "no"}`);
    lines.push(`- Lockstep offset: ${analysis.lockstepOffset === null ? "n/a" : analysis.lockstepOffset}`);
    lines.push("");

    lines.push(`### Top compact candidates`);
    lines.push("");
    lines.push(`| Offset | Width | Values | Unique | Violations | Examples |`);
    lines.push(`|---:|---:|---:|---:|---:|---|`);
    for (const candidate of analysis.compactCandidates.slice(0, 12)) {
      lines.push(
        `| ${candidate.offset} | ${candidate.width} | ${candidate.valueCount} | ${candidate.uniqueCount} | ${candidate.monotonicViolations} | ${candidate.exampleValues.join(", ")} |`,
      );
    }
    lines.push("");
  }

  lines.push(`## Record Preview`);
  lines.push("");
  lines.push(`| # | gap | beat | channel | name | pathStart | pre-window hex |`);
  lines.push(`|---:|---:|---:|---:|---|---:|---|`);
  for (const rec of report.records.slice(0, 20)) {
    lines.push(
      `| ${rec.trackIndex} | ${rec.gap ?? "-"} | ${rec.beat ?? "-"} | ${rec.channel ?? "-"} | ${rec.displayName ?? "-"} | ${rec.pathStart} | ${rec.preWindowHex || "-"} |`,
    );
  }

  return lines.join("\n") + "\n";
}

export function ensureParent(
  filePath: string,
  mkdirSyncFn: (path: string, options: { recursive: true }) => unknown = (path, options) =>
    mkdirSync(path, options),
): void {
  mkdirSyncFn(dirname(filePath), { recursive: true });
}

export function caseInsensitiveMixName(
  mixDir: string,
  requested: string,
  readdirSyncFn: (path: string) => string[] = (path) => readdirSync(path),
): string | null {
  const target = requested.toLowerCase();
  for (const entry of readdirSyncFn(mixDir)) {
    if (entry.toLowerCase() === target) return entry;
  }
  return null;
}

export interface AnalyzeMixDeps {
  archiveDir?: string;
  detectFormatFn?: (buffer: MixBuffer) => ReturnType<typeof detectFormat>;
  parseCatalogsFn?: (buffer: MixBuffer, startOffset: number) => { endOffset: number };
  readFileSyncFn?: (path: string) => Buffer;
  readdirSyncFn?: (path: string) => string[];
  resolveProductMixDirFn?: (
    productId: string,
    archiveDir: string,
  ) => { productArchivePath: string; mixDir: string } | null;
}

export function analyzeMix(product: string, mix: string, field?: FieldName, deps: AnalyzeMixDeps = {}): DiffReport {
  const archiveDir = deps.archiveDir ?? ARCHIVE_DIR;
  const resolveProductMixDirFn = deps.resolveProductMixDirFn ?? resolveProductMixDir;
  const readFileSyncFn = deps.readFileSyncFn ?? readFileSync;
  const readdirSyncFn = deps.readdirSyncFn ?? readdirSync;
  const detectFormatFn = deps.detectFormatFn ?? detectFormat;
  const parseCatalogsFn = deps.parseCatalogsFn ?? parseCatalogs;

  const resolved = resolveProductMixDirFn(product, archiveDir);
  if (!resolved) {
    throw new Error(`Archive/MIX folder missing for product: ${product}`);
  }

  const canonicalMix = caseInsensitiveMixName(resolved.mixDir, mix, readdirSyncFn);
  if (!canonicalMix) {
    throw new Error(`Mix not found in ${resolved.mixDir}: ${mix}`);
  }

  const mixPath = join(resolved.mixDir, canonicalMix);
  const buffer = readFileSyncFn(mixPath);
  const mb = new MixBuffer(buffer);
  const format = detectFormatFn(mb);
  if (format !== "C" && format !== "D") {
    throw new Error(`Expected C/D mix, got ${String(format)} for ${mixPath}`);
  }

  let afterCatalogs = 128;
  try {
    afterCatalogs = parseCatalogsFn(mb, 128).endOffset;
  } catch {
    afterCatalogs = 0;
  }

  const records = extractRecords(mb, format, afterCatalogs);
  const groups = buildGroups(mb, records);

  const report: DiffReport = {
    product,
    mix: canonicalMix,
    mixPath,
    format,
    afterCatalogs,
    recordCount: records.length,
    records,
    groups,
  };

  if (field) {
    const width: 1 | 4 = field === "beat" ? 4 : 1;
    const compactRecords = records.filter((rec) => rec.gap !== 40);
    const allCandidates = scoreCandidates(mb, records, width);
    const compactCandidates = scoreCompactGapCandidates(mb, compactRecords, width);
    const lockstep = lockstepCandidate(compactCandidates);

    report.fieldAnalysis = {
      field,
      width,
      compactRecordCount: compactRecords.length,
      allCandidates,
      compactCandidates,
      lockstepPassed: lockstep !== null,
      lockstepOffset: lockstep?.offset ?? null,
    };
  }

  return report;
}

export function compareReports(leftPath: string, rightPath: string): string {
  const left = JSON.parse(readFileSync(leftPath, "utf-8")) as DiffReport;
  const right = JSON.parse(readFileSync(rightPath, "utf-8")) as DiffReport;

  const leftCandidates = left.fieldAnalysis?.compactCandidates ?? [];
  const rightCandidates = right.fieldAnalysis?.compactCandidates ?? [];

  const rightByOffset = new Map<number, FieldCandidate>();
  for (const candidate of rightCandidates) {
    rightByOffset.set(candidate.offset, candidate);
  }

  const rows: string[] = [];
  rows.push("# Candidate Comparison");
  rows.push("");
  rows.push(`- Left: ${left.product}/${left.mix}`);
  rows.push(`- Right: ${right.product}/${right.mix}`);
  rows.push("");
  rows.push("| Offset | Left unique/values | Left violations | Right unique/values | Right violations | Common signal |\n|---:|---:|---:|---:|---:|---|");

  for (const leftCandidate of leftCandidates.slice(0, 32)) {
    const rightCandidate = rightByOffset.get(leftCandidate.offset);
    rows.push(
      `| ${leftCandidate.offset} | ${leftCandidate.uniqueCount}/${leftCandidate.valueCount} | ${leftCandidate.monotonicViolations} | ${rightCandidate ? `${rightCandidate.uniqueCount}/${rightCandidate.valueCount}` : "-"} | ${rightCandidate ? rightCandidate.monotonicViolations : "-"} | ${rightCandidate ? "yes" : "no"} |`,
    );
  }

  rows.push("");
  return rows.join("\n") + "\n";
}

export interface DiffCliDeps {
  analyzeMixFn?: typeof analyzeMix;
  compareReportsFn?: typeof compareReports;
  cwd?: string;
  error?: (line: string) => void;
  log?: (line: string) => void;
  mkdirSyncFn?: (path: string, options: { recursive: true }) => void;
  writeFileSyncFn?: (path: string, content: string, encoding: "utf-8") => void;
}

export function runDiffCli(args: string[] = process.argv.slice(2), deps: DiffCliDeps = {}): number {
  const { values, positionals } = parseArgs({
    args,
    options: {
      product: { type: "string" },
      mix: { type: "string" },
      field: { type: "string" },
      "out-json": { type: "string" },
      "out-md": { type: "string" },
      compare: { type: "boolean", default: false },
      "assert-lockstep": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const cwd = deps.cwd ?? process.cwd();
  const log = deps.log ?? ((line: string) => { console.log(line); });
  const error = deps.error ?? ((line: string) => { console.error(line); });
  const mkdirSyncFn = deps.mkdirSyncFn ?? mkdirSync;
  const writeFileSyncFn = deps.writeFileSyncFn ?? writeFileSync;
  const analyzeMixFn = deps.analyzeMixFn ?? analyzeMix;
  const compareReportsFn = deps.compareReportsFn ?? compareReports;

  if (values.help) {
    log(usage());
    return 0;
  }

  if (values.compare) {
    const [leftPath, rightPath] = positionals;
    if (!leftPath || !rightPath) {
      error("Compare mode requires two JSON report paths.");
      error(usage());
      return 1;
    }
    const md = compareReportsFn(leftPath, rightPath);
    const outMd = typeof values["out-md"] === "string" ? values["out-md"] : undefined;
    if (outMd) {
      const abs = join(cwd, outMd);
      ensureParent(abs, mkdirSyncFn);
      writeFileSyncFn(abs, md, "utf-8");
      log(`Wrote ${abs}`);
    } else {
      log(md);
    }
    return 0;
  }

  const product = typeof values.product === "string" ? values.product : undefined;
  const mix = typeof values.mix === "string" ? values.mix : undefined;
  const fieldValue = typeof values.field === "string" ? values.field : undefined;
  const field = fieldValue === "beat" || fieldValue === "channel"
    ? fieldValue
    : undefined;

  if (!product || !mix) {
    error("Primary mode requires --product and --mix.");
    error(usage());
    return 1;
  }

  const report = analyzeMixFn(product, mix, field);
  const jsonText = JSON.stringify(report, null, 2) + "\n";
  const mdText = toMarkdown(report);

  const outJson = typeof values["out-json"] === "string" ? values["out-json"] : undefined;
  if (outJson) {
    const abs = join(cwd, outJson);
    ensureParent(abs, mkdirSyncFn);
    writeFileSyncFn(abs, jsonText, "utf-8");
    log(`Wrote ${abs}`);
  }

  const outMd = typeof values["out-md"] === "string" ? values["out-md"] : undefined;
  if (outMd) {
    const abs = join(cwd, outMd);
    ensureParent(abs, mkdirSyncFn);
    writeFileSyncFn(abs, mdText, "utf-8");
    log(`Wrote ${abs}`);
  }

  if (!outJson && !outMd) {
    log(jsonText);
  }

  if (values["assert-lockstep"]) {
    const passed = report.fieldAnalysis?.lockstepPassed ?? false;
    if (!passed) {
      error("No lockstep candidate passed the heuristic threshold.");
      return 2;
    }
  }

  return 0;
}

/* v8 ignore start */
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("mix-format-cd-diff.ts") || process.argv[1].endsWith("mix-format-cd-diff.js"));
if (isDirectRun) {
  process.exit(runDiffCli());
}
/* v8 ignore stop */
