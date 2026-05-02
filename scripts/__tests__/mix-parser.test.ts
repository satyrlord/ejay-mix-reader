import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, it, vi } from "vitest";

import { collectProductMixes, resolveProductMixDir } from "../build-index.js";

import {
  MIN_FILE_SIZE,
  APP_SIG_DANCE1,
  APP_SIG_RAVE,
  APP_SIG_HIPHOP1,
  FA_HEADER_BYTES,
  FA_ROW_BYTES,
  FA_CELL_BYTES,
  FA_COLS,
  FA_ZERO_GAP,
  detectFormat,
  parseMix,
  parseFormatA,
  parseMixerKV,
  parseCatalogs,
  locateGridTrailer,
  extractAsciiStrings,
  parseFile,
  listMixFiles,
  main,
} from "../mix-parser.js";

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

function buildFormatA(
  appSig: number,
  cells: Array<{ row: number; col: number; id: number }>,
  trailer?: Buffer,
): Buffer {
  const maxRow = cells.reduce((currentMax, cell) => Math.max(currentMax, cell.row), 0);
  const gridBytes = (maxRow + 1) * FA_ROW_BYTES;
  const gapBytes = trailer ? FA_ZERO_GAP + 8 : 0;
  const trailerBytes = trailer?.length ?? 0;
  const buf = Buffer.alloc(FA_HEADER_BYTES + gridBytes + gapBytes + trailerBytes);

  buf.writeUInt16LE(appSig, 0);
  for (const cell of cells) {
    const offset = FA_HEADER_BYTES + (cell.row * FA_ROW_BYTES) + (cell.col * FA_CELL_BYTES);
    buf.writeUInt16LE(cell.id, offset);
  }

  if (trailer) {
    trailer.copy(buf, buf.length - trailer.length);
  }

  return buf;
}

function buildCatalogEntry(name: string, start: number, end: number, withUnknownField: boolean): Buffer {
  const nameBytes = Buffer.from(`${name}\0\x01`, "latin1");
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(nameBytes.length, 0);

  const rangeBuf = Buffer.alloc(withUnknownField ? 10 : 8);
  let offset = 0;
  if (withUnknownField) {
    rangeBuf.writeUInt16LE(0x0009, offset);
    offset += 2;
  }
  rangeBuf.writeUInt32LE(start, offset);
  offset += 4;
  rangeBuf.writeUInt32LE(end, offset);

  return Buffer.concat([lenBuf, nameBytes, rangeBuf]);
}

describe("mix-parser constants", () => {
  it("uses the documented Gen 1 layout", () => {
    expect(MIN_FILE_SIZE).toBe(4);
    expect(FA_HEADER_BYTES).toBe(2);
    expect(FA_ROW_BYTES).toBe(16);
    expect(FA_CELL_BYTES).toBe(2);
    expect(FA_COLS).toBe(8);
    expect(FA_ZERO_GAP).toBe(32);
  });
});

describe("detectFormat", () => {
  it("returns null for undersized buffers", () => {
    expect(detectFormat(Buffer.alloc(MIN_FILE_SIZE - 1))).toBeNull();
  });

  it("detects Format A from the low 16-bit app signature", () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE(APP_SIG_DANCE1, 0);
    expect(detectFormat(buf)).toBe("A");
  });

  it("detects Format B when SKKENNUNG is present without mixer markers", () => {
    const buf = Buffer.from("xxxx#SKKENNUNG#:1234567xxxx", "latin1");
    expect(detectFormat(buf)).toBe("B");
  });

  it("detects Format C from BOOU or DrumEQ markers", () => {
    const buf = Buffer.from("xxxx#SKKENNUNG#:1234567BOOU1_0#\xB0_#500%\xB0_%", "latin1");
    expect(detectFormat(buf)).toBe("C");
  });

  it("detects Format D from late Gen 3 mixer markers", () => {
    const buf = Buffer.from("xxxx#SKKENNUNG#:1234567MixVolume1#\xB0_#500%\xB0_%", "latin1");
    expect(detectFormat(buf)).toBe("D");
  });

  it("returns null for non-eJay binary data", () => {
    expect(detectFormat(Buffer.from("abcdefgh", "latin1"))).toBeNull();
  });

  it("returns null for truncated Gen 2/3 buffers even when text markers are present", () => {
    expect(parseMix(Buffer.from("#SKKENNUNG#", "latin1"))).toBeNull();
  });
});

