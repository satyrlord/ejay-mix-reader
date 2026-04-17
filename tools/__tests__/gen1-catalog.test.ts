import { describe, expect, it } from "vitest";
import {
  splitCatalogLines,
  normalisePxdPath,
  parseMaxFile,
  parsePxddanceFile,
  parsePxdTxtChannelRanges,
  categoryFromPxdTxt,
  buildGen1Catalog,
  resolveProductPaths,
  runCli,
  GEN1_PRODUCT_LAYOUT,
  DANCE1_CHANNEL_ORDER,
} from "../gen1-catalog.js";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const ARCHIVE = resolve("archive");
const hasArchive = existsSync(ARCHIVE);

// ── splitCatalogLines ─────────────────────────────────────────

describe("splitCatalogLines", () => {
  it("handles CRLF-terminated quoted lines", () => {
    const text = '"ba\\aaaf.pxd"\r\n"bb\\abbq.pxd"\r\n';
    expect(splitCatalogLines(text)).toEqual([
      "ba\\aaaf.pxd",
      "bb\\abbq.pxd",
    ]);
  });

  it("handles LF-terminated unquoted lines", () => {
    const text = "ba/r1da006.pxd\nba/r1da008.pxd\n";
    expect(splitCatalogLines(text)).toEqual([
      "ba/r1da006.pxd",
      "ba/r1da008.pxd",
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    const text = "\uFEFF\"a\"\r\n\"b\"\r\n";
    expect(splitCatalogLines(text)).toEqual(["a", "b"]);
  });

  it("preserves empty quoted entries as empty strings", () => {
    const text = '"a"\r\n""\r\n"c"\r\n';
    expect(splitCatalogLines(text)).toEqual(["a", "", "c"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitCatalogLines("")).toEqual([]);
  });
});

// ── normalisePxdPath ──────────────────────────────────────────

describe("normalisePxdPath", () => {
  it("lowercases and converts backslashes", () => {
    expect(normalisePxdPath("BA\\AAAF.PXD")).toEqual({
      path: "ba/aaaf.pxd",
      bank: "BA",
      file: "AAAF",
    });
  });

  it("returns nulls for empty input", () => {
    expect(normalisePxdPath("")).toEqual({
      path: "",
      bank: null,
      file: null,
    });
  });

  it("handles multi-segment kit paths", () => {
    expect(normalisePxdPath("dmkit2\\04\\fx316.pxd")).toEqual({
      path: "dmkit2/04/fx316.pxd",
      bank: "DMKIT2",
      file: "FX316",
    });
  });

  it("handles files without a dotted extension", () => {
    expect(normalisePxdPath("ba\\AAAF")).toEqual({
      path: "ba/aaaf",
      bank: "BA",
      file: "AAAF",
    });
  });
});

// ── parseMaxFile / parsePxddanceFile ─────────────────────────

describe("parseMaxFile", () => {
  it("produces one entry per line, indexed by sample ID", () => {
    const text = '"ba\\aaaf.pxd"\r\n""\r\n"bc\\abbq.pxd"\r\n';
    const paths = parseMaxFile(text);
    expect(paths).toEqual(["ba\\aaaf.pxd", "", "bc\\abbq.pxd"]);
  });
});

describe("parsePxddanceFile", () => {
  it("groups consecutive 6-line records", () => {
    const text = [
      '"bm\\asjo.pxd"',
      '""',
      '"loop"',
      '"2"',
      '"Grp. 1"',
      '"Vers1"',
      '"bl\\arwo.pxd"',
      '""',
      '"loop"',
      '"2"',
      '"Grp. 1"',
      '"Vers2"',
      "",
    ].join("\r\n");
    const records = parsePxddanceFile(text);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      path: "bm\\asjo.pxd",
      category: "loop",
      group: "Grp. 1",
      version: "Vers1",
    });
    expect(records[1].version).toBe("Vers2");
  });

  it("drops a trailing partial record", () => {
    const text = [
      '"bm\\asjo.pxd"',
      '""',
      '"loop"',
      '"2"',
      '"Grp. 1"',
      "", // only 5 lines → no complete record
    ].join("\r\n");
    expect(parsePxddanceFile(text)).toHaveLength(0);
  });
});

// ── parsePxdTxtChannelRanges / categoryFromPxdTxt ────────────

describe("parsePxdTxtChannelRanges", () => {
  it("decodes 9 pairs from the Dance 1 PXD.TXT header", () => {
    // Real Dance 1 header values (first 18 quoted numbers).
    const header =
      ['"0"', '"126"', '"126"', '"114"', '"240"', '"115"',
       '"355"', '"100"', '"455"', '"81"', '"536"', '"300"',
       '"836"', '"229"', '"1065"', '"127"', '"1192"', '"160"'].join("\r\n") +
      '\r\n"917984"\r\n';
    const { ranges } = parsePxdTxtChannelRanges(header);
    expect(ranges).toHaveLength(9);
    expect(ranges[0]).toEqual({ startId: 0, count: 126, endId: 125 });
    expect(ranges[1]).toEqual({ startId: 126, count: 114, endId: 239 });
    expect(ranges[8]).toEqual({ startId: 1192, count: 160, endId: 1351 });
  });

  it("stops at the first non-numeric line", () => {
    const text = '"0"\r\n"10"\r\n"not a number"\r\n';
    const { ranges } = parsePxdTxtChannelRanges(text);
    expect(ranges).toHaveLength(1);
  });
});

describe("categoryFromPxdTxt", () => {
  const ranges = {
    ranges: [
      { startId: 0, count: 126, endId: 125 },
      { startId: 126, count: 114, endId: 239 },
    ],
  };
  it("returns the channel name for an in-range ID", () => {
    expect(categoryFromPxdTxt(0, ranges)).toBe("loop");
    expect(categoryFromPxdTxt(125, ranges)).toBe("loop");
    expect(categoryFromPxdTxt(126, ranges)).toBe("drum");
  });
  it("returns null for an out-of-range ID", () => {
    expect(categoryFromPxdTxt(9999, ranges)).toBeNull();
  });
});

// ── buildGen1Catalog ─────────────────────────────────────────

describe("buildGen1Catalog", () => {
  it("builds ID-indexed entries from a MAX text", () => {
    const cat = buildGen1Catalog({
      maxText: '"ba\\aaaf.pxd"\r\n""\r\n"bc\\abbq.pxd"\r\n',
      maxPath: "/fake/MAX",
    });
    expect(cat.totalIds).toBe(3);
    expect(cat.populatedIds).toBe(2);
    expect(cat.entries[0]).toMatchObject({
      id: 0,
      path: "ba/aaaf.pxd",
      bank: "BA",
      file: "AAAF",
    });
    expect(cat.entries[1].path).toBe("");
    expect(cat.entries[1].bank).toBeNull();
    expect(cat.entries[2]).toMatchObject({
      id: 2,
      path: "bc/abbq.pxd",
      bank: "BC",
    });
  });

  it("enriches matching entries from Pxddance", () => {
    const pxd = [
      '"bm\\asjo.pxd"', '""', '"loop"', '"2"', '"Grp. 1"', '"Vers1"', "",
    ].join("\r\n");
    const cat = buildGen1Catalog({
      maxText: '"bm\\asjo.pxd"\r\n"bc\\abbq.pxd"\r\n',
      pxddanceText: pxd,
      maxPath: "/fake/MAX",
    });
    expect(cat.entries[0].category).toBe("loop");
    expect(cat.entries[0].group).toBe("Grp. 1");
    expect(cat.entries[0].version).toBe("Vers1");
    // Entry with no matching Pxddance record gets null metadata.
    expect(cat.entries[1].category).toBeNull();
    expect(cat.entries[1].group).toBeNull();
  });

  it("falls back to PXD.TXT channel ranges when Pxddance is absent", () => {
    const pxdtxt =
      ['"0"', '"2"', '"2"', '"1"'].join("\r\n") + "\r\n";
    const maxText = '"ba\\one.pxd"\r\n"ba\\two.pxd"\r\n"bb\\three.pxd"\r\n';
    const cat = buildGen1Catalog({
      maxText,
      pxdtxtText: pxdtxt,
      maxPath: "/fake/MAX",
    });
    expect(cat.entries[0].category).toBe(DANCE1_CHANNEL_ORDER[0]);
    expect(cat.entries[1].category).toBe(DANCE1_CHANNEL_ORDER[0]);
    expect(cat.entries[2].category).toBe(DANCE1_CHANNEL_ORDER[1]);
  });

  it("records the supplied product and paths", () => {
    const cat = buildGen1Catalog({
      maxText: '"ba\\aaaf.pxd"\r\n',
      maxPath: "/x/MAX",
      pxddancePath: "/x/Pxddance",
      product: "Dance_SuperPack",
    });
    expect(cat.product).toBe("Dance_SuperPack");
    expect(cat.maxPath).toBe("/x/MAX");
    expect(cat.pxddancePath).toBe("/x/Pxddance");
  });
});

// ── resolveProductPaths ──────────────────────────────────────

describe("resolveProductPaths", () => {
  it("returns absolute paths for a known product", () => {
    const root = resolve("/root/archive");
    const r = resolveProductPaths("Dance_SuperPack", root);
    expect(r.maxPath).toBe(
      resolve(root, "Dance_SuperPack/dance/EJAY/MAX"),
    );
    expect(r.pxddancePath).toBe(
      resolve(root, "Dance_SuperPack/dance/EJAY/Pxddance"),
    );
    expect(r.pxdtxtPath).toBeNull();
  });

  it("throws for an unknown product", () => {
    expect(() => resolveProductPaths("NotAProduct", "/root")).toThrow(
      /Unknown Gen 1 product/,
    );
  });

  it("lists every known Gen 1 product in the layout map", () => {
    expect(Object.keys(GEN1_PRODUCT_LAYOUT).sort()).toEqual([
      "Dance_SuperPack",
      "Dance_eJay1",
      "GenerationPack1_Dance",
      "GenerationPack1_HipHop",
      "GenerationPack1_Rave",
      "Rave",
    ]);
  });
});

// ── runCli (integration) ─────────────────────────────────────

describe("runCli", () => {
  it("writes a JSON catalog to the requested path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gen1-cli-"));
    try {
      const maxPath = join(tmp, "MAX");
      writeFileSync(maxPath, '"ba\\aaaf.pxd"\r\n"bb\\abbq.pxd"\r\n', "utf8");
      const outPath = join(tmp, "out.json");
      const cat = runCli({
        maxPath,
        outPath,
        archiveRoot: tmp,
        outputRoot: tmp,
      });
      expect(cat.populatedIds).toBe(2);
      expect(existsSync(outPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(outPath, "utf8"));
      expect(parsed.entries).toHaveLength(2);
      expect(parsed.entries[0].bank).toBe("BA");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when the MAX file is missing", () => {
    expect(() =>
      runCli({
        maxPath: "/definitely/not/a/real/MAX",
        archiveRoot: "/tmp",
        outputRoot: "/tmp",
      }),
    ).toThrow(/MAX catalog not found/);
  });

  it("requires either product or maxPath", () => {
    expect(() =>
      runCli({ archiveRoot: "/tmp", outputRoot: "/tmp" } as never),
    ).toThrow(/product.*maxPath/);
  });
});

