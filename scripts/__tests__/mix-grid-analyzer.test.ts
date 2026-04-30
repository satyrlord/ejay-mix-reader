import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { collectProductMixes, resolveProductMixDir } from "../build-index.js";
import {
  FORMAT_A_CELL_BYTES,
  FORMAT_A_COLS,
  FORMAT_A_HEADER_BYTES,
  FORMAT_A_ROW_BYTES,
  TRAILER_ZERO_RUN_THRESHOLD,
  APP_ID_DANCE,
  APP_ID_RAVE,
  APP_ID_HIPHOP,
  productFromAppId,
  findLastNonZero,
  locateGridAndTrailer,
  extractAsciiStrings,
  analyzeFormatA,
  analyzeFile,
  summarise,
  listMixFiles,
} from "../mix-grid-analyzer.js";

const ARCHIVE = resolve("archive");
const hasArchive = existsSync(ARCHIVE);

function resolveMixPath(productId: string, filename: string): string {
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

// ── Constants ─────────────────────────────────────────────────

describe("Format A constants", () => {
  it("uses a 4-byte header and a 16-byte row", () => {
    expect(FORMAT_A_HEADER_BYTES).toBe(4);
    expect(FORMAT_A_ROW_BYTES).toBe(16);
    expect(FORMAT_A_CELL_BYTES).toBe(2);
    expect(FORMAT_A_COLS).toBe(8);
  });

  it("documents a 32-byte trailer zero-run threshold", () => {
    expect(TRAILER_ZERO_RUN_THRESHOLD).toBe(32);
  });
});

// ── productFromAppId ──────────────────────────────────────────

describe("productFromAppId", () => {
  it("maps 0x0A06 → dance", () => {
    expect(productFromAppId(APP_ID_DANCE)).toBe("dance");
  });
  it("maps 0x0A07 → rave", () => {
    expect(productFromAppId(APP_ID_RAVE)).toBe("rave");
  });
  it("maps 0x0A08 → hiphop", () => {
    expect(productFromAppId(APP_ID_HIPHOP)).toBe("hiphop");
  });
  it("returns null for unknown ids", () => {
    expect(productFromAppId(0x00001234)).toBeNull();
    expect(productFromAppId(0)).toBeNull();
  });

  it("matches on the low 16 bits (ignores the per-file aux field)", () => {
    expect(productFromAppId(0x02f60a06)).toBe("dance");
    expect(productFromAppId(0x06370a07)).toBe("rave");
    expect(productFromAppId(0x7eb0a08)).toBe("hiphop");
  });
});

// ── findLastNonZero ───────────────────────────────────────────

describe("findLastNonZero", () => {
  it("returns the highest offset of a non-zero byte", () => {
    expect(findLastNonZero(Buffer.from([0, 1, 0, 2, 0]))).toBe(3);
  });
  it("returns -1 for an all-zero buffer", () => {
    expect(findLastNonZero(Buffer.alloc(16))).toBe(-1);
  });
  it("returns -1 for an empty buffer", () => {
    expect(findLastNonZero(Buffer.alloc(0))).toBe(-1);
  });
});

// ── locateGridAndTrailer ──────────────────────────────────────

describe("locateGridAndTrailer", () => {
  it("detects no trailer when the file ends in pure padding", () => {
    const buf = Buffer.alloc(4 + 16 + 64); // header + 1 row + pure zero padding
    buf.writeUInt32LE(APP_ID_DANCE, 0);
    buf.writeUInt16LE(1231, 6); // single grid cell
    const { gridEnd, trailerStart } = locateGridAndTrailer(buf);
    expect(gridEnd).toBe(7);
    expect(trailerStart).toBe(8);
  });

  it("detects a trailer after a zero gap of ≥ threshold bytes", () => {
    const buf = Buffer.alloc(4 + 16 + 64 + 4); // grid, big gap, tiny trailer
    buf.writeUInt32LE(APP_ID_RAVE, 0);
    buf.writeUInt16LE(500, 6);
    buf.writeUInt16LE(0x0102, 4 + 16 + 64); // trailer first bytes
    buf.writeUInt16LE(0x0304, 4 + 16 + 64 + 2);
    const { gridEnd, trailerStart } = locateGridAndTrailer(buf);
    expect(gridEnd).toBe(7);
    expect(trailerStart).toBe(4 + 16 + 64);
  });

  it("treats a sub-threshold zero gap as in-grid padding", () => {
    const buf = Buffer.alloc(4 + 16 + 8 + 4); // grid, small gap, more grid
    buf.writeUInt32LE(APP_ID_DANCE, 0);
    buf.writeUInt16LE(100, 6);
    buf.writeUInt16LE(200, 4 + 16 + 8); // 0x00C8 → bytes [0xC8, 0x00]
    buf.writeUInt16LE(0x0304, 4 + 16 + 8 + 2); // trailing non-zero pair
    const { gridEnd, trailerStart } = locateGridAndTrailer(buf);
    const lastNonZero = buf.length - 1;
    expect(gridEnd).toBe(lastNonZero);
    expect(trailerStart).toBe(lastNonZero + 1);
  });
});

// ── extractAsciiStrings ───────────────────────────────────────

describe("extractAsciiStrings", () => {
  it("finds printable runs at or above minLength", () => {
    const buf = Buffer.from("..Hello..\x01Wo..", "binary");
    expect(extractAsciiStrings(buf, 4)).toEqual(["..Hello..", "Wo.."]);
  });

  it("returns the trailing run when the buffer ends mid-string", () => {
    const buf = Buffer.from("\x00\x00Dance eJay 1.01", "binary");
    expect(extractAsciiStrings(buf, 4)).toEqual(["Dance eJay 1.01"]);
  });

  it("respects the minLength floor", () => {
    const buf = Buffer.from("\x00ab\x00cdef\x00gh", "binary");
    expect(extractAsciiStrings(buf, 4)).toEqual(["cdef"]);
  });
});

// ── analyzeFormatA ────────────────────────────────────────────

describe("analyzeFormatA", () => {
  function buildFormatA(appId: number, cells: Array<{ row: number; col: number; id: number }>, trailer?: Buffer, padTo?: number): Buffer {
    const maxRow = cells.reduce((m, c) => Math.max(m, c.row), 0);
    const gridBytes = (maxRow + 1) * FORMAT_A_ROW_BYTES;
    const gap = TRAILER_ZERO_RUN_THRESHOLD + 8;
    const trailerLen = trailer?.length ?? 0;
    const needed = FORMAT_A_HEADER_BYTES + gridBytes + (trailer ? gap + trailerLen : 0);
    const size = Math.max(needed, padTo ?? 0);
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(appId, 0);
    for (const { row, col, id } of cells) {
      const off = FORMAT_A_HEADER_BYTES + row * FORMAT_A_ROW_BYTES + col * FORMAT_A_CELL_BYTES;
      buf.writeUInt16LE(id, off);
    }
    if (trailer) {
      const tailStart = size - trailerLen;
      trailer.copy(buf, tailStart);
    }
    return buf;
  }

  it("decodes a synthetic Dance file with two cells and no trailer", () => {
    // Cells in adjacent rows so no internal zero gap exceeds the trailer
    // threshold (which would otherwise split the synthetic grid in two).
    const buf = buildFormatA(APP_ID_DANCE, [
      { row: 0, col: 1, id: 1231 },
      { row: 1, col: 3, id: 746 },
    ]);
    const a = analyzeFormatA(buf);
    expect(a.isFormatA).toBe(true);
    expect(a.appId).toBe(APP_ID_DANCE);
    expect(a.product).toBe("dance");
    expect(a.cellCount).toBe(2);
    expect(a.uniqueIdCount).toBe(2);
    expect(a.minId).toBe(746);
    expect(a.maxId).toBe(1231);
    expect(a.trailer).toBeNull();
    expect(a.cells[0]).toMatchObject({ row: 0, col: 1, id: 1231 });
    expect(a.cells[1]).toMatchObject({ row: 1, col: 3, id: 746 });
    expect(a.activeRowCount).toBeGreaterThanOrEqual(2);
  });

  it("extracts a trailer with ASCII strings", () => {
    const trailer = Buffer.concat([
      Buffer.from("Dance eJay 1.01\x00", "binary"),
      Buffer.from([0x01, 0x00, 0x00, 0x08, 0x00, 0x01, 0x00, 0x02]),
    ]);
    const buf = buildFormatA(APP_ID_RAVE, [{ row: 0, col: 0, id: 42 }], trailer);
    const a = analyzeFormatA(buf);
    expect(a.trailer).not.toBeNull();
    expect(a.trailer!.length).toBe(trailer.length);
    expect(a.trailer!.strings).toContain("Dance eJay 1.01");
    expect(a.trailer!.end).toBe(buf.length - 1);
  });

  it("flags unknown app ids as non-Format-A", () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(0xdeadbeef, 0);
    const a = analyzeFormatA(buf);
    expect(a.isFormatA).toBe(false);
    expect(a.product).toBeNull();
  });

  it("handles empty grids (all zero after header)", () => {
    const buf = Buffer.alloc(128);
    buf.writeUInt32LE(APP_ID_DANCE, 0);
    const a = analyzeFormatA(buf);
    expect(a.isFormatA).toBe(true);
    expect(a.cellCount).toBe(0);
    expect(a.minId).toBe(0);
    expect(a.maxId).toBe(0);
    expect(a.trailer).toBeNull();
  });

  it("handles under-sized buffers gracefully", () => {
    const a = analyzeFormatA(Buffer.alloc(2));
    expect(a.isFormatA).toBe(false);
    expect(a.cellCount).toBe(0);
    expect(a.trailer).toBeNull();
  });
});

