import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { parseMix } from "../mix-parser.js";
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
});