// ── Live archive spot-checks (skipped when archive/ is absent) ──

describe.skipIf(!hasArchive)("live archive spot-checks", () => {
  it("Dance SuperPack MAX has 2845 IDs and resolves known START.MIX refs", () => {
    const cat = runCli({
      product: "Dance_SuperPack",
      archiveRoot: ARCHIVE,
      outputRoot: mkdtempSync(join(tmpdir(), "gen1-live-")),
    });
    expect(cat.totalIds).toBe(2845);
    // IDs observed in the hex dump of Dance 1 START.MIX.
    expect(cat.entries[1231].path).toBe("ai/bvjp.pxd");
    expect(cat.entries[746].path).toBe("bt/bcsp.pxd");
    expect(cat.entries[1919].path).toBe("dmkit2/04/fx316.pxd");
    // Pxddance enrichment should populate the base-kit range.
    expect(cat.entries[1231].category).not.toBeNull();
  });

  it("Rave MAX parses to 3146 unquoted entries", () => {
    const cat = runCli({
      product: "Rave",
      archiveRoot: ARCHIVE,
      outputRoot: mkdtempSync(join(tmpdir(), "gen1-live-")),
    });
    expect(cat.totalIds).toBe(3146);
    expect(cat.entries[0].path).toBe("ba/r1da006.pxd");
    expect(cat.entries[0].bank).toBe("BA");
  });

  it("GP1-HipHop MAX parses to 1381 entries", () => {
    const cat = runCli({
      product: "GenerationPack1_HipHop",
      archiveRoot: ARCHIVE,
      outputRoot: mkdtempSync(join(tmpdir(), "gen1-live-")),
    });
    expect(cat.totalIds).toBe(1381);
    expect(cat.entries[0].path).toBe("ba/h1bs005.pxd");
  });

  it("Dance eJay 1 MAX.TXT enriches categories from PXD.TXT", () => {
    const cat = runCli({
      product: "Dance_eJay1",
      archiveRoot: ARCHIVE,
      outputRoot: mkdtempSync(join(tmpdir(), "gen1-live-")),
    });
    // MAX.TXT has 1352 IDs and PXD.TXT covers all nine tabs.
    expect(cat.totalIds).toBe(1352);
    expect(cat.entries[0].category).toBe("loop"); // IDs 0–125
    expect(cat.entries[200].category).toBe("drum"); // IDs 126–239
    expect(cat.entries[300].category).toBe("bass"); // IDs 240–354
    expect(cat.entries[1300].category).toBe("xtra"); // IDs 1192–1351
  });
});
