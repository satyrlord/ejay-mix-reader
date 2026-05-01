/**
 * Unit tests for `src/product-mode.ts` data helpers.
 *
 * Note: DOM-touching helpers (`applyProductTheme`, `createProductModeSelect`)
 * are exercised by the Playwright browser tests + Istanbul, which is the
 * coverage gate for files under `src/`. The vitest unit suite runs in plain
 * Node and only validates the pure registry/lookup logic here.
 */

import { describe, expect, it } from "vitest";

import {
  getProductModeEntry,
  isAllEntry,
  PRODUCT_MODE_ALL_ID,
  PRODUCT_MODE_ENTRIES,
} from "../product-mode.js";

describe("PRODUCT_MODE_ENTRIES", () => {
  it("has 14 entries (All + 13 products) in the user-specified order", () => {
    expect(PRODUCT_MODE_ENTRIES).toHaveLength(14);
    expect(PRODUCT_MODE_ENTRIES.map((entry) => entry.id)).toEqual([
      "all",
      "rave",
      "dance1",
      "hiphop1",
      "dance2",
      "techno",
      "hiphop2",
      "dance3",
      "dance4",
      "hiphop3",
      "techno3",
      "xtreme",
      "hiphop4",
      "house",
    ]);
  });

  it("includes HipHop 1 expansion sample-pack ids", () => {
    const hh1 = PRODUCT_MODE_ENTRIES.find((entry) => entry.id === "hiphop1");
    expect(hh1).toBeDefined();
    expect(hh1!.productIds).toEqual([
      "HipHop_eJay1",
      "GenerationPack1_HipHop",
      "SampleKit_DMKIT1",
      "SampleKit_DMKIT2",
    ]);
    expect(hh1!.defaultBpm).toBe(96);
  });

  it("includes Dance 3 SuperPack expansion id", () => {
    const dance3 = PRODUCT_MODE_ENTRIES.find((entry) => entry.id === "dance3");
    expect(dance3).toBeDefined();
    expect(dance3!.productIds).toEqual(["Dance_eJay3", "Dance_SuperPack"]);
    expect(dance3!.mixGroupIds).toEqual(["Dance_eJay3", "Dance_SuperPack"]);
  });

  it("assigns the correct default BPM to each product", () => {
    const bpms = Object.fromEntries(
      PRODUCT_MODE_ENTRIES.map((entry) => [entry.id, entry.defaultBpm]),
    );
    expect(bpms).toMatchObject({
      all: null,
      rave: 180,
      dance1: 140,
      dance2: 140,
      dance3: 140,
      dance4: 140,
      techno: 140,
      techno3: 140,
      hiphop1: 96,
      hiphop2: 90,
      hiphop3: 90,
      hiphop4: 90,
      xtreme: 125,
      house: 125,
    });
  });
});

describe("getProductModeEntry", () => {
  it("returns the entry by id", () => {
    expect(getProductModeEntry("rave").id).toBe("rave");
    expect(getProductModeEntry("house").label).toBe("House");
  });

  it("falls back to the All entry on miss", () => {
    expect(getProductModeEntry("unknown").id).toBe(PRODUCT_MODE_ALL_ID);
  });

  it("returns the All entry for null/undefined/empty input", () => {
    expect(getProductModeEntry(null).id).toBe(PRODUCT_MODE_ALL_ID);
    expect(getProductModeEntry(undefined).id).toBe(PRODUCT_MODE_ALL_ID);
    expect(getProductModeEntry("").id).toBe(PRODUCT_MODE_ALL_ID);
  });
});

describe("isAllEntry", () => {
  it("returns true only for the All entry", () => {
    expect(isAllEntry(getProductModeEntry(PRODUCT_MODE_ALL_ID))).toBe(true);
    expect(isAllEntry(getProductModeEntry("rave"))).toBe(false);
    expect(isAllEntry(getProductModeEntry("house"))).toBe(false);
  });
});
