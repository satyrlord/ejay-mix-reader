import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { describe, expect, it } from "vitest";

import {
  buildProductIndexes,
  buildResolverIndex,
  canonicalizeProduct,
  gen1CatalogCandidates,
  loadGen1Catalogs,
  PRODUCT_ALIASES,
  PRODUCT_FALLBACKS,
  productsFromCatalogs,
  resolveMix,
  type NormalizedMetadata,
  type NormalizedSample,
} from "../mix-resolver.js";
import type { CatalogEntry, MixIR, TrackPlacement } from "../mix-types.js";
import { buildGen1Catalog, type Gen1Catalog } from "../gen1-catalog.js";

// ── Fixtures ─────────────────────────────────────────────────

function makeSample(overrides: Partial<NormalizedSample>): NormalizedSample {
  return {
    filename: "sample.wav",
    product: "Dance_eJay2",
    category: "Drum",
    subcategory: "perc",
    alias: null,
    source: null,
    internal_name: null,
    sample_id: null,
    ...overrides,
  };
}

function makeMix(overrides: Partial<MixIR> = {}): MixIR {
  return {
    format: "B",
    product: "Dance_eJay2",
    appId: 0x00000a09,
    bpm: 140,
    bpmAdjusted: null,
    author: null,
    title: null,
    registration: null,
    tracks: [],
    mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
    drumMachine: null,
    tickerText: [],
    catalogs: [],
    ...overrides,
  };
}

function makeTrack(
  refOverrides: Partial<TrackPlacement["sampleRef"]>,
  beat = 0,
  channel = 0,
): TrackPlacement {
  return {
    beat,
    channel,
    sampleRef: {
      rawId: 0,
      internalName: null,
      displayName: null,
      resolvedPath: null,
      dataLength: null,
      ...refOverrides,
    },
  };
}

interface InfSampleRow {
  sampleId: number;
  filename: string;
  category: string;
  alias: string;
}

function writeInfCatalog(infPath: string, rows: readonly InfSampleRow[]): void {
  const lines: string[] = ["[SAMPLES]"];
  for (const row of rows) {
    lines.push(
      String(row.sampleId),
      "0",
      `"${row.filename}"`,
      "0",
      "128",
      `"${row.category}"`,
      `"${row.alias}"`,
      "0",
      "0",
      "0",
      "0",
      "0",
    );
  }
  mkdirSync(dirname(infPath), { recursive: true });
  writeFileSync(infPath, lines.join("\r\n"), "ascii");
}

const DANCE1_SAMPLES: NormalizedSample[] = [
  makeSample({
    product: "Dance_eJay1",
    filename: "BINP.wav",
    category: "Voice",
    subcategory: "misc",
    source: "AA/BINP.PXD",
    alias: "Come on!",
  }),
  makeSample({
    product: "Dance_eJay1",
    filename: "BIPO.wav",
    category: "Loop",
    subcategory: null,
    source: "AA/BIPO.PXD",
    alias: "Perc.L",
  }),
];

const DANCE2_SAMPLES: NormalizedSample[] = [
  makeSample({
    product: "Dance_eJay2",
    filename: "D5MG539.wav",
    category: "Drum",
    subcategory: "perc",
    internal_name: "D5MG539",
    sample_id: 1930,
    alias: "9",
  }),
];

const DANCE3_SAMPLES: NormalizedSample[] = [
  makeSample({
    product: "Dance_eJay3",
    filename: "kick28.wav",
    category: "Drum",
    subcategory: "kick",
    sample_id: 16900,
    alias: "kick28",
  }),
  makeSample({
    product: "Dance_eJay3",
    filename: "kick67.wav",
    category: "Drum",
    subcategory: "kick",
    alias: "kick67",
  }),
];

// Synthetic Gen 1 catalog: MAX file where line 1 = "aa/binp.pxd".
const DANCE1_GEN1: Gen1Catalog = buildGen1Catalog({
  maxText: '""\r\n"aa\\binp.pxd"\r\n"aa\\bipo.pxd"\r\n',
  product: "Dance_eJay1",
  maxPath: "/virtual/MAX",
});