describe("parseMixerKV", () => {
  it("extracts mixer key-value pairs including empty values", () => {
    const mixerText = "BOOU1_0#\xB0_#500%\xB0_%Empty#\xB0_#%\xB0_%BoostEQ_0#\xB0_#42%\xB0_%";
    expect(parseMixerKV(mixerText)).toEqual({
      BOOU1_0: "500",
      Empty: "",
      BoostEQ_0: "42",
    });
  });
});

describe("parseCatalogs", () => {
  it("parses a padded catalog block and stops at the track marker", () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00]),
      buildCatalogEntry("Dance eJay 2.0", 2000, 3399, true),
      buildCatalogEntry("DanceMachine Samples", 3400, 3899, false),
      Buffer.from([0x02, 0x00, 0x00, 0x01, 0x99, 0x88]),
    ]);

    const { catalogs, endOffset } = parseCatalogs(buf, 0);
    expect(catalogs).toEqual([
      { name: "Dance eJay 2.0", idRangeStart: 2000, idRangeEnd: 3399 },
      { name: "DanceMachine Samples", idRangeStart: 3400, idRangeEnd: 3899 },
    ]);
    expect(buf.subarray(endOffset, endOffset + 4)).toEqual(Buffer.from([0x02, 0x00, 0x00, 0x01]));
  });

  it("returns no catalogs for invalid data", () => {
    const buf = Buffer.from([0xff, 0xff, 0x41, 0x42, 0x43, 0x44]);
    const { catalogs, endOffset } = parseCatalogs(buf, 0);
    expect(catalogs).toEqual([]);
    expect(endOffset).toBe(0);
  });
});

describe("helper functions", () => {
  it("locates a trailer after a long zero gap", () => {
    const trailer = Buffer.from("Dance eJay 1.01\0", "latin1");
    const buf = buildFormatA(APP_SIG_RAVE, [{ row: 0, col: 0, id: 42 }], trailer);
    const boundary = locateGridTrailer(buf, FA_HEADER_BYTES, FA_ZERO_GAP);
    expect(boundary.gridEnd).toBe(FA_HEADER_BYTES);
    expect(boundary.trailerStart).toBe(buf.length - trailer.length);
  });

  it("extracts printable ASCII runs", () => {
    const buf = Buffer.from("\0\0Dance eJay 1.01\0VOL1\x01ok", "binary");
    expect(extractAsciiStrings(buf, 4)).toEqual(["Dance eJay 1.01", "VOL1"]);
  });
});

describe("Format A synthetic parsing", () => {
  it("parses a small synthetic grid and respects the product hint", () => {
    const trailer = Buffer.from("Dance eJay 1.01\0", "latin1");
    const buf = buildFormatA(APP_SIG_HIPHOP1, [
      { row: 0, col: 1, id: 1231 },
      { row: 1, col: 3, id: 746 },
    ], trailer);

    const mix = parseFormatA(buf, "Custom_Gen1");
    expect(mix.format).toBe("A");
    expect(mix.product).toBe("Custom_Gen1");
    expect(mix.bpm).toBe(96);
    expect(mix.tracks).toEqual([
      {
        beat: 0,
        channel: 1,
        sampleRef: {
          rawId: 1231,
          internalName: null,
          displayName: null,
          resolvedPath: null,
          dataLength: null,
        },
      },
      {
        beat: 1,
        channel: 3,
        sampleRef: {
          rawId: 746,
          internalName: null,
          displayName: null,
          resolvedPath: null,
          dataLength: null,
        },
      },
    ]);
  });

  it("returns null from parseMix for unrecognised data", () => {
    expect(parseMix(Buffer.from("abcdefgh", "latin1"))).toBeNull();
  });
});

