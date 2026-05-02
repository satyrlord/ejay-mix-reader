import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { buildIndex, ARCHIVE_MIX_DIRS, collectProductMixes, resolveProductMixDir } from "../../scripts/build-index.js";
import { parseMixBrowser } from "../mix-parser.js";
import { buildMixPlaybackPlan } from "../mix-player.js";

const ARCHIVE = resolve("archive");
const OUTPUT = resolve("output");
const BASELINE = resolve("logs/mix-resolver-parity-baseline.json");

const hasArchive = existsSync(ARCHIVE);
const hasOutput = existsSync(OUTPUT);
const hasBaseline = existsSync(BASELINE);

interface ProductParitySummary {
  mixes: number;
  tracks: number;
  resolved: number;
  unresolved: number;
  unresolvedMixes: number;
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
}

function unresolvedTolerance(expectedUnresolved: number): number {
  // Allow moderate movement from parser/runtime improvements while still
  // catching large unresolved-reference spikes.
  return Math.max(1, Math.ceil(expectedUnresolved * 0.5));
}

function buildBrowserPlaybackParity(): ResolverParityBaseline {
  const index = buildIndex(OUTPUT, ARCHIVE);
  const parity: ResolverParityBaseline = {
    totals: { mixes: 0, tracks: 0, resolved: 0, unresolved: 0 },
    perProduct: {},
    parseFailures: [],
  };

  for (const [productId] of Object.entries(ARCHIVE_MIX_DIRS)) {
    const mixes = collectProductMixes(productId, ARCHIVE);
    const resolved = resolveProductMixDir(productId, ARCHIVE);
    if (!resolved) continue;
    const summary: ProductParitySummary = {
      mixes: 0,
      tracks: 0,
      resolved: 0,
      unresolved: 0,
      unresolvedMixes: 0,
    };
    parity.perProduct[productId] = summary;

    for (const mix of mixes) {
      const fullPath = resolve(resolved.mixDir, mix.filename);
      const ir = parseMixBrowser(readFileSync(fullPath), productId);
      if (!ir) {
        parity.parseFailures.push(`${productId}/${mix.filename}`);
        continue;
      }

      const plan = buildMixPlaybackPlan(ir, index.sampleIndex);
      parity.totals.mixes += 1;
      parity.totals.tracks += plan.sourceTrackCount;
      parity.totals.resolved += plan.resolvedEvents;
      parity.totals.unresolved += plan.unresolvedEvents;

      summary.mixes += 1;
      summary.tracks += plan.sourceTrackCount;
      summary.resolved += plan.resolvedEvents;
      summary.unresolved += plan.unresolvedEvents;
      if (plan.unresolvedEvents > 0) {
        summary.unresolvedMixes += 1;
      }
    }
  }

  return parity;
}

describe.skipIf(!hasArchive || !hasOutput || !hasBaseline)("browser mix playback parity", () => {
  it("matches the static resolver baseline across the archive", { timeout: 30_000 }, () => {
    const expected = JSON.parse(readFileSync(BASELINE, "utf-8")) as ResolverParityBaseline;
    const actual = buildBrowserPlaybackParity();

    // Browser playback may include richer runtime-only lookup paths than the
    // static resolver baseline; treat baseline as a floor so improvements are
    // allowed while regressions are still caught.
    expect(actual.totals.mixes).toBe(expected.totals.mixes);
    expect(actual.totals.tracks).toBeGreaterThanOrEqual(expected.totals.tracks);
    expect(actual.totals.resolved).toBeGreaterThanOrEqual(expected.totals.resolved);
    expect(actual.totals.unresolved).toBeGreaterThanOrEqual(0);
    expect(actual.totals.unresolved).toBeLessThanOrEqual(
      expected.totals.unresolved + unresolvedTolerance(expected.totals.unresolved),
    );

    for (const [productId, expectedSummary] of Object.entries(expected.perProduct)) {
      const actualSummary = actual.perProduct[productId];
      expect(actualSummary).toBeDefined();
      expect(actualSummary?.mixes).toBe(expectedSummary.mixes);
      expect(actualSummary?.tracks).toBeGreaterThanOrEqual(expectedSummary.tracks);
      expect(actualSummary?.resolved).toBeGreaterThanOrEqual(expectedSummary.resolved);
      expect(actualSummary?.unresolved).toBeGreaterThanOrEqual(0);
      expect(actualSummary?.unresolvedMixes).toBeGreaterThanOrEqual(0);
      if (expectedSummary.unresolved > 0) {
        expect(actualSummary?.unresolved).toBeLessThanOrEqual(
          expectedSummary.unresolved + unresolvedTolerance(expectedSummary.unresolved),
        );
      }
      if (expectedSummary.unresolvedMixes > 0) {
        expect(actualSummary?.unresolvedMixes).toBeLessThanOrEqual(expectedSummary.unresolvedMixes + 1);
      }
    }

    expect(actual.parseFailures).toEqual(expected.parseFailures);
  });
});