// ── canonicalizeProduct ──────────────────────────────────────

describe("canonicalizeProduct", () => {
  it("folds parser-emitted aliases to canonical ids", () => {
    expect(canonicalizeProduct("Dance_eJay_30")).toBe("Dance_eJay3");
    expect(canonicalizeProduct("HipHop_eJay_40")).toBe("HipHop_eJay4");
    expect(canonicalizeProduct("House_eJay_10")).toBe("House_eJay");
  });

  it("passes canonical names through unchanged", () => {
    expect(canonicalizeProduct("Dance_eJay1")).toBe("Dance_eJay1");
    expect(canonicalizeProduct("SampleKit_DMKIT1")).toBe("SampleKit_DMKIT1");
  });

  it("exposes the alias and fallback tables for downstream tooling", () => {
    expect(PRODUCT_ALIASES.Dance_eJay_20).toBe("Dance_eJay2");
    expect(PRODUCT_FALLBACKS.Dance_eJay1).toContain("Dance_SuperPack");
    expect(PRODUCT_FALLBACKS.Dance_eJay4).toContain("Dance_eJay3");
    expect(PRODUCT_FALLBACKS.HipHop_eJay1).toContain("GenerationPack1_HipHop");
    expect(PRODUCT_FALLBACKS.HipHop_eJay1).toContain("HipHop_eJay2");
    expect(PRODUCT_FALLBACKS.GenerationPack1_HipHop).toContain("HipHop_eJay3");
    expect(PRODUCT_FALLBACKS.HipHop_eJay3).toContain("Dance_eJay3");
    expect(PRODUCT_FALLBACKS.Techno_eJay3).toContain("Dance_eJay3");
  });

  it("exposes product-local Gen 1 catalog candidates", () => {
    expect(gen1CatalogCandidates("Dance_eJay1")).toEqual([
      "Dance_eJay1",
      "Dance_SuperPack",
      "GenerationPack1_Dance",
    ]);
    expect(gen1CatalogCandidates("HipHop_eJay1")).toEqual([
      "HipHop_eJay1",
      "GenerationPack1_HipHop",
    ]);
    expect(gen1CatalogCandidates("Unknown")).toEqual(["Unknown"]);
  });
});

// ── productsFromCatalogs ─────────────────────────────────────

describe("productsFromCatalogs", () => {
  it("maps MixIR catalog names to canonical fallback products", () => {
    const catalogs: CatalogEntry[] = [
      { name: "Dance eJay 1.01", idRangeStart: 0, idRangeEnd: 1351 },
      { name: "DanceMachine Sample-Kit Vol. 2", idRangeStart: 1352, idRangeEnd: 2100 },
    ];
    expect(productsFromCatalogs(catalogs)).toEqual([
      "Dance_eJay1",
      "SampleKit_DMKIT2",
    ]);
  });

  it("returns empty when no pattern matches", () => {
    expect(productsFromCatalogs([{ name: "Mystery Pack", idRangeStart: 0, idRangeEnd: 10 }]))
      .toEqual([]);
  });
});

// ── buildProductIndexes ──────────────────────────────────────