describe("file helpers", () => {
  it("lists .mix files case-insensitively and ignores missing directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "mix-parser-"));
    try {
      writeFileSync(join(dir, "b.MIX"), "test");
      writeFileSync(join(dir, "a.mix"), "test");
      writeFileSync(join(dir, "note.txt"), "ignore");

      expect(listMixFiles(dir)).toEqual([
        join(dir, "a.mix"),
        join(dir, "b.MIX"),
      ]);
      expect(listMixFiles(join(dir, "missing"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI entry", () => {
  it("returns a usage error when no mode is selected", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(main([])).toBe(1);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("prints a summary for a single file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mix-parser-file-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const filePath = join(dir, "start.mix");
      writeFileSync(filePath, buildFormatA(APP_SIG_DANCE1, [{ row: 0, col: 0, id: 7 }]));
      const code = main(["--file", filePath]);
      expect(code).toBe(0);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[A] start.mix"))).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a failure code for a missing file path", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = main(["--file", resolve("archive/does-not-exist.mix")]);
      expect(code).toBe(1);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("ERROR:"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("writes JSON output for directory mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "mix-parser-cli-"));
    const outFile = join(dir, "report.json");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      writeFileSync(join(dir, "valid.mix"), buildFormatA(APP_SIG_DANCE1, [{ row: 0, col: 0, id: 99 }]));
      writeFileSync(join(dir, "tiny.mix"), Buffer.alloc(2));

      const code = main(["--dir", dir, "--out", outFile, "--json"]);
      expect(code).toBe(0);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Wrote 2 results"))).toBe(true);

      const parsed = JSON.parse(readFileSync(outFile, "utf8")) as Array<{ mix: { format: string } | null }>;
      expect(parsed).toHaveLength(2);
      expect(parsed.some((entry) => entry.mix?.format === "A")).toBe(true);
      expect(parsed.some((entry) => entry.mix === null)).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasArchive)("can scan the known archive directories", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = main(["--all"]);
      expect(code).toBe(0);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Total:"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe.skipIf(!hasArchive)("archive spot checks", () => {
  it("parses Dance eJay 1 START.MIX as Format A", () => {
    const mix = parseFile(resolveMixPath("Dance_eJay1", "START.MIX"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("A");
    expect(mix!.product).toBe("Dance_eJay1");
    expect(mix!.tracks).toHaveLength(189);
    // First/last cells reflect the deterministic 8-column Grid 1 (FA_HEADER_BYTES=2).
    expect(mix!.tracks[0]).toMatchObject({ beat: 0, channel: 1, sampleRef: { rawId: 1186 } });
    expect(mix!.tracks.at(-1)).toMatchObject({ beat: 82, channel: 5, sampleRef: { rawId: 1922 } });
  });

  it("parses Dance eJay 2 STEP.MIX as Format B", () => {
    const mix = parseFile(resolveMixPath("Dance_eJay2", "STEP.MIX"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("B");
    expect(mix!.title).toBe("Duck Dance");
    expect(mix!.author).toBe("MC Magic");
    expect(mix!.tracks).toHaveLength(9);
    expect(mix!.catalogs).toHaveLength(8);
    expect(mix!.tickerText).toHaveLength(25);
    expect(mix!.tracks[0]).toMatchObject({
      beat: -8,
      channel: 8,
      sampleRef: { rawId: 1930, internalName: "humn.9", dataLength: 26578 },
    });
  });

  it("parses Techno eJay start.mix with timeline chunk recovery", () => {
    const mix = parseFile(resolveMixPath("Techno_eJay", "start.mix"), "Techno_eJay");
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("B");
    expect(mix!.product).toBe("Techno_eJay");
    expect(mix!.bpm).toBe(140);
    expect(mix!.tracks).toHaveLength(467);

    const beats = mix!.tracks
      .map((track) => track.beat)
      .filter((beat): beat is number => typeof beat === "number");

    expect(Math.min(...beats)).toBe(0);
    expect(Math.max(...beats)).toBeCloseTo(131.875, 3);
    expect(mix!.loopBeats).toBe(133);
  });

  it("parses HipHop eJay 2 Start.mix user-percussion lane extension records", () => {
    const mix = parseFile(resolveMixPath("HipHop_eJay2", "Start.mix"), "HipHop_eJay2");
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("B");
    expect(mix!.bpm).toBe(90);
    expect(mix!.tracks).toHaveLength(302);

    const userPercEvents = mix!.tracks.filter((track) => track.channel === 16);
    expect(userPercEvents).toHaveLength(30);

    const userPercBeats = userPercEvents
      .map((track) => track.beat)
      .filter((beat): beat is number => typeof beat === "number" && Number.isFinite(beat));
    expect(Math.min(...userPercBeats)).toBe(13);
    expect(Math.max(...userPercBeats)).toBe(52);

    const sampleIds = new Set(userPercEvents.map((track) => track.sampleRef.rawId));
    expect(sampleIds).toEqual(new Set([7200, 7201, 7202, 7203, 7204, 7205]));
  });

  it("parses Dance eJay 3 START.MIX as early Gen 3 with alias tracks", () => {
    const mix = parseFile(resolveMixPath("Dance_eJay3", "start.mix"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("C");
    expect(mix!.title).toBe("Dance eJay 3 Demo Mix");
    expect(mix!.author).toBe("marc");
    expect(mix!.tracks).toHaveLength(16);
    expect(mix!.catalogs).toHaveLength(4);
    expect(Object.keys(mix!.mixer.raw)).toHaveLength(68);
    expect(mix!.tracks.slice(0, 5).map((track) => track.sampleRef.displayName)).toEqual([
      "kick12",
      "kick67",
      "snare57",
      "snare55",
      "hihats78",
    ]);
    expect(mix!.tracks.at(-1)?.sampleRef.displayName).toBe("clave03");
  });

  it("parses HipHop 3 START.MIX with WINDOWS TEMP path records", () => {
    const mix = parseFile(resolveMixPath("HipHop_eJay3", "start.mix"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("C");
    expect(mix!.title).toBe("-");
    expect(mix!.author).toBe("-");
    expect(mix!.tracks).toHaveLength(16);
    expect(mix!.catalogs).toHaveLength(8);
    expect(mix!.tracks[0].sampleRef.displayName).toBe("Kick90");
    expect(mix!.tracks[0].beat).toBe(0);
    expect(mix!.tracks[0].channel).toBe(0);
    expect(mix!.tracks.every((track) => track.sampleRef.rawId === 0)).toBe(true);
    expect(mix!.tracks.at(-1)?.sampleRef.displayName).toBe("Perc159");
  });

  it("parses Dance eJay 3 french.mix (big-format C) and extracts beat and channel", () => {
    // french.mix uses the big-format track record (gap === 40) with an explicit
    // product-name field ("Dance eJay 3.0\0\x01"), zeitpos, and Spur (channel).
    // Confirmed by binary analysis: marker at 0x424, nameLen=16, beat=1, channel=2.
    const mix = parseFile(resolveMixPath("Dance_eJay3", "french.mix"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("C");
    expect(mix!.author).toBe("marc");
    expect(mix!.catalogs).toHaveLength(4);
    // Only the first occurrence (path 'd') produces a parseable record; the
    // secondary placement uses a compact continuation format without a name field
    // and is currently skipped.
    expect(mix!.tracks).toHaveLength(1);
    expect(mix!.tracks[0]).toMatchObject({
      beat: 1,
      channel: 2,
      sampleRef: {
        displayName: "Dance eJay 3.0",
        dataLength: 253,
      },
    });
  });

  it("parses HipHop 4 START.MIX as late Gen 3 with strict name-gated track recovery", () => {
    const mix = parseFile(resolveMixPath("HipHop_eJay4", "start.mix"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("D");
    expect(mix!.title).toBe("nothingbutCRAP");
    expect(mix!.author).toBe("laborda-gonzales");
    expect(mix!.tracks).toHaveLength(0);
    expect(mix!.catalogs).toHaveLength(7);
    expect(Object.keys(mix!.mixer.raw)).toHaveLength(502);
    expect(mix!.drumMachine?.pads).toHaveLength(16);
  });

  it("ignores Xtreme VideoMix payloads in audio-only parsing", () => {
    const mix = parseFile(resolveMixPath("Xtreme_eJay", "start.mix"));
    expect(mix).not.toBeNull();
    expect(mix!.format).toBe("C");
    expect(mix!.title).toBe("-");
    expect(mix!.author).toBe("-");
    expect(mix!.tracks).toHaveLength(0);
    expect(mix!.catalogs).toHaveLength(7);
    expect(mix!.mixer.raw.VideoMix).toBeUndefined();
  });
});
