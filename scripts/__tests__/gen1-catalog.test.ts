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
  mkdirSync,
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
    const text = '"0"\r\n"10"\r\n"not a number"\r\n"25"\r\n';
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

  it("splices sample-kit records at fixed offsets", () => {
    const cat = buildGen1Catalog({
      maxText: ['"aa\\base001.pxd"', '""'].join("\n"),
      kitCatalogs: [
        {
          offset: 3,
          text: [
            '"01\\rap301.pxd"',
            '""',
            '"rap"',
            '"2"',
            '"save the"',
            '"planet[1]"',
          ].join("\n"),
        },
        {
          offset: 5,
          pathPrefix: "dmkit3/",
          text: [
            '"01\\d4sp001l.pxd"',
            '""',
            '"effect"',
            '"2"',
            '"space"',
            '"vers1"',
          ].join("\n"),
        },
      ],
      maxPath: "C:/archive/MAX",
    });

    expect(cat.totalIds).toBe(6);
    expect(cat.populatedIds).toBe(3);
    expect(cat.entries[0].path).toBe("aa/base001.pxd");
    expect(cat.entries[3]).toMatchObject({
      id: 3,
      path: "01/rap301.pxd",
      file: "RAP301",
      category: "rap",
      group: "save the",
      version: "planet[1]",
    });
    expect(cat.entries[5]).toMatchObject({
      id: 5,
      path: "dmkit3/01/d4sp001l.pxd",
      file: "D4SP001L",
      category: "effect",
      group: "space",
      version: "vers1",
    });
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
      "HipHop_eJay1",
      "Rave",
    ]);
  });

  it("returns sample-kit overlays for Dance eJay 1", () => {
    const resolved = resolveProductPaths("Dance_eJay1", "D:/archive");
    expect(
      resolved.kitCatalogPaths.map((kit) => ({
        ...kit,
        path: kit.path.replace(/\\/g, "/"),
      })),
    ).toEqual([
      {
        path: "D:/archive/Dance eJay 1/eJay/eJay/kit1.txt",
        offset: 3400,
        pathPrefix: "dmkit1/",
      },
      {
        path: "D:/archive/Dance eJay 1/eJay/eJay/kit2.txt",
        offset: 3900,
        pathPrefix: "dmkit2/",
      },
      {
        path: "D:/archive/Dance eJay 1/eJay/eJay/kit3.txt",
        offset: 4500,
        pathPrefix: "dmkit3/",
      },
    ]);
  });

  it("falls back to HipHop h/eJay/eJay MAX when classic path is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gen1-hiphop-path-"));
    try {
      const fallbackMax = join(tmp, "HipHop eJay 1", "h", "eJay", "eJay", "MAX");
      mkdirSync(join(tmp, "HipHop eJay 1", "h", "eJay", "eJay"), { recursive: true });
      writeFileSync(fallbackMax, '"ba\\test.pxd"\r\n', "utf8");

      const resolved = resolveProductPaths("HipHop_eJay1", tmp);
      expect(resolved.maxPath).toBe(resolve(fallbackMax));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns sample-kit overlays for Dance SuperPack", () => {
    const resolved = resolveProductPaths("Dance_SuperPack", "D:/archive");
    expect(
      resolved.kitCatalogPaths.map((kit) => ({
        ...kit,
        path: kit.path.replace(/\\/g, "/"),
      })),
    ).toEqual([
      {
        path: "D:/archive/Dance_SuperPack/dance/EJAY/kit1.txt",
        offset: 3400,
        pathPrefix: undefined,
      },
      {
        path: "D:/archive/Dance_SuperPack/dance/EJAY/kit2.txt",
        offset: 3900,
        pathPrefix: undefined,
      },
      {
        path: "D:/archive/Dance_SuperPack/dance/EJAY/kit3.txt",
        offset: 4500,
        pathPrefix: "dmkit3/",
      },
    ]);
  });

  it("reuses the SuperPack sample-kit catalogs for GP1 Dance", () => {
    const resolved = resolveProductPaths("GenerationPack1_Dance", "D:/archive");
    expect(
      resolved.kitCatalogPaths.map((kit) => kit.path.replace(/\\/g, "/")),
    ).toEqual([
      "D:/archive/Dance_SuperPack/dance/EJAY/kit1.txt",
      "D:/archive/Dance_SuperPack/dance/EJAY/kit2.txt",
      "D:/archive/Dance_SuperPack/dance/EJAY/kit3.txt",
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

  it("resolves product paths and splices available sample-kit catalogs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gen1-product-cli-"));
    try {
      const productRoot = join(tmp, "Dance eJay 1", "eJay", "eJay");
      mkdirSync(productRoot, { recursive: true });

      writeFileSync(join(productRoot, "MAX"), '"ba\\aaaf.pxd"\r\n', "utf8");
      writeFileSync(
        join(productRoot, "kit1.txt"),
        [
          '"01\\rap301.pxd"',
          '""',
          '"rap"',
          '"2"',
          '"grp"',
          '"vers"',
          "",
        ].join("\r\n"),
        "utf8",
      );

      const cat = runCli({
        product: "Dance_eJay1",
        archiveRoot: tmp,
        outputRoot: tmp,
      });

      expect(cat.product).toBe("Dance_eJay1");
      expect(cat.entries[3400]).toMatchObject({
        path: "dmkit1/01/rap301.pxd",
        category: "rap",
        group: "grp",
        version: "vers",
      });
      expect(existsSync(join(tmp, "Dance_eJay1", "gen1-catalog.json"))).toBe(true);
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
  // Dance_SuperPack was removed from the archive in April 2026 (folder no
  // longer present). The catalog/resolver code paths still exist but the
  // archive-spot-check that depended on the on-disk MAX file has been removed.

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

  // GenerationPack1 was removed from the archive in April 2026; the
  // GP1-HipHop catalog spot-check has been removed along with the folder.

  it("Dance eJay 1 includes SampleKit overlays and category enrichment", () => {
    const cat = runCli({
      product: "Dance_eJay1",
      archiveRoot: ARCHIVE,
      outputRoot: mkdtempSync(join(tmpdir(), "gen1-live-")),
    });
    // In the recreated archive, Dance eJay 1 resolves through eJay/eJay/MAX
    // + Pxddance and splices local kit1/2/3 overlays at fixed offsets.
    expect(cat.totalIds).toBe(5050);
    expect(cat.populatedIds).toBe(4338);
    expect(cat.entries[3400].path).toBe("dmkit1/01/rap301.pxd");
    expect(cat.entries[3900].path).toBe("dmkit2/01/bass301.pxd");
    expect(cat.entries[4500].path).toBe("dmkit3/01/d4sp001l.pxd");
    expect(cat.entries[0].category).toBe("effect");
    expect(cat.entries[200].category).toBe("effect");
    expect(cat.entries[300].category).toBe("rap");
    expect(cat.entries[1300].category).toBe("layer");
  });
});