describe("buildProductIndexes", () => {
  it("groups samples by product and exposes all four lookup maps", () => {
    const idxs = buildProductIndexes({
      samples: [...DANCE1_SAMPLES, ...DANCE2_SAMPLES],
    });
    expect([...idxs.keys()].sort()).toEqual(["Dance_eJay1", "Dance_eJay2"]);
    const d2 = idxs.get("Dance_eJay2")!;
    expect(d2.bySampleId.get(1930)?.filename).toBe("D5MG539.wav");
    expect(d2.byInternalName.get("d5mg539")?.filename).toBe("D5MG539.wav");
    expect(d2.byAlias.get("9")?.[0]?.filename).toBe("D5MG539.wav");
    expect(d2.byStem.get("d5mg539")?.filename).toBe("D5MG539.wav");

    const d1 = idxs.get("Dance_eJay1")!;
    expect(d1.bySource.get("aa/binp.pxd")?.filename).toBe("BINP.wav");
    expect(d1.byStem.get("binp")?.filename).toBe("BINP.wav");
  });

  it("skips samples that are missing the product field", () => {
    const idxs = buildProductIndexes({
      samples: [makeSample({ product: "" })],
    });
    expect(idxs.size).toBe(0);
  });

  it("collects alias collisions into arrays", () => {
    const idxs = buildProductIndexes({
      samples: [
        makeSample({ product: "X", filename: "a.wav", alias: "kick" }),
        makeSample({ product: "X", filename: "b.wav", alias: "Kick" }),
      ],
    });
    expect(idxs.get("X")!.byAlias.get("kick")?.length).toBe(2);
  });
});

// ── loadGen1Catalogs ─────────────────────────────────────────

