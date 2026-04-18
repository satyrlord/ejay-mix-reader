import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  buildProductIndexes,
  buildResolverIndex,
  canonicalizeProduct,
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
    expect(PRODUCT_FALLBACKS.HipHop_eJay1).toContain("GenerationPack1_HipHop");
    expect(PRODUCT_FALLBACKS.HipHop_eJay1).toContain("HipHop_eJay2");
    expect(PRODUCT_FALLBACKS.GenerationPack1_HipHop).toContain("HipHop_eJay3");
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
      const maxDir = join(root, "Rave", "RAVE", "EJAY");
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
