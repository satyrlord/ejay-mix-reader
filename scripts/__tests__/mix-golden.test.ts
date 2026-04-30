import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { ARCHIVE_MIX_DIRS, collectProductMixes, resolveProductMixDir } from "../build-index.js";
import { APP_ID_PRODUCTS, parseMix } from "../mix-parser.js";
import type { MixIR } from "../mix-types.js";

const ARCHIVE = resolve("archive");
const hasArchive = existsSync(ARCHIVE);
const FIXTURES = resolve("scripts/__tests__/fixtures");

interface GoldenCase {
  format: string;
  product: string;
  filename: string;
  goldenFile: string;
}

const CASES: GoldenCase[] = [
  { format: "A", product: "Dance_eJay1", filename: "FREAK.MIX", goldenFile: "golden-format-A.json" },
  { format: "B", product: "Dance_eJay2", filename: "CAMRON.MIX", goldenFile: "golden-format-B.json" },
  { format: "C", product: "Dance_eJay4", filename: "5 days to go.mix", goldenFile: "golden-format-C.json" },
  { format: "D", product: "HipHop_eJay4", filename: "caro01.mix", goldenFile: "golden-format-D.json" },
];

interface AppIdCoverageCase {
  product: string;
  filename: string;
  expectedAppId: number;
  format: string;
}

const APP_ID_CASES: AppIdCoverageCase[] = [
  { product: "Dance_eJay1", filename: "FREAK.MIX", expectedAppId: 0x00000a06, format: "A" },
  { product: "Rave", filename: "EARTH.MIX", expectedAppId: 0x00000a07, format: "A" },
  { product: "HipHop_eJay1", filename: "BCAUSE.MIX", expectedAppId: 0x00000a08, format: "A" },
  { product: "Techno_eJay", filename: "start.mix", expectedAppId: 0x00000889, format: "B" },
  { product: "Dance_eJay2", filename: "CAMRON.MIX", expectedAppId: 0x00000a19, format: "B" },
  { product: "House_eJay", filename: "VOCS.mix", expectedAppId: 0x000011d6, format: "D" },
  { product: "HipHop_eJay2", filename: "Dope MC.mix", expectedAppId: 0x000011e9, format: "B" },
  { product: "HipHop_eJay4", filename: "caro01.mix", expectedAppId: 0x000015dc, format: "D" },
  { product: "Dance_eJay3", filename: "80s revisited.mix", expectedAppId: 0x00002571, format: "C" },
  { product: "Techno_eJay3", filename: "303-Inferno.mix", expectedAppId: 0x00002572, format: "C" },
  { product: "HipHop_eJay3", filename: "Big Apple.mix", expectedAppId: 0x00002573, format: "C" },
  { product: "Xtreme_eJay", filename: "ChillySong.mix", expectedAppId: 0x00002964, format: "C" },
  { product: "Dance_eJay4", filename: "5 days to go.mix", expectedAppId: 0x00002d41, format: "C" },
];

function resolveMixFixturePath(productId: string, filename: string): string {
  const resolved = resolveProductMixDir(productId, ARCHIVE);
  if (!resolved) {
    throw new Error(`Missing archive mix directory for ${productId}`);
  }
  const entry = collectProductMixes(productId, ARCHIVE)
    .find((mix) => mix.filename.toLowerCase() === filename.toLowerCase());
  if (!entry) {
    throw new Error(`Missing mix ${filename} for ${productId}`);
  }
  return resolve(resolved.mixDir, entry.filename);
}

function normalizeVariantAppId(ir: MixIR): number {
  return ir.format === "A" ? (ir.appId & 0xffff) : ir.appId;
}

function formatAppId(appId: number): string {
  return `0x${appId.toString(16).padStart(8, "0")}`;
}

function sortedUniqueAppIds(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

describe.skipIf(!hasArchive)("golden-file MixIR snapshots", () => {
  for (const tc of CASES) {
    it(`Format ${tc.format}: ${tc.product}/${tc.filename} matches golden snapshot`, () => {
      const buf = readFileSync(resolveMixFixturePath(tc.product, tc.filename));
      const ir = parseMix(buf, tc.product);
      expect(ir).not.toBeNull();

      const golden: MixIR = JSON.parse(readFileSync(resolve(FIXTURES, tc.goldenFile), "utf-8"));
      expect(ir).toEqual(golden);
    });
  }

  for (const tc of CASES) {
    it(`Format ${tc.format}: key structural properties are stable`, () => {
      const golden: MixIR = JSON.parse(readFileSync(resolve(FIXTURES, tc.goldenFile), "utf-8"));
      expect(golden.format).toBe(tc.format);
      expect(golden.product).toBe(tc.product);
      expect(typeof golden.bpm).toBe("number");
      expect(golden.bpm).toBeGreaterThan(0);
      expect(Array.isArray(golden.tracks)).toBe(true);
      expect(golden.tracks.length).toBeGreaterThanOrEqual(0);

      for (const track of golden.tracks) {
        expect(track).toHaveProperty("channel");
        expect(track).toHaveProperty("beat");
        expect(track).toHaveProperty("sampleRef");
        expect(track.sampleRef).toHaveProperty("rawId");
      }

      if (golden.mixer) {
        expect(golden.mixer).toHaveProperty("channels");
        expect(Array.isArray(golden.mixer.channels)).toBe(true);
      }

      if (golden.drumMachine) {
        expect(Array.isArray(golden.drumMachine.pads)).toBe(true);
      }
    });
  }

  for (const tc of APP_ID_CASES) {
    it(`covers appId ${formatAppId(tc.expectedAppId)} with ${tc.product}/${tc.filename}`, () => {
      const buf = readFileSync(resolveMixFixturePath(tc.product, tc.filename));
      const ir = parseMix(buf, tc.product);
      expect(ir).not.toBeNull();
      expect(ir?.format).toBe(tc.format);
      expect(ir && normalizeVariantAppId(ir)).toBe(tc.expectedAppId);
    });
  }

  it("covers every observed archive appId and reports no parse-null products", () => {
    const observedAppIds = new Set<number>();
    const parseFailures: string[] = [];

    for (const [productId] of Object.entries(ARCHIVE_MIX_DIRS)) {
      const mixes = collectProductMixes(productId, ARCHIVE);
      const resolved = resolveProductMixDir(productId, ARCHIVE);
      if (!resolved) continue;
      for (const mix of mixes) {
        const fullPath = resolve(resolved.mixDir, mix.filename);
        const ir = parseMix(readFileSync(fullPath), productId);
        if (!ir) {
          parseFailures.push(`${productId}/${mix.filename}`);
          continue;
        }
        observedAppIds.add(normalizeVariantAppId(ir));
      }
    }

    expect(parseFailures).toEqual([]);

    const fixtureAppIds = sortedUniqueAppIds(APP_ID_CASES.map((tc) => tc.expectedAppId));
    expect(sortedUniqueAppIds(observedAppIds)).toEqual(fixtureAppIds);

    for (const appId of observedAppIds) {
      expect(
        APP_ID_PRODUCTS[appId],
        `Missing APP_ID_PRODUCTS entry for ${formatAppId(appId)}`,
      ).toBeTypeOf("string");
    }
  });
});
