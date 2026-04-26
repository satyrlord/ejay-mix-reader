import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { ARCHIVE_MIX_DIRS, collectProductMixes } from "../build-index.js";
import { parseMix } from "../mix-parser.js";
import { buildResolverIndex, resolveMix } from "../mix-resolver.js";
import type { NormalizedMetadata } from "../mix-resolver.js";

const ARCHIVE = resolve("archive");
const OUTPUT_METADATA = resolve("output/metadata.json");
const BASELINE = resolve("logs/mix-resolver-parity-baseline.json");

const hasArchive = existsSync(ARCHIVE);
const hasOutputMetadata = existsSync(OUTPUT_METADATA);
const hasBaseline = existsSync(BASELINE);

interface ProductParitySummary {
  mixes: number;
  tracks: number;
  resolved: number;
  unresolved: number;
  unresolvedMixes: number;
}

interface UnresolvedReferenceCount {
  warning: string;
  count: number;
}

interface ResolverParityBaseline {
  totals: {
    mixes: number;
    tracks: number;
    resolved: number;
    unresolved: number;
  };
  perProduct: Record<string, ProductParitySummary>;
  parseFailures: string[];
  unresolvedReferencesTop25: UnresolvedReferenceCount[];
}

function buildResolverParityBaseline(): ResolverParityBaseline {
  const metadata = JSON.parse(readFileSync(OUTPUT_METADATA, "utf-8")) as NormalizedMetadata;
  const index = buildResolverIndex({
    metadata,
    outputRoot: resolve("output"),
    archiveRoot: ARCHIVE,
  });

  const unresolvedCounts = new Map<string, number>();
  const baseline: ResolverParityBaseline = {
    totals: { mixes: 0, tracks: 0, resolved: 0, unresolved: 0 },
    perProduct: {},
    parseFailures: [],
    unresolvedReferencesTop25: [],
  };

  for (const [productId, layout] of Object.entries(ARCHIVE_MIX_DIRS)) {
    const mixes = collectProductMixes(productId, ARCHIVE);
    const productSummary: ProductParitySummary = {
      mixes: 0,
      tracks: 0,
      resolved: 0,
      unresolved: 0,
      unresolvedMixes: 0,
    };
    baseline.perProduct[productId] = productSummary;

    for (const mix of mixes) {
      const fullPath = resolve(ARCHIVE, layout.archiveDir, layout.mixSubdir, mix.filename);
      const ir = parseMix(readFileSync(fullPath), productId);
      if (!ir) {
        baseline.parseFailures.push(`${productId}/${mix.filename}`);
        continue;
      }

      const report = resolveMix(ir, index);
      baseline.totals.mixes += 1;
      baseline.totals.tracks += report.total;
      baseline.totals.resolved += report.resolved;
      baseline.totals.unresolved += report.unresolved;

      productSummary.mixes += 1;
      productSummary.tracks += report.total;
      productSummary.resolved += report.resolved;
      productSummary.unresolved += report.unresolved;

      if (report.unresolved > 0) {
        productSummary.unresolvedMixes += 1;
        for (const warning of report.warnings) {
          unresolvedCounts.set(warning, (unresolvedCounts.get(warning) ?? 0) + 1);
        }
      }
    }
  }

  baseline.unresolvedReferencesTop25 = [...unresolvedCounts.entries()]
    .map(([warning, count]) => ({ warning, count }))
    .sort((left, right) => right.count - left.count || left.warning.localeCompare(right.warning))
    .slice(0, 25);

  return baseline;
}

describe.skipIf(!hasArchive || !hasOutputMetadata || !hasBaseline)("archive-wide mix resolver parity", () => {
  it("matches the checked-in baseline and reports unresolved references explicitly", () => {
    const expected = JSON.parse(readFileSync(BASELINE, "utf-8")) as ResolverParityBaseline;
    const actual = buildResolverParityBaseline();
    expect(actual).toEqual(expected);
  });
});