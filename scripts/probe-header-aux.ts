import { readFileSync } from "fs";
import { analyzeFormatA, listMixFiles } from "./mix-grid-analyzer.js";

const dirs = [
  "archive/Dance_eJay1/MIX",
  "archive/Dance_SuperPack/MIX",
  "archive/GenerationPack1/Dance/MIX",
  "archive/Rave/MIX",
  "archive/GenerationPack1/Rave/MIX",
  "archive/GenerationPack1/HipHop/MIX",
];

interface Row {
  f: string;
  aux: number;
  gridEnd: number;
  cells: number;
  trailerLen: number;
  trailerStart: number;
  sumIds: number;
  sumIdsLow16: number;
  xorIds: number;
  trailerCksumLow16: number;
}

const rows: Row[] = [];
for (const d of dirs) {
  for (const f of listMixFiles(d)) {
    const buf = readFileSync(f);
    const a = analyzeFormatA(buf);
    if (!a.isFormatA || a.headerAux === 0) continue;
    let sumIds = 0, xorIds = 0;
    for (const c of a.cells) {
      sumIds = (sumIds + c.id) >>> 0;
      xorIds ^= c.id;
    }
    const trailerLen = a.trailer ? a.trailer.length : 0;
    const trailerStart = a.trailer ? a.trailer.start : 0;
    let trailerCksum = 0;
    if (a.trailer) {
      for (let i = a.trailer.start; i <= a.trailer.end; i++) trailerCksum = (trailerCksum + buf[i]) >>> 0;
    }
    rows.push({
      f: f.replace(/.*archive[\\\/]/, ""),
      aux: a.headerAux,
      gridEnd: a.gridEnd,
      cells: a.cells.length,
      trailerLen,
      trailerStart,
      sumIds,
      sumIdsLow16: sumIds & 0xffff,
      xorIds,
      trailerCksumLow16: trailerCksum & 0xffff,
    });
  }
}
console.table(rows);

// Compare aux to several derived values
console.log("\n--- Correlations ---");
let sumMatch = 0, xorMatch = 0, trailerLenMatch = 0, trailerCksumMatch = 0, trailerStartMatch = 0;
for (const r of rows) {
  if (r.aux === r.sumIdsLow16) sumMatch++;
  if (r.aux === r.xorIds) xorMatch++;
  if (r.aux === r.trailerLen) trailerLenMatch++;
  if (r.aux === r.trailerCksumLow16) trailerCksumMatch++;
  if (r.aux === r.trailerStart) trailerStartMatch++;
}
console.log({sumMatch, xorMatch, trailerLenMatch, trailerCksumMatch, trailerStartMatch, total: rows.length});

// Inspect HipHop SWEET (empty grid, non-zero aux) and Rave TRANCE specifically
console.log("\n--- Empty-grid mixes (aux non-zero) ---");
for (const r of rows) {
  if (r.cells === 0) {
    console.log(r);
  }
}

// Print byte at specific offsets for empty-grid files
for (const f of [
  "archive/Rave/MIX/TRANCE.MIX",
  "archive/GenerationPack1/HipHop/MIX/SWEET.MIX",
]) {
  const buf = readFileSync(f);
  console.log(`\n${f}: size=${buf.length} first 64 bytes:\n  ${[...buf.subarray(0,64)].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
  console.log(`  last 64 bytes:\n  ${[...buf.subarray(buf.length-64)].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
}
