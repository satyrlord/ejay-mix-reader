#!/usr/bin/env tsx
/**
 * mix-format-cd-audit.ts — Recovery audit for Format C/D beat+channel fields.
 *
 * Computes per-product and aggregate recovery percentages from parser output.
 * Intended for milestone acceptance checks (e.g. Dance_eJay3 + Techno_eJay3 >= 80%).
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { collectProductMixes, resolveProductMixDir } from "./build-index.js";
import { parseMix } from "./mix-parser.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ARCHIVE_DIR = join(ROOT, "archive");

export interface ProductAudit {
  product: string;
  mixCount: number;
  trackCount: number;
  recoveredBeatCount: number;
  recoveredChannelCount: number;
  recoveredBothCount: number;
  recoveredBeatPct: number;
  recoveredChannelPct: number;
  recoveredBothPct: number;
  meets80Pct: boolean;
}

export interface AuditReport {
  products: ProductAudit[];
  aggregate: {
    mixCount: number;
    trackCount: number;
    recoveredBeatCount: number;
    recoveredChannelCount: number;
    recoveredBothCount: number;
    recoveredBeatPct: number;
    recoveredChannelPct: number;
    recoveredBothPct: number;
  };
  acceptance: {
    thresholdPct: number;
    productsAllMeet80Pct: boolean;
    failingProducts: string[];
  };
}

export interface AuditDeps {
  archiveDir?: string;
  collectProductMixesFn?: (productId: string, archiveDir: string) => Array<{ filename: string }>;
  parseMixFn?: (buffer: Buffer, productId?: string) => ReturnType<typeof parseMix>;
  readFileSyncFn?: (path: string) => Buffer;
  resolveProductMixDirFn?: (
    productId: string,
    archiveDir: string,
  ) => { productArchivePath: string; mixDir: string } | null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round2((numerator * 100) / denominator);
}

export function auditProduct(product: string, deps: AuditDeps = {}): ProductAudit {
  const archiveDir = deps.archiveDir ?? ARCHIVE_DIR;
  const resolveProductMixDirFn = deps.resolveProductMixDirFn ?? resolveProductMixDir;
  const collectProductMixesFn = deps.collectProductMixesFn ?? collectProductMixes;
  const parseMixFn = deps.parseMixFn ?? parseMix;
  const readFileSyncFn = deps.readFileSyncFn ?? readFileSync;

  const resolved = resolveProductMixDirFn(product, archiveDir);
  if (!resolved) {
    return {
      product,
      mixCount: 0,
      trackCount: 0,
      recoveredBeatCount: 0,
      recoveredChannelCount: 0,
      recoveredBothCount: 0,
      recoveredBeatPct: 0,
      recoveredChannelPct: 0,
      recoveredBothPct: 0,
      meets80Pct: false,
    };
  }

  const entries = collectProductMixesFn(product, archiveDir);

  let mixCount = 0;
  let trackCount = 0;
  let recoveredBeatCount = 0;
  let recoveredChannelCount = 0;
  let recoveredBothCount = 0;

  for (const entry of entries) {
    const fullPath = join(resolved.mixDir, entry.filename);
    const ir = parseMixFn(readFileSyncFn(fullPath), product);
    if (!ir) continue;

    mixCount++;
    for (const track of ir.tracks) {
      trackCount++;
      const beatKnown = typeof track.beat === "number" && Number.isFinite(track.beat);
      const channelKnown = typeof track.channel === "number" && Number.isFinite(track.channel);

      if (beatKnown) recoveredBeatCount++;
      if (channelKnown) recoveredChannelCount++;
      if (beatKnown && channelKnown) recoveredBothCount++;
    }
  }

  const recoveredBeatPct = pct(recoveredBeatCount, trackCount);
  const recoveredChannelPct = pct(recoveredChannelCount, trackCount);
  const recoveredBothPct = pct(recoveredBothCount, trackCount);

  return {
    product,
    mixCount,
    trackCount,
    recoveredBeatCount,
    recoveredChannelCount,
    recoveredBothCount,
    recoveredBeatPct,
    recoveredChannelPct,
    recoveredBothPct,
    meets80Pct: recoveredBothPct >= 80,
  };
}

export function buildAudit(products: string[], deps: AuditDeps = {}): AuditReport {
  const productReports = products.map((product) => auditProduct(product, deps));

  const aggregate = productReports.reduce(
    (acc, report) => {
      acc.mixCount += report.mixCount;
      acc.trackCount += report.trackCount;
      acc.recoveredBeatCount += report.recoveredBeatCount;
      acc.recoveredChannelCount += report.recoveredChannelCount;
      acc.recoveredBothCount += report.recoveredBothCount;
      return acc;
    },
    {
      mixCount: 0,
      trackCount: 0,
      recoveredBeatCount: 0,
      recoveredChannelCount: 0,
      recoveredBothCount: 0,
    },
  );

  const failingProducts = productReports
    .filter((report) => !report.meets80Pct)
    .map((report) => report.product);

  return {
    products: productReports,
    aggregate: {
      ...aggregate,
      recoveredBeatPct: pct(aggregate.recoveredBeatCount, aggregate.trackCount),
      recoveredChannelPct: pct(aggregate.recoveredChannelCount, aggregate.trackCount),
      recoveredBothPct: pct(aggregate.recoveredBothCount, aggregate.trackCount),
    },
    acceptance: {
      thresholdPct: 80,
      productsAllMeet80Pct: failingProducts.length === 0,
      failingProducts,
    },
  };
}

function usage(): string {
  return "Usage: npx tsx scripts/mix-format-cd-audit.ts --products Dance_eJay3,Techno_eJay3 --out logs/format-cd/recovery-audit.json";
}

export interface AuditCliDeps {
  buildAuditFn?: (products: string[]) => AuditReport;
  cwd?: string;
  log?: (line: string) => void;
  mkdirSyncFn?: (path: string, options: { recursive: true }) => void;
  writeFileSyncFn?: (path: string, content: string, encoding: "utf-8") => void;
}

export function runAuditCli(args: string[] = process.argv.slice(2), deps: AuditCliDeps = {}): number {
  const { values } = parseArgs({
    args,
    options: {
      products: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: false,
  });

  const log = deps.log ?? ((line: string) => { console.log(line); });
  const cwd = deps.cwd ?? process.cwd();
  const mkdirSyncFn = deps.mkdirSyncFn ?? mkdirSync;
  const writeFileSyncFn = deps.writeFileSyncFn ?? writeFileSync;
  const buildAuditFn = deps.buildAuditFn ?? ((products: string[]) => buildAudit(products));

  if (values.help) {
    log(usage());
    return 0;
  }

  const productList = typeof values.products === "string"
    ? values.products.split(",").map((value) => value.trim()).filter(Boolean)
    : ["Dance_eJay3", "Techno_eJay3"];

  const report = buildAuditFn(productList);
  const jsonText = JSON.stringify(report, null, 2) + "\n";

  if (typeof values.out === "string") {
    const outPath = join(cwd, values.out);
    mkdirSyncFn(dirname(outPath), { recursive: true });
    writeFileSyncFn(outPath, jsonText, "utf-8");
    log(`Wrote ${outPath}`);
  } else {
    log(jsonText);
  }

  return report.acceptance.productsAllMeet80Pct ? 0 : 2;
}

/* v8 ignore start */
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("mix-format-cd-audit.ts") || process.argv[1].endsWith("mix-format-cd-audit.js"));
if (isDirectRun) {
  process.exit(runAuditCli());
}
/* v8 ignore stop */