describe("loadGen1Catalogs", () => {
  it("returns empty map when archive root is absent", () => {
    expect(loadGen1Catalogs("/definitely/not/a/real/path").size).toBe(0);
  });

  it("reads MAX files from a real archive layout", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-"));
    try {
      const maxDir = join(root, "Rave eJay", "eJay", "eJay");
      mkdirSync(maxDir, { recursive: true });
      writeFileSync(
        join(maxDir, "MAX"),
        "ba\\aaaa.pxd\r\nba\\aaab.pxd\r\n",
        "utf8",
      );
      const catalogs = loadGen1Catalogs(root);
      expect(catalogs.has("Rave")).toBe(true);
      expect(catalogs.get("Rave")!.entries.length).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("splices SuperPack sample-kit catalogs when the kit files are present", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-kit-"));
    try {
      const baseDir = join(root, "Dance_SuperPack", "dance", "EJAY");
      mkdirSync(baseDir, { recursive: true });
      writeFileSync(join(baseDir, "MAX"), '"aa\\base001.pxd"\r\n', "utf8");
      writeFileSync(join(baseDir, "Pxddance"), "", "utf8");
      writeFileSync(
        join(baseDir, "kit1.txt"),
        ['"01\\rap301.pxd"', '""', '"rap"', '"2"', '"grp"', '"vers"'].join("\r\n") + "\r\n",
        "utf8",
      );
      writeFileSync(
        join(baseDir, "kit2.txt"),
        ['"01\\bass301.pxd"', '""', '"bass"', '"2"', '"grp"', '"vers"'].join("\r\n") + "\r\n",
        "utf8",
      );
      writeFileSync(
        join(baseDir, "kit3.txt"),
        ['"01\\d4sp001l.pxd"', '""', '"effect"', '"2"', '"grp"', '"vers"'].join("\r\n") + "\r\n",
        "utf8",
      );

      const catalogs = loadGen1Catalogs(root);
      const superpack = catalogs.get("Dance_SuperPack");
      expect(superpack).toBeDefined();
      expect(superpack!.entries[3400].path).toBe("01/rap301.pxd");
      expect(superpack!.entries[3900].path).toBe("01/bass301.pxd");
      expect(superpack!.entries[4500].path).toBe("dmkit3/01/d4sp001l.pxd");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── buildResolverIndex ───────────────────────────────────────

describe("buildResolverIndex", () => {
  it("uses provided Gen 1 catalogs without touching disk", () => {
    const gen1 = new Map([["Dance_eJay1", DANCE1_GEN1]]);
    const idx = buildResolverIndex({
      metadata: { samples: DANCE1_SAMPLES },
      outputRoot: "/virtual/output",
      archiveRoot: "/virtual/archive",
      gen1Catalogs: gen1,
    });
    expect(idx.products.has("Dance_eJay1")).toBe(true);
    expect(idx.gen1.get("Dance_eJay1")).toBe(DANCE1_GEN1);
  });

  it("defaults outputRoot/archiveRoot when omitted", () => {
    const idx = buildResolverIndex({
      metadata: { samples: [] },
      gen1Catalogs: new Map(),
    });
    expect(idx.outputRoot.length).toBeGreaterThan(0);
    expect(idx.archiveRoot.length).toBeGreaterThan(0);
  });

  it("propagates the Gen 1 alias catalog for HipHop eJay 1", () => {
    const gp1Catalog = buildGen1Catalog({
      maxText: '"ba\\h1bs005.pxd"\r\n',
      product: "GenerationPack1_HipHop",
      maxPath: "/virtual/MAX",
    });
    const idx = buildResolverIndex({
      metadata: { samples: [] },
      gen1Catalogs: new Map([["GenerationPack1_HipHop", gp1Catalog]]),
    });
    expect(idx.gen1.get("HipHop_eJay1")).toBe(gp1Catalog);
  });

  it("propagates reverse HipHop aliases when only HipHop eJay 1 is loaded", () => {
    const hiphop1Catalog = buildGen1Catalog({
      maxText: '"ba\\h1bs005.pxd"\r\n',
      product: "HipHop_eJay1",
      maxPath: "/virtual/MAX",
    });
    const idx = buildResolverIndex({
      metadata: { samples: [] },
      gen1Catalogs: new Map([["HipHop_eJay1", hiphop1Catalog]]),
    });
    expect(idx.gen1.get("GenerationPack1_HipHop")).toBe(hiphop1Catalog);
  });

  it("adds compound and hyphen-stripped aliases from Gen 2 INF catalogs", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-inf-stripped-"));
    try {
      writeInfCatalog(join(root, "Dance_eJay2", "D_ejay2", "PXD", "DANCE20.INF"), [
        {
          sampleId: 1,
          filename: "D5MG539",
          category: "dara-",
          alias: "buka2",
        },
      ]);

      const idx = buildResolverIndex({
        metadata: {
          samples: [
            makeSample({
              product: "Dance_eJay2",
              filename: "D5MG539.wav",
              category: "Drum",
              subcategory: "perc",
              internal_name: "D5MG539",
            }),
          ],
        },
        archiveRoot: root,
        gen1Catalogs: new Map(),
      });

      const dance2 = idx.products.get("Dance_eJay2")!;
      expect(dance2.byInternalName.get("dara-buka2")?.filename).toBe("D5MG539.wav");
      expect(dance2.byInternalName.get("darabuka2")?.filename).toBe("D5MG539.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads Dance eJay 2 compound aliases from the D_EJAY2 archive path variant", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-dance2-inf-alias-"));
    try {
      writeInfCatalog(join(root, "Dance eJay 2", "D_EJAY2", "PXD", "DANCE20.INF"), [
        {
          sampleId: 1,
          filename: "D5MA066",
          category: "euro",
          alias: "kick5",
        },
      ]);

      const idx = buildResolverIndex({
        metadata: {
          samples: [
            makeSample({
              product: "Dance_eJay2",
              filename: "D5MA066.wav",
              category: "Drum",
              subcategory: "kick",
              internal_name: "D5MA066",
            }),
          ],
        },
        archiveRoot: root,
        gen1Catalogs: new Map(),
      });

      const dance2 = idx.products.get("Dance_eJay2")!;
      expect(dance2.byInternalName.get("eurokick5")?.filename).toBe("D5MA066.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves existing stripped-key mappings when adding compound aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-inf-collision-"));
    try {
      writeInfCatalog(join(root, "Dance_eJay2", "D_ejay2", "PXD", "DANCE20.INF"), [
        {
          sampleId: 1,
          filename: "SRC01",
          category: "dara-",
          alias: "buka2",
        },
      ]);

      const idx = buildResolverIndex({
        metadata: {
          samples: [
            makeSample({
              product: "Dance_eJay2",
              filename: "TARGET.wav",
              category: "Drum",
              subcategory: "perc",
              internal_name: "SRC01",
            }),
            makeSample({
              product: "Dance_eJay2",
              filename: "EXISTING.wav",
              category: "Drum",
              subcategory: "perc",
              internal_name: "darabuka2",
            }),
          ],
        },
        archiveRoot: root,
        gen1Catalogs: new Map(),
      });

      const dance2 = idx.products.get("Dance_eJay2")!;
      expect(dance2.byInternalName.get("dara-buka2")?.filename).toBe("TARGET.wav");
      expect(dance2.byInternalName.get("darabuka2")?.filename).toBe("EXISTING.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads Techno eJay compound aliases from the recreated archive folder path", () => {
    const root = mkdtempSync(join(tmpdir(), "ejay-resolver-techno-inf-alias-"));
    try {
      writeInfCatalog(join(root, "Techno eJay 2", "eJay", "PXD", "rave20.inf"), [
        {
          sampleId: 1,
          filename: "R5MA030",
          category: "euro",
          alias: "kick5",
        },
      ]);

      const idx = buildResolverIndex({
        metadata: {
          samples: [
            makeSample({
              product: "Techno_eJay",
              filename: "R5MA030.wav",
              category: "Drum",
              subcategory: "kick",
              internal_name: "R5MA030",
            }),
          ],
        },
        archiveRoot: root,
        gen1Catalogs: new Map(),
      });

      const techno = idx.products.get("Techno_eJay")!;
      expect(techno.byInternalName.get("eurokick5")?.filename).toBe("R5MA030.wav");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── resolveMix ───────────────────────────────────────────────

describe("resolveMix — Format A (Gen 1)", () => {
  const metadata: NormalizedMetadata = { samples: DANCE1_SAMPLES };
  const index = buildResolverIndex({
    metadata,
    gen1Catalogs: new Map([["Dance_eJay1", DANCE1_GEN1]]),
    outputRoot: "/virtual/output",
    archiveRoot: "/virtual/archive",
  });

  it("resolves rawId via the MAX catalog and matches metadata.source", () => {
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      tracks: [makeTrack({ rawId: 1 }), makeTrack({ rawId: 2 }, 4, 1)],
    });
    const report = resolveMix(mix, index);
    expect(report.total).toBe(2);
    expect(report.resolved).toBe(2);
    expect(report.unresolved).toBe(0);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Voice/misc/BINP.wav");
    expect(report.tracks[1].sampleRef.resolvedPath).toBe("Loop/BIPO.wav");
  });

  it("warns on unresolved rawIds but never mutates input", () => {
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      tracks: [makeTrack({ rawId: 9999 })],
    });
    const report = resolveMix(mix, index);
    expect(report.resolved).toBe(0);
    expect(report.unresolved).toBe(1);
    expect(report.warnings[0]).toMatch(/rawId=9999/);
    expect(mix.tracks[0].sampleRef.resolvedPath).toBeNull();
  });
});

describe("resolveMix — Format B (Gen 2)", () => {
  const metadata: NormalizedMetadata = { samples: DANCE2_SAMPLES };
  const index = buildResolverIndex({
    metadata,
    gen1Catalogs: new Map(),
    outputRoot: "/virtual/output",
  });

  it("resolves via sample_id when available", () => {
    const mix = makeMix({
      tracks: [makeTrack({ rawId: 1930, internalName: "humn.9" })],
    });
    const report = resolveMix(mix, index);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Drum/perc/D5MG539.wav");
  });

  it("falls back to internalName stem when id is out of range", () => {
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "Dance_eJay2",
            filename: "HUMN.wav",
            category: "Bass",
            subcategory: null,
            internal_name: "humn",
          }),
        ],
      },
      gen1Catalogs: new Map(),
    });
    const mix = makeMix({
      tracks: [makeTrack({ rawId: 0, internalName: "humn.9" })],
    });
    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Bass/HUMN.wav");
  });
});

describe("resolveMix — Format C/D (Gen 3)", () => {
  const index = buildResolverIndex({
    metadata: { samples: DANCE3_SAMPLES },
    gen1Catalogs: new Map(),
  });

  it("resolves displayName against the alias index (canonicalising product)", () => {
    const mix = makeMix({
      format: "C",
      product: "Dance_eJay_30", // parser-emitted variant
      tracks: [
        makeTrack({ rawId: 2, displayName: "kick28" }),
        makeTrack({ rawId: -2, displayName: "kick67" }),
      ],
    });
    const report = resolveMix(mix, index);
    expect(report.resolved).toBe(2);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Drum/kick/kick28.wav");
    expect(report.tracks[1].sampleRef.resolvedPath).toBe("Drum/kick/kick67.wav");
  });

  it("reports unresolved refs with a descriptive hint", () => {
    const mix = makeMix({
      format: "C",
      product: "Dance_eJay3",
      tracks: [makeTrack({ rawId: 0, displayName: "mystery-pad" })],
    });
    const report = resolveMix(mix, index);
    expect(report.unresolved).toBe(1);
    expect(report.warnings[0]).toMatch(/display=mystery-pad/);
    expect(report.warnings[0]).toMatch(/tried:/);
  });
});

describe("resolveMix — cross-product fallback", () => {
  it("spills into SuperPack when the primary catalog cannot resolve the id", () => {
    const superpackCatalog = buildGen1Catalog({
      maxText: ['""', '"aa\\spill.pxd"'].join("\r\n") + "\r\n",
      product: "Dance_SuperPack",
      maxPath: "/virtual/MAX",
    });
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "Dance_SuperPack",
            filename: "SPILL.wav",
            category: "Keys",
            subcategory: null,
            source: "AA/SPILL.PXD",
          }),
        ],
      },
      gen1Catalogs: new Map([["Dance_SuperPack", superpackCatalog]]),
    });
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      tracks: [makeTrack({ rawId: 1 })],
    });
    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Keys/SPILL.wav");
  });

  it("honours catalog hints on the MixIR", () => {
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "SampleKit_DMKIT1",
            filename: "KIT.wav",
            category: "Drum",
            subcategory: "kick",
            sample_id: 5000,
            alias: "kit",
          }),
        ],
      },
      gen1Catalogs: new Map(),
    });
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      catalogs: [
        { name: "DanceMachine Sample-Kit Vol. 1", idRangeStart: 4000, idRangeEnd: 6000 },
      ],
      tracks: [makeTrack({ rawId: 5000, displayName: "kit" })],
    });
    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Drum/kick/KIT.wav");
  });

  it("falls back across products via Gen 1 stem lookup when bySource misses", () => {
    const superpackCatalog = buildGen1Catalog({
      maxText: '""\r\n""\r\n',
      kitCatalogs: [
        {
          offset: 5,
          text: ['"01\\kitstem.pxd"', '""', '"drum"', '"2"', '"grp"', '"vers"'].join("\r\n") + "\r\n",
        },
      ],
      product: "Dance_SuperPack",
      maxPath: "/virtual/MAX",
    });
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "SampleKit_DMKIT1",
            filename: "KITSTEM.wav",
            category: "Drum",
            subcategory: "kick",
            source: null,
          }),
        ],
      },
      gen1Catalogs: new Map([["Dance_SuperPack", superpackCatalog]]),
    });
    const mix = makeMix({
      format: "A",
      product: "Dance_SuperPack",
      tracks: [makeTrack({ rawId: 5 })],
    });
    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Drum/kick/KITSTEM.wav");
  });

  it("prefers the declared fallback order for cross-product Gen 1 matches", () => {
    const superpackCatalog = buildGen1Catalog({
      maxText: '""\r\n""\r\n',
      kitCatalogs: [
        {
          offset: 5,
          text: ['"01\\shared.pxd"', '""', '"drum"', '"2"', '"grp"', '"vers"'].join("\r\n") + "\r\n",
        },
      ],
      product: "Dance_SuperPack",
      maxPath: "/virtual/MAX",
    });
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "SampleKit_DMKIT2",
            filename: "WRONG.wav",
            category: "Extra",
            subcategory: null,
            source: "01/SHARED.PXD",
          }),
          makeSample({
            product: "SampleKit_DMKIT1",
            filename: "RIGHT.wav",
            category: "Drum",
            subcategory: "kick",
            source: "01/SHARED.PXD",
          }),
        ],
      },
      gen1Catalogs: new Map([["Dance_SuperPack", superpackCatalog]]),
    });
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      tracks: [makeTrack({ rawId: 5 })],
    });

    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Drum/kick/RIGHT.wav");
  });

  it("resolves shared alias-only names through the Dance eJay 3 fallback chain", () => {
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          ...DANCE3_SAMPLES,
          makeSample({
            product: "Dance_eJay3",
            filename: "clap12.wav",
            category: "Drum",
            subcategory: "clap",
            alias: "clap12",
          }),
        ],
      },
      gen1Catalogs: new Map(),
    });

    const hipHopReport = resolveMix(
      makeMix({
        format: "C",
        product: "HipHop_eJay3",
        tracks: [makeTrack({ rawId: 0, displayName: "clap12" })],
      }),
      idx,
    );
    expect(hipHopReport.resolved).toBe(1);
    expect(hipHopReport.tracks[0].sampleRef.resolvedPath).toBe("Drum/clap/clap12.wav");

    const technoReport = resolveMix(
      makeMix({
        format: "C",
        product: "Techno_eJay3",
        tracks: [makeTrack({ rawId: 0, displayName: "clap12" })],
      }),
      idx,
    );
    expect(technoReport.resolved).toBe(1);
    expect(technoReport.tracks[0].sampleRef.resolvedPath).toBe("Drum/clap/clap12.wav");

    const dance4Report = resolveMix(
      makeMix({
        format: "C",
        product: "Dance_eJay4",
        tracks: [makeTrack({ rawId: 0, displayName: "clap12" })],
      }),
      idx,
    );
    expect(dance4Report.resolved).toBe(1);
    expect(dance4Report.tracks[0].sampleRef.resolvedPath).toBe("Drum/clap/clap12.wav");
  });
});

