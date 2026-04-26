import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { ARCHIVE_MIX_DIRS, collectProductMixes } from "../build-index.js";
import { APP_ID_PRODUCTS, parseMix } from "../mix-parser.js";
import type { MixIR } from "../mix-types.js";

const ARCHIVE = resolve("archive");
const hasArchive = existsSync(ARCHIVE);
const FIXTURES = resolve("scripts/__tests__/fixtures");

interface GoldenCase {
  format: string;
  archivePath: string;
  product: string;
  goldenFile: string;
}

const CASES: GoldenCase[] = [
  { format: "A", archivePath: "Dance_eJay1/MIX/FREAK.MIX", product: "Dance_eJay1", goldenFile: "golden-format-A.json" },
  { format: "B", archivePath: "Dance_eJay2/MIX/CAMRON.MIX", product: "Dance_eJay2", goldenFile: "golden-format-B.json" },
  { format: "C", archivePath: "Dance_eJay4/Mix/5 days to go.mix", product: "Dance_eJay4", goldenFile: "golden-format-C.json" },
  { format: "D", archivePath: "HipHop 4/MIX/caro01.mix", product: "HipHop_eJay4", goldenFile: "golden-format-D.json" },
];

interface AppIdCoverageCase {
  archivePath: string;
  product: string;
  expectedAppId: number;
  format: string;
}

const APP_ID_CASES: AppIdCoverageCase[] = [
  { archivePath: "Dance_eJay1/MIX/FREAK.MIX", product: "Dance_eJay1", expectedAppId: 0x00000a06, format: "A" },
  { archivePath: "Rave/MIX/EARTH.MIX", product: "Rave", expectedAppId: 0x00000a07, format: "A" },
  { archivePath: "TECHNO_EJAY/MIX/BUBBLE.MIX", product: "Techno_eJay", expectedAppId: 0x00000889, format: "B" },
  { archivePath: "Dance_eJay2/MIX/CAMRON.MIX", product: "Dance_eJay2", expectedAppId: 0x00000a19, format: "B" },
  { archivePath: "House_eJay/Mix/VOCS.mix", product: "House_eJay", expectedAppId: 0x000011d6, format: "D" },
  { archivePath: "HipHop 2/MIX/Dope MC.mix", product: "HipHop_eJay2", expectedAppId: 0x000011e9, format: "B" },
  { archivePath: "HipHop 4/MIX/caro01.mix", product: "HipHop_eJay4", expectedAppId: 0x000015dc, format: "D" },
  { archivePath: "Dance_eJay3/MIX/80s revisited.mix", product: "Dance_eJay3", expectedAppId: 0x00002571, format: "C" },
  { archivePath: "Techno 3/MIX/303-Inferno.mix", product: "Techno_eJay3", expectedAppId: 0x00002572, format: "C" },
  { archivePath: "HipHop 3/MIX/Big Apple.mix", product: "HipHop_eJay3", expectedAppId: 0x00002573, format: "C" },
  { archivePath: "Xtreme_eJay/mix/ChillySong.mix", product: "Xtreme_eJay", expectedAppId: 0x00002964, format: "C" },
  { archivePath: "Dance_eJay4/Mix/5 days to go.mix", product: "Dance_eJay4", expectedAppId: 0x00002d41, format: "C" },
];

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
    it(`Format ${tc.format}: ${tc.archivePath} matches golden snapshot`, () => {
      const buf = readFileSync(resolve(ARCHIVE, tc.archivePath));
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
    it(`covers appId ${formatAppId(tc.expectedAppId)} with ${tc.archivePath}`, () => {
      const buf = readFileSync(resolve(ARCHIVE, tc.archivePath));
      const ir = parseMix(buf, tc.product);
      expect(ir).not.toBeNull();
      expect(ir?.format).toBe(tc.format);
      expect(ir && normalizeVariantAppId(ir)).toBe(tc.expectedAppId);
    });
  }

  it("covers every observed archive appId and reports no parse-null products", () => {
    const observedAppIds = new Set<number>();
    const parseFailures: string[] = [];

    for (const [productId, layout] of Object.entries(ARCHIVE_MIX_DIRS)) {
      const mixes = collectProductMixes(productId, ARCHIVE);
      for (const mix of mixes) {
        const fullPath = resolve(ARCHIVE, layout.archiveDir, layout.mixSubdir, mix.filename);
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