// ── summarise ─────────────────────────────────────────────────

describe("summarise", () => {
  it("formats app id as 0x-prefixed hex", () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(APP_ID_HIPHOP, 0);
    buf.writeUInt16LE(1234, 4);
    const s = summarise("fake.mix", analyzeFormatA(buf));
    expect(s.appId).toBe("0x0a08");
    expect(s.product).toBe("hiphop");
    expect(s.cellCount).toBe(1);
    expect(s.path).toBe("fake.mix");
  });
});

// ── Archive spot-checks ───────────────────────────────────────

describe.skipIf(!hasArchive)("archive spot-checks", () => {
  it("parses Dance eJay 1 START.MIX with no trailer", () => {
    const p = resolveMixPath("Dance_eJay1", "START.MIX");
    const a = analyzeFile(p);
    expect(a.product).toBe("dance");
    expect(a.fileSize).toBe(11234);
    expect(a.trailer).toBeNull();
    // The most-referenced sample in START.MIX is id 1231 (appears 33 times).
    expect(a.idHistogram.get(1231)).toBe(33);
  });

  it("parses Rave START.MIX and recovers the 'Dance eJay 1.01' trailer", () => {
    const p = resolveMixPath("Rave", "START.MIX");
    const a = analyzeFile(p);
    expect(a.product).toBe("rave");
    expect(a.fileSize).toBe(11276);
    expect(a.trailer).not.toBeNull();
    // Find the product-signature string (allows for a leading byte).
    const joined = a.trailer!.strings.join("|");
    expect(joined).toMatch(/eJay 1\.01/);
    // Trailer is near end-of-file.
    expect(a.trailer!.end).toBe(0x2c0a);
  });

  it("recovers the NODRUGS.MIX external WAV path reference", () => {
    const p = resolveMixPath("Rave", "NODRUGS.MIX");
    const a = analyzeFile(p);
    expect(a.trailer).not.toBeNull();
    const joined = a.trailer!.strings.join("|");
    expect(joined).toMatch(/scool004\.wav/i);
  });

  it("lists the Gen 1 products preserved in the streamlined archive layout", () => {
    // Dance_SuperPack and GenerationPack1 were intentionally removed from the
    // archive in April 2026; the remaining Gen 1 mix directories are listed
    // here. HipHop 1 is the renamed home of the HipHop_eJay1 mixes.
    const products = ["Dance_eJay1", "Rave", "HipHop_eJay1"];
    for (const productId of products) {
      const resolved = resolveProductMixDir(productId, ARCHIVE);
      expect(resolved).not.toBeNull();
      const files = listMixFiles(resolved!.mixDir);
      expect(files.length).toBeGreaterThan(0);
    }
  });
});