describe("resolveMix — empty input", () => {
  it("returns a zero report for a MixIR with no tracks", () => {
    const idx = buildResolverIndex({
      metadata: { samples: [] },
      gen1Catalogs: new Map(),
    });
    const report = resolveMix(makeMix(), idx);
    expect(report).toEqual({
      total: 0,
      resolved: 0,
      unresolved: 0,
      warnings: [],
      tracks: [],
    });
  });

  it("describes unresolved refs without identifiers as <no identifiers>", () => {
    const idx = buildResolverIndex({
      metadata: { samples: [] },
      gen1Catalogs: new Map(),
    });
    const mix = makeMix({
      tracks: [makeTrack({ rawId: 0 })],
    });
    const report = resolveMix(mix, idx);
    expect(report.unresolved).toBe(1);
    expect(report.warnings[0]).toMatch(/<no identifiers>/);
  });

  it("falls back to Gen 1 stem lookup when bySource misses", () => {
    const gen1: Gen1Catalog = buildGen1Catalog({
      maxText: '""\r\n"aa\\stemonly.pxd"\r\n',
      product: "Dance_eJay1",
      maxPath: "/virtual/MAX",
    });
    // Sample has no `source` field — forces the stem path in lookupInProduct.
    const idx = buildResolverIndex({
      metadata: {
        samples: [
          makeSample({
            product: "Dance_eJay1",
            filename: "STEMONLY.wav",
            category: "Bass",
            subcategory: null,
            source: null,
          }),
        ],
      },
      gen1Catalogs: new Map([["Dance_eJay1", gen1]]),
    });
    const mix = makeMix({
      format: "A",
      product: "Dance_eJay1",
      tracks: [makeTrack({ rawId: 1 })],
    });
    const report = resolveMix(mix, idx);
    expect(report.resolved).toBe(1);
    expect(report.tracks[0].sampleRef.resolvedPath).toBe("Bass/STEMONLY.wav");
  });
});
