#!/usr/bin/env tsx

/**
 * One-shot investigation script for the Format A "Remaining Follow-ups"
 * documented in docs/mix-format-analysis.md:
 *
 *   1. Column-to-channel assignment
 *   2. headerAux semantics (uint16 @ 0x02)
 *   3. Extended trailer vocabulary (path-like strings)
 *
 * Walks every Gen 1 .mix in archive/, joins each cell against the
 * per-product Gen 1 catalog (MAX + Pxddance/PXD.TXT) to recover the
 * channel category, and prints aggregate stats.
 *
 * Run:  npx tsx scripts/investigate-mix-followups.ts
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";

import { analyzeFormatA, listMixFiles, FORMAT_A_COLS } from "./mix-grid-analyzer.js";
import {
  buildGen1Catalog,
  GEN1_PRODUCT_LAYOUT,
  type Gen1Catalog,
} from "./gen1-catalog.js";

const ARCHIVE = resolve("archive");

// Map Gen-1 product key (catalog) to .mix folder + appId family.
const PRODUCT_MIX_DIRS: Record<string, { dir: string; appId: number }[]> = {
  Dance_eJay1: [{ dir: "Dance_eJay1/MIX", appId: 0x0a06 }],
  Dance_SuperPack: [{ dir: "Dance_SuperPack/MIX", appId: 0x0a06 }],
  GenerationPack1_Dance: [{ dir: "GenerationPack1/Dance/MIX", appId: 0x0a06 }],
  Rave: [{ dir: "Rave/MIX", appId: 0x0a07 }],
  GenerationPack1_Rave: [{ dir: "GenerationPack1/Rave/MIX", appId: 0x0a07 }],
  GenerationPack1_HipHop: [{ dir: "GenerationPack1/HipHop/MIX", appId: 0x0a08 }],
};

function loadCatalog(productKey: string): Gen1Catalog {
  const layout = GEN1_PRODUCT_LAYOUT[productKey];
  if (!layout) throw new Error(`No layout for ${productKey}`);
  const maxText = readFileSync(join(ARCHIVE, layout.max), "utf8");
  const pxddanceText = layout.pxddance
    ? readFileSync(join(ARCHIVE, layout.pxddance), "utf8")
    : undefined;
  const pxdtxtText = layout.pxdtxt
    ? readFileSync(join(ARCHIVE, layout.pxdtxt), "utf8")
    : undefined;
  return buildGen1Catalog({
    maxText,
    pxddanceText,
    pxdtxtText,
    product: productKey,
    maxPath: layout.max,
    pxddancePath: layout.pxddance ?? null,
  });
}

interface ColCatRow {
  product: string;
  totals: Map<number, Map<string, number>>; // col -> category -> count
  unknownByCol: Map<number, number>;
}

function normaliseCategory(raw: string | null): string {
  if (!raw) return "<unknown>";
  return raw.toLowerCase().trim();
}

function investigate(): void {
  const allHeaderAux: { product: string; file: string; aux: number; gridEnd: number; cellCount: number }[] = [];
  const trailerPaths: { file: string; str: string }[] = [];
  const colCatByProduct: ColCatRow[] = [];

  for (const [productKey, sources] of Object.entries(PRODUCT_MIX_DIRS)) {
    const catalog = loadCatalog(productKey);
    const idToCat = new Map<number, string>();
    for (const e of catalog.entries) {
      if (e.path) idToCat.set(e.id, normaliseCategory(e.category));
    }

    const totals = new Map<number, Map<string, number>>();
    const unknownByCol = new Map<number, number>();

    for (const src of sources) {
      const dir = join(ARCHIVE, src.dir);
      const files = listMixFiles(dir);
      for (const f of files) {
        const buf = readFileSync(f);
        const a = analyzeFormatA(buf);
        if (!a.isFormatA) continue;
        allHeaderAux.push({
          product: productKey,
          file: f,
          aux: a.headerAux,
          gridEnd: a.gridEnd,
          cellCount: a.cellCount,
        });

        for (const cell of a.cells) {
          const cat = idToCat.get(cell.id) ?? null;
          if (cat == null) {
            unknownByCol.set(cell.col, (unknownByCol.get(cell.col) ?? 0) + 1);
            continue;
          }
          let row = totals.get(cell.col);
          if (!row) {
            row = new Map();
            totals.set(cell.col, row);
          }
          row.set(cat, (row.get(cat) ?? 0) + 1);
        }

        if (a.trailer) {
          for (const s of a.trailer.strings) {
            if (/[\\/]|[A-Za-z]:|\.wav$/i.test(s)) {
              trailerPaths.push({ file: f, str: s });
            }
          }
        }
      }
    }

    colCatByProduct.push({ product: productKey, totals, unknownByCol });
  }

  // --- Report 1: column → category histogram per product ---
  console.log("=== 1. Column → channel category (cells joined to Gen1 catalog) ===\n");
  for (const { product, totals, unknownByCol } of colCatByProduct) {
    console.log(`# ${product}`);
    const cols = [...Array(FORMAT_A_COLS).keys()];
    for (const col of cols) {
      const row = totals.get(col);
      const unknown = unknownByCol.get(col) ?? 0;
      if (!row && unknown === 0) {
        console.log(`  col ${col}: (no cells)`);
        continue;
      }
      const sorted = row
        ? [...row.entries()].sort((a, b) => b[1] - a[1])
        : [];
      const total = sorted.reduce((s, [, n]) => s + n, 0) + unknown;
      const top = sorted.slice(0, 5)
        .map(([c, n]) => `${c}=${n} (${((n / total) * 100).toFixed(0)}%)`)
        .join(", ");
      const unkPct = ((unknown / total) * 100).toFixed(0);
      console.log(`  col ${col} [n=${total}]: ${top}${unknown ? `, <unknown>=${unknown} (${unkPct}%)` : ""}`);
    }
    console.log();
  }

  // --- Report 2: headerAux distribution ---
  console.log("=== 2. headerAux distribution ===\n");
  const auxByProduct = new Map<string, Map<number, number>>();
  for (const r of allHeaderAux) {
    let m = auxByProduct.get(r.product);
    if (!m) { m = new Map(); auxByProduct.set(r.product, m); }
    m.set(r.aux, (m.get(r.aux) ?? 0) + 1);
  }
  for (const [product, hist] of auxByProduct) {
    const total = [...hist.values()].reduce((s, n) => s + n, 0);
    const zero = hist.get(0) ?? 0;
    const nonZero = total - zero;
    console.log(`# ${product}: total=${total}, zero=${zero}, non-zero=${nonZero}`);
    // List non-zero values with file references.
    const nonZeroEntries = allHeaderAux.filter((r) => r.product === product && r.aux !== 0);
    for (const r of nonZeroEntries) {
      console.log(`  aux=${r.aux} (0x${r.aux.toString(16).padStart(4, "0")}) gridEnd=${r.gridEnd} cells=${r.cellCount}  ${r.file.replace(/.*archive[\\\/]/, "")}`);
    }
    console.log();
  }

  // Correlate headerAux with cellCount and gridEnd globally
  console.log("=== 2b. headerAux ?= cellCount or gridEnd? ===\n");
  let matchCells = 0, matchGridEnd = 0, totalNonZero = 0;
  for (const r of allHeaderAux) {
    if (r.aux === 0) continue;
    totalNonZero += 1;
    if (r.aux === r.cellCount) matchCells += 1;
    if (r.aux === r.gridEnd) matchGridEnd += 1;
  }
  console.log(`  non-zero aux files=${totalNonZero}, aux==cellCount=${matchCells}, aux==gridEnd=${matchGridEnd}`);
  console.log();

  // --- Report 3: trailer path-like strings ---
  console.log("=== 3. Trailer path-like strings ===\n");
  if (trailerPaths.length === 0) {
    console.log("  (none found)");
  } else {
    for (const { file, str } of trailerPaths) {
      console.log(`  ${file.replace(/.*archive[\\\/]/, "")}  → ${JSON.stringify(str)}`);
    }
  }
}

investigate();
