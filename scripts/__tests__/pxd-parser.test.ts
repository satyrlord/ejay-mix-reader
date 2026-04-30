import { describe, expect, it } from "vitest";
import {
  PXD_MAGIC,
  WAV_MAGIC,
  OPCODES,
  SAMPLE_RATE,
  NUM_CHANNELS,
  SAMPLE_WIDTH,
  DPCM_STEP_TABLE,
  decodePxdAudio,
  applyDpcm,
  parsePxdHeader,
  decodePxdFile,
  parseMetadataFields,
  mergeStereoPairs,
  buildCategoryMap,
  enrichWithCategories,
  writeWav,
  parseInfCatalog,
  detectSourceType,
  extractIndividualPxds,
  extractPackedArchive,
  organizeOutput,
  parsePxddance,
  type CatalogEntry,
  type PxddanceEntry,
} from "../pxd-parser.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Constants ────────────────────────────────────────────────

describe("PXD constants", () => {
  it("PXD_MAGIC is 'tPxD'", () => {
    expect(PXD_MAGIC.toString("ascii")).toBe("tPxD");
  });

  it("WAV_MAGIC is 'RIFF'", () => {
    expect(WAV_MAGIC.toString("ascii")).toBe("RIFF");
  });

  it("OPCODES map 0xF4-0xF8 to snippet lengths 1-5", () => {
    expect(OPCODES[0xf4]).toBe(1);
    expect(OPCODES[0xf5]).toBe(2);
    expect(OPCODES[0xf6]).toBe(3);
    expect(OPCODES[0xf7]).toBe(4);
    expect(OPCODES[0xf8]).toBe(5);
  });

  it("SAMPLE_RATE is 44100", () => {
    expect(SAMPLE_RATE).toBe(44100);
  });

  it("NUM_CHANNELS is 1 (mono)", () => {
    expect(NUM_CHANNELS).toBe(1);
  });

  it("SAMPLE_WIDTH is 2 (16-bit)", () => {
    expect(SAMPLE_WIDTH).toBe(2);
  });

  it("DPCM_STEP_TABLE has 244 entries (0x00..0xF3)", () => {
    expect(DPCM_STEP_TABLE.length).toBe(244);
  });

  it("DPCM_STEP_TABLE[0] is 0 (silence)", () => {
    expect(DPCM_STEP_TABLE[0]).toBe(0);
  });

  it("DPCM_STEP_TABLE[0x80] is 0 (midpoint)", () => {
    expect(DPCM_STEP_TABLE[0x80]).toBe(0);
  });

  it("DPCM_STEP_TABLE is symmetric around 0x80", () => {
    // 0x7F should be -2, 0x81 should be +2
    expect(DPCM_STEP_TABLE[0x7f]).toBe(-2);
    expect(DPCM_STEP_TABLE[0x81]).toBe(2);
  });
});

// ── decodePxdAudio ───────────────────────────────────────────

describe("decodePxdAudio", () => {
  it("decodes literal bytes (no opcodes)", () => {
    const compressed = Buffer.from([0x42, 0x43, 0x44]);
    const result = decodePxdAudio(compressed, 3);
    expect(result).toEqual(Buffer.from([0x42, 0x43, 0x44]));
  });

  it("handles silence byte (0x00) → 5 × 0x80", () => {
    const compressed = Buffer.from([0x00]);
    const result = decodePxdAudio(compressed, 5);
    expect(result).toEqual(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]));
  });

  it("handles literal escape (0xFF)", () => {
    const compressed = Buffer.from([0xff, 0xab]);
    const result = decodePxdAudio(compressed, 1);
    expect(result).toEqual(Buffer.from([0xab]));
  });

  it("defines and back-references dictionary entries", () => {
    // 0xF5 = define dict entry of length 2
    //   key=0x10, data=0xAA, 0xBB → emit 0xAA, 0xBB and store dict[0x10]
    // 0x10 → back-reference dict[0x10] → emit 0xAA, 0xBB again
    const compressed = Buffer.from([0xf5, 0x10, 0xaa, 0xbb, 0x10]);
    const result = decodePxdAudio(compressed, 4);
    expect(result).toEqual(Buffer.from([0xaa, 0xbb, 0xaa, 0xbb]));
  });

  it("pads with 0x80 if output undershoots decodedSize", () => {
    const compressed = Buffer.from([0x42]);
    const result = decodePxdAudio(compressed, 3);
    expect(result).toEqual(Buffer.from([0x42, 0x80, 0x80]));
  });

  it("truncates if output overshoots decodedSize", () => {
    const compressed = Buffer.from([0x42, 0x43, 0x44, 0x45]);
    const result = decodePxdAudio(compressed, 2);
    expect(result).toEqual(Buffer.from([0x42, 0x43]));
  });

  it("stops cleanly on truncated opcode payloads", () => {
    const result = decodePxdAudio(Buffer.from([0xf8, 0x10, 0x22]), 3);
    expect(result).toEqual(Buffer.from([0x80, 0x80, 0x80]));
  });

  it("stops cleanly on truncated literal escapes", () => {
    const result = decodePxdAudio(Buffer.from([0xff]), 2);
    expect(result).toEqual(Buffer.from([0x80, 0x80]));
  });

  it("handles all define opcodes (0xF4–0xF8)", () => {
    // 0xF4 = define 1-byte snippet
    const f4 = Buffer.from([0xf4, 0x20, 0xdd]);
    expect(decodePxdAudio(f4, 1)).toEqual(Buffer.from([0xdd]));

    // 0xF6 = define 3-byte snippet
    const f6 = Buffer.from([0xf6, 0x20, 0x11, 0x22, 0x33]);
    expect(decodePxdAudio(f6, 3)).toEqual(Buffer.from([0x11, 0x22, 0x33]));

    // 0xF7 = define 4-byte snippet
    const f7 = Buffer.from([0xf7, 0x20, 0x11, 0x22, 0x33, 0x44]);
    expect(decodePxdAudio(f7, 4)).toEqual(Buffer.from([0x11, 0x22, 0x33, 0x44]));

    // 0xF8 = define 5-byte snippet
    const f8 = Buffer.from([0xf8, 0x20, 0x11, 0x22, 0x33, 0x44, 0x55]);
    expect(decodePxdAudio(f8, 5)).toEqual(Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]));
  });

  it("returns empty-padded buffer for empty input", () => {
    const result = decodePxdAudio(Buffer.alloc(0), 3);
    expect(result).toEqual(Buffer.from([0x80, 0x80, 0x80]));
  });
});

// ── applyDpcm ────────────────────────────────────────────────

describe("applyDpcm", () => {
  it("converts silence (0x80) to zero-valued 16-bit samples", () => {
    const input = Buffer.from([0x80, 0x80, 0x80]);
    const result = applyDpcm(input);
    expect(result.length).toBe(6); // 3 samples × 2 bytes
    expect(result.readInt16LE(0)).toBe(0);
    expect(result.readInt16LE(2)).toBe(0);
    expect(result.readInt16LE(4)).toBe(0);
  });

  it("accumulates positive deltas", () => {
    // 0x81 has delta +2, applied twice should give 2, then 4
    const input = Buffer.from([0x81, 0x81]);
    const result = applyDpcm(input);
    expect(result.readInt16LE(0)).toBe(2);
    expect(result.readInt16LE(2)).toBe(4);
  });

  it("accumulates negative deltas", () => {
    // 0x7F has delta -2, applied twice should give -2, then -4
    const input = Buffer.from([0x7f, 0x7f]);
    const result = applyDpcm(input);
    expect(result.readInt16LE(0)).toBe(-2);
    expect(result.readInt16LE(2)).toBe(-4);
  });

  it("clamps to 16-bit range", () => {
    // Many large positive deltas should clamp to 32767
    const input = Buffer.from(new Array(20).fill(0xf3)); // 0xF3 = large positive
    const result = applyDpcm(input);
    // After enough accumulation it should clamp at 32767
    const last = result.readInt16LE(result.length - 2);
    expect(last).toBe(32767);
  });

  it("respects scale parameter", () => {
    const input = Buffer.from([0x81]); // delta +2
    const result = applyDpcm(input, 2); // scale = 2 → delta becomes +4
    expect(result.readInt16LE(0)).toBe(4);
  });

  it("returns empty buffer for empty input", () => {
    const result = applyDpcm(Buffer.alloc(0));
    expect(result.length).toBe(0);
  });
});

// ── parsePxdHeader ───────────────────────────────────────────

describe("parsePxdHeader", () => {
  function buildPxdBuffer(metaText: string, decodedSize: number): Buffer {
    const metaBuf = Buffer.from(metaText, "ascii");
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54; // 'T' marker
    header.writeUInt32LE(decodedSize, metaEnd + 1);
    header.writeUInt16LE(0, metaEnd + 5); // unknown field
    return header;
  }

  it("parses a valid PXD header", () => {
    const data = buildPxdBuffer("TestAlias\r\nTestDetail", 44100);
    const result = parsePxdHeader(data);
    expect(result).not.toBeNull();
    expect(result!.metadataText).toBe("TestAlias\r\nTestDetail");
    expect(result!.decodedSize).toBe(44100);
    expect(result!.audioOffset).toBe(5 + 21 + 7);
  });

  it("returns null for RIFF/WAV files", () => {
    const riff = Buffer.alloc(44);
    riff.write("RIFF", 0, "ascii");
    riff.write("WAVE", 8, "ascii");
    expect(parsePxdHeader(riff)).toBeNull();
  });

  it("returns null for unknown magic bytes", () => {
    const data = Buffer.from("ABCDEFGHIJKLMNOP");
    expect(parsePxdHeader(data)).toBeNull();
  });

  it("returns null for too-short data", () => {
    expect(parsePxdHeader(Buffer.alloc(3))).toBeNull();
  });

  it("returns null when marker byte is wrong", () => {
    const data = Buffer.alloc(20);
    data.write("tPxD", 0, "ascii");
    data[4] = 2; // meta length
    data[7] = 0x00; // wrong marker (not 0x54)
    expect(parsePxdHeader(data)).toBeNull();
  });

  it("strips trailing null bytes from metadata", () => {
    const metaLen = 10;
    const header = Buffer.alloc(5 + metaLen + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaLen;
    header.write("Test", 5, "ascii");
    // bytes 9-14 are already 0 (nulls)
    header[5 + metaLen] = 0x54;
    header.writeUInt32LE(1000, 5 + metaLen + 1);
    const result = parsePxdHeader(header);
    expect(result).not.toBeNull();
    expect(result!.metadataText).toBe("Test");
  });

  it("preserves latin1 metadata bytes", () => {
    const metadata = Buffer.from("Mädchen", "latin1");
    const header = Buffer.alloc(5 + metadata.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metadata.length;
    metadata.copy(header, 5);
    const metaEnd = 5 + metadata.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(1, metaEnd + 1);
    header.writeUInt16LE(0, metaEnd + 5);

    const result = parsePxdHeader(header);
    expect(result?.metadataText).toBe("Mädchen");
  });
});

// ── decodePxdFile ────────────────────────────────────────────

describe("decodePxdFile", () => {
  it("decodes a complete PXD file", () => {
    const meta = "Alias";
    const metaBuf = Buffer.from(meta, "ascii");
    const decodedSize = 3;
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(decodedSize, metaEnd + 1);
    header.writeUInt16LE(0, metaEnd + 5);

    const compressed = Buffer.from([0x42, 0x43, 0x44]);
    const full = Buffer.concat([header, compressed]);

    const result = decodePxdFile(full);
    expect(result).not.toBeNull();
    expect(result!.metadataText).toBe("Alias");
    expect(result!.decodedSize).toBe(3);
    expect(result!.pcm).toEqual(Buffer.from([0x42, 0x43, 0x44]));
  });

  it("returns null for WAV data", () => {
    const wav = Buffer.alloc(44);
    wav.write("RIFF", 0, "ascii");
    wav.write("WAVE", 8, "ascii");
    expect(decodePxdFile(wav)).toBeNull();
  });

  it("returns null for garbage data", () => {
    expect(decodePxdFile(Buffer.from("garbage data that is not PXD"))).toBeNull();
  });

  it("caps decodedSize to 8× the compressed length", () => {
    const meta = "A";
    const metaBuf = Buffer.from(meta, "ascii");
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(999_999, metaEnd + 1); // absurdly large claim
    header.writeUInt16LE(0, metaEnd + 5);

    const compressed = Buffer.from([0x80, 0x80, 0x80]); // 3 literal bytes
    const full = Buffer.concat([header, compressed]);

    const result = decodePxdFile(full);
    expect(result).not.toBeNull();
    // cap = min(999999, 8*3, 64MiB) = 24
    expect(result!.decodedSize).toBe(24);
    expect(result!.pcm).toHaveLength(24);
  });

  it("caps decodedSize to the 64 MiB hard ceiling", () => {
    const MiB64 = 64 * 1024 * 1024;
    const meta = "A";
    const metaBuf = Buffer.from(meta, "ascii");
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(MiB64 + 1, metaEnd + 1); // just over the ceiling
    header.writeUInt16LE(0, metaEnd + 5);

    // compressed payload large enough that 8× expansion > 64 MiB
    const compressed = Buffer.alloc(MiB64); // 64 MiB of zeros → 8× = 512 MiB
    const full = Buffer.concat([header, compressed]);

    const result = decodePxdFile(full);
    expect(result).not.toBeNull();
    // cap = min(MiB64+1, 8*MiB64, MiB64) = MiB64
    expect(result!.decodedSize).toBe(MiB64);
    expect(result!.pcm).toHaveLength(MiB64);
  });
});

// ── parseMetadataFields ──────────────────────────────────────

describe("parseMetadataFields", () => {
  it("parses single-field metadata", () => {
    const result = parseMetadataFields("MyAlias");
    expect(result.raw).toBe("MyAlias");
    expect(result.alias).toBe("MyAlias");
    expect(result.detail).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it("parses multi-field CRLF metadata", () => {
    const text = "Alias\r\nDetail\r\nField3\r\nField4\r\nCategory";
    const result = parseMetadataFields(text);
    expect(result.alias).toBe("Alias");
    expect(result.detail).toBe("Detail");
    expect(result.category).toBe("Category");
  });

  it("handles empty input", () => {
    const result = parseMetadataFields("");
    expect(result.raw).toBe("");
    expect(result.alias).toBeUndefined();
  });

  it("handles LF-only line endings", () => {
    const text = "Alias\nDetail\nField3\nField4\nCategory";
    const result = parseMetadataFields(text);
    expect(result.alias).toBe("Alias");
    expect(result.category).toBe("Category");
  });

  it("trims whitespace from fields", () => {
    const text = "  Alias  \r\n  Detail  ";
    const result = parseMetadataFields(text);
    expect(result.alias).toBe("Alias");
    expect(result.detail).toBe("Detail");
  });
});

// ── mergeStereoPairs ─────────────────────────────────────────

describe("mergeStereoPairs", () => {
  it("pairs L/R entries with matching base", () => {
    const catalog: CatalogEntry[] = [
      { filename: "bass_L.wav", alias: "Bass L" },
      { filename: "bass_R.wav", alias: "Bass R" },
    ];
    mergeStereoPairs(catalog);
    expect(catalog[0].stereo_pair).toBe("bass_R.wav");
    expect(catalog[0].stereo_channel).toBe("L");
    expect(catalog[1].stereo_pair).toBe("bass_L.wav");
    expect(catalog[1].stereo_channel).toBe("R");
  });

  it("does not pair entries without L/R suffix", () => {
    const catalog: CatalogEntry[] = [
      { filename: "kick.wav", alias: "Kick" },
      { filename: "snare.wav", alias: "Snare" },
    ];
    mergeStereoPairs(catalog);
    expect(catalog[0].stereo_pair).toBeUndefined();
    expect(catalog[1].stereo_pair).toBeUndefined();
  });

  it("does not pair unmatched L or R entries", () => {
    const catalog: CatalogEntry[] = [
      { filename: "bass_L.wav", alias: "Bass L" },
      { filename: "drum_R.wav", alias: "Drum R" },
    ];
    mergeStereoPairs(catalog);
    expect(catalog[0].stereo_pair).toBeUndefined();
    expect(catalog[1].stereo_pair).toBeUndefined();
  });
});

// ── buildCategoryMap & enrichWithCategories ───────────────────

describe("buildCategoryMap", () => {
  it("creates keys from bank and filename", () => {
    const entries: PxddanceEntry[] = [
      { path: "bank01/sample01.pxd", category: "Bass", flag: "", group: "", version: "" },
    ];
    const map = buildCategoryMap(entries);
    expect(map["BANK01_SAMPLE01"]).toBeDefined();
    expect(map["BANK01_SAMPLE01"].category).toBe("Bass");
  });

  it("normalizes backslashes in paths", () => {
    const entries: PxddanceEntry[] = [
      { path: "bank\\sample.pxd", category: "Drum", flag: "", group: "", version: "" },
    ];
    const map = buildCategoryMap(entries);
    expect(map["BANK_SAMPLE"]).toBeDefined();
  });

  it("handles multiple entries", () => {
    const entries: PxddanceEntry[] = [
      { path: "b1/s1.pxd", category: "Bass", flag: "", group: "", version: "" },
      { path: "b2/s2.pxd", category: "Drum", flag: "", group: "", version: "" },
    ];
    const map = buildCategoryMap(entries);
    expect(Object.keys(map).length).toBe(2);
  });
});

describe("enrichWithCategories", () => {
  it("enriches matching catalog entries with categories", () => {
    const catalog: CatalogEntry[] = [
      { filename: "BANK01_SAMPLE01.wav", alias: "Sample" },
    ];
    const categoryMap: Record<string, PxddanceEntry> = {
      BANK01_SAMPLE01: { path: "", category: "Bass", flag: "", group: "", version: "" },
    };
    const matched = enrichWithCategories(catalog, categoryMap);
    expect(matched).toBe(1);
    expect(catalog[0].category).toBe("Bass");
  });

  it("skips entries without matching keys", () => {
    const catalog: CatalogEntry[] = [
      { filename: "unmatched.wav", alias: "Unmatched" },
    ];
    const categoryMap: Record<string, PxddanceEntry> = {
      OTHER: { path: "", category: "Drum", flag: "", group: "", version: "" },
    };
    const matched = enrichWithCategories(catalog, categoryMap);
    expect(matched).toBe(0);
    expect(catalog[0].category).toBeUndefined();
  });

  it("returns zero for empty catalog", () => {
    expect(enrichWithCategories([], {})).toBe(0);
  });
});

// ── writeWav ─────────────────────────────────────────────────

describe("writeWav", () => {
  let tmpDir: string;

  it("writes a valid WAV file with correct header", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wav-"));
    const wavPath = join(tmpDir, "test.wav");
    const pcm = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    writeWav(wavPath, pcm, 44100, 1, 2);

    const data = readFileSync(wavPath);
    expect(data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(data.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(data.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(data.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(data.readUInt16LE(20)).toBe(1); // PCM format
    expect(data.readUInt16LE(22)).toBe(1); // channels
    expect(data.readUInt32LE(24)).toBe(44100); // sample rate
    expect(data.readUInt16LE(34)).toBe(16); // bits per sample
    expect(data.subarray(36, 40).toString("ascii")).toBe("data");
    expect(data.readUInt32LE(40)).toBe(4); // data size
    expect(data.subarray(44)).toEqual(pcm);

    rmSync(tmpDir, { recursive: true });
  });

  it("creates parent directories if needed", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wav-"));
    const nested = join(tmpDir, "sub", "dir", "file.wav");
    writeWav(nested, Buffer.alloc(2), 44100, 1, 2);
    expect(existsSync(nested)).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("writes stereo WAV with correct byte rate", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wav-"));
    const wavPath = join(tmpDir, "stereo.wav");
    writeWav(wavPath, Buffer.alloc(8), 22050, 2, 2);
    const data = readFileSync(wavPath);
    expect(data.readUInt16LE(22)).toBe(2); // stereo
    expect(data.readUInt32LE(24)).toBe(22050);
    expect(data.readUInt32LE(28)).toBe(22050 * 2 * 2); // byteRate
    expect(data.readUInt16LE(32)).toBe(4); // blockAlign
    rmSync(tmpDir, { recursive: true });
  });
});

// ── parseInfCatalog ──────────────────────────────────────────

describe("parseInfCatalog", () => {
  let tmpDir: string;

  it("parses a valid INF file with samples section", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inf-"));
    const infContent = [
      "[HEADER]",
      "something",
      "[SAMPLES]",
      "1",          // sample_id
      "0",          // flag
      '"BASS01"',   // filename
      "0",          // offset
      "1024",       // size
      '"Bass"',     // category
      '"Bass 01"',  // alias
      "0",
      "0",
      "0",
      "0",
      "0",
    ].join("\r\n");
    const infPath = join(tmpDir, "test.inf");
    writeFileSync(infPath, infContent, "ascii");
    const entries = parseInfCatalog(infPath);
    expect(entries.length).toBe(1);
    expect(entries[0].sample_id).toBe(1);
    expect(entries[0].filename).toBe("BASS01");
    expect(entries[0].offset).toBe(0);
    expect(entries[0].size).toBe(1024);
    expect(entries[0].category).toBe("Bass");
    expect(entries[0].alias).toBe("Bass 01");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when no [SAMPLES] section", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inf-"));
    const infPath = join(tmpDir, "empty.inf");
    writeFileSync(infPath, "[HEADER]\nfoo=bar\n", "ascii");
    expect(parseInfCatalog(infPath)).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it("parses multiple entries", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inf-"));
    const lines: string[] = ["[SAMPLES]"];
    for (let id = 1; id <= 2; id++) {
      lines.push(
        String(id), "0", `"SAMP${id}"`, String((id - 1) * 100), "100",
        `"Cat${id}"`, `"Alias${id}"`, "0", "0", "0", "0", "0",
      );
    }
    const infPath = join(tmpDir, "multi.inf");
    writeFileSync(infPath, lines.join("\n"), "ascii");
    const entries = parseInfCatalog(infPath);
    expect(entries.length).toBe(2);
    expect(entries[0].filename).toBe("SAMP1");
    expect(entries[1].filename).toBe("SAMP2");
    rmSync(tmpDir, { recursive: true });
  });

  it("stops at next section marker", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inf-"));
    const lines = [
      "[SAMPLES]",
      "1", "0", '"S1"', "0", "50", '"Bass"', '"B1"', "0", "0", "0", "0", "0",
      "[OTHER]",
      "2", "0", '"S2"', "0", "50", '"Drum"', '"D1"', "0", "0", "0", "0", "0",
    ];
    const infPath = join(tmpDir, "sect.inf");
    writeFileSync(infPath, lines.join("\n"), "ascii");
    const entries = parseInfCatalog(infPath);
    expect(entries.length).toBe(1);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── detectSourceType ─────────────────────────────────────────

describe("detectSourceType", () => {
  let tmpDir: string;

  it("returns 'directory' for directories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    expect(detectSourceType(tmpDir)).toBe("directory");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns null for non-existent path", () => {
    expect(detectSourceType("/nonexistent/path/xyz123")).toBeNull();
  });

  it("returns 'packed_archive' when .inf companion exists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    const archPath = join(tmpDir, "archive");
    writeFileSync(archPath, "data");
    writeFileSync(archPath + ".inf", "companion");
    expect(detectSourceType(archPath)).toBe("packed_archive");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns 'packed_archive' for extensionless file without INF", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    const archPath = join(tmpDir, "archivefile");
    writeFileSync(archPath, "data");
    expect(detectSourceType(archPath)).toBe("packed_archive");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns 'single_pxd' for PXD file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    const pxdPath = join(tmpDir, "test.pxd");
    const data = Buffer.alloc(20);
    data.write("tPxD", 0, "ascii");
    writeFileSync(pxdPath, data);
    expect(detectSourceType(pxdPath)).toBe("single_pxd");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns 'single_pxd' for WAV file with extension", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    const wavPath = join(tmpDir, "sound.wav");
    const data = Buffer.alloc(44);
    data.write("RIFF", 0, "ascii");
    writeFileSync(wavPath, data);
    expect(detectSourceType(wavPath)).toBe("single_pxd");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns 'single_pxd' for unknown extension with short data", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "det-"));
    const path = join(tmpDir, "file.xyz");
    writeFileSync(path, "ab");
    expect(detectSourceType(path)).toBe("single_pxd");
    rmSync(tmpDir, { recursive: true });
  });
});

// ── parsePxddance ────────────────────────────────────────────

describe("parsePxddance", () => {
  let tmpDir: string;

  it("parses entries with .pxd paths", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pxd-"));
    const content = [
      '"bank01/sample01.pxd"',
      "unused",
      '"Bass"',
      '"F"',
      '"G1"',
      '"V1"',
      '"bank01/sample02.pxd"',
      "unused",
      '"Drum"',
      '"F"',
      '"G2"',
      '"V2"',
    ].join("\n");
    const filepath = join(tmpDir, "pxddance.txt");
    writeFileSync(filepath, content, "ascii");
    const entries = parsePxddance(filepath);
    expect(entries.length).toBe(2);
    expect(entries[0].path).toBe("bank01/sample01.pxd");
    expect(entries[0].category).toBe("Bass");
    expect(entries[1].path).toBe("bank01/sample02.pxd");
    expect(entries[1].category).toBe("Drum");
    rmSync(tmpDir, { recursive: true });
  });

  it("parses entries with backslash paths", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pxd-"));
    const content = [
      '"bank\\sample.pxd"',
      "unused",
      '"FX"',
      '"F"',
      '"G"',
      '"V"',
    ].join("\n");
    const filepath = join(tmpDir, "pxddance.txt");
    writeFileSync(filepath, content, "ascii");
    const entries = parsePxddance(filepath);
    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe("bank/sample.pxd");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty for non-PXD content", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pxd-"));
    const filepath = join(tmpDir, "empty.txt");
    writeFileSync(filepath, "no pxd data here\njust text\n", "ascii");
    expect(parsePxddance(filepath)).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── extractIndividualPxds ────────────────────────────────────

describe("extractIndividualPxds", () => {
  let tmpDir: string;

  function makePxd(meta: string, decodedSize: number, audio: number[]): Buffer {
    const metaBuf = Buffer.from(meta, "ascii");
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(decodedSize, metaEnd + 1);
    header.writeUInt16LE(0, metaEnd + 5);
    return Buffer.concat([header, Buffer.from(audio)]);
  }

  it("extracts PXD files from a directory", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    const bankDir = join(srcDir, "bank01");
    mkdirSync(bankDir, { recursive: true });

    writeFileSync(join(bankDir, "s1.pxd"), makePxd("Alias1", 2, [0x42, 0x43]));
    writeFileSync(join(bankDir, "s2.pxd"), makePxd("Alias2", 1, [0x44]));

    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog.length).toBe(2);
    expect(catalog[0].filename).toBe("bank01_s1.wav");
    expect(catalog[0].alias).toBe("Alias1");
    expect(catalog[0].bank).toBe("bank01");
    expect(existsSync(join(outDir, "bank01_s1.wav"))).toBe(true);
    expect(existsSync(join(outDir, "bank01_s2.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("copies plain WAV files as-is", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    // Build a valid 16-bit mono WAV (44100 Hz, 1 second = 44100 frames = 88200 bytes)
    const numFrames = 44100;
    const dataSize = numFrames * 2; // 16-bit = 2 bytes/frame
    const wavBuf = Buffer.alloc(44 + dataSize);
    wavBuf.write("RIFF", 0, "ascii");
    wavBuf.writeUInt32LE(36 + dataSize, 4);
    wavBuf.write("WAVE", 8, "ascii");
    wavBuf.write("fmt ", 12, "ascii");
    wavBuf.writeUInt32LE(16, 16); // fmt chunk size
    wavBuf.writeUInt16LE(1, 20);  // PCM
    wavBuf.writeUInt16LE(1, 22);  // mono
    wavBuf.writeUInt32LE(44100, 24); // sample rate
    wavBuf.writeUInt32LE(88200, 28); // byte rate
    wavBuf.writeUInt16LE(2, 32);  // block align
    wavBuf.writeUInt16LE(16, 34); // bits per sample
    wavBuf.write("data", 36, "ascii");
    wavBuf.writeUInt32LE(dataSize, 40);
    writeFileSync(join(srcDir, "test.pxd"), wavBuf);

    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog.length).toBe(1);
    expect(catalog[0].format).toBe("wav");
    expect(catalog[0].sample_rate).toBe(44100);
    expect(catalog[0].channels).toBe(1);
    expect(catalog[0].bit_depth).toBe(16);
    expect(catalog[0].duration_sec).toBeCloseTo(1.0, 2);
    expect(catalog[0].beats).toBe(Math.round(140 / 60));
    expect(existsSync(join(outDir, "test.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("copies plain WAV with unreadable header without crashing", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    // Minimal buffer: valid RIFF/WAVE magic but no fmt/data chunks
    const wavData = Buffer.alloc(44);
    wavData.write("RIFF", 0, "ascii");
    wavData.write("WAVE", 8, "ascii");
    writeFileSync(join(srcDir, "bad.pxd"), wavData);

    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog.length).toBe(1);
    expect(catalog[0].format).toBe("wav");
    expect(catalog[0].duration_sec).toBeUndefined();
    expect(catalog[0].beats).toBeUndefined();
    expect(existsSync(join(outDir, "bad.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("skips unrecognized files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "bad.pxd"), Buffer.from("garbage not pxd or wav"));
    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog.length).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("uses 16-bit output with applyDpcm", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "s.pxd"), makePxd("A", 2, [0x80, 0x80]));
    const catalog = extractIndividualPxds(srcDir, outDir, true);
    expect(catalog.length).toBe(1);
    expect(catalog[0].bit_depth).toBe(16);
    rmSync(tmpDir, { recursive: true });
  });

  it("returns duration and beats", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "s.pxd"), makePxd("A", 44100, new Array(44100).fill(0x80)));
    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog[0].duration_sec).toBeCloseTo(1.0, 2);
    expect(catalog[0].beats).toBe(Math.round(140 / 60));
    rmSync(tmpDir, { recursive: true });
  });

  it("uses product-specific BPM defaults when deriving beats", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "House_eJay");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "s.pxd"), makePxd("A", 44100, new Array(44100).fill(0x80)));
    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog[0].beats).toBe(Math.round(125 / 60));
    rmSync(tmpDir, { recursive: true });
  });

  it("includes category and detail from metadata", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    mkdirSync(srcDir, { recursive: true });

    const meta = "TheAlias\r\nTheDetail\r\nF3\r\nF4\r\nTheCategory";
    writeFileSync(join(srcDir, "s.pxd"), makePxd(meta, 2, [0x80, 0x80]));
    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog[0].alias).toBe("TheAlias");
    expect(catalog[0].detail).toBe("TheDetail");
    expect(catalog[0].category).toBe("TheCategory");
    rmSync(tmpDir, { recursive: true });
  });

  it("picks up stand-alone .wav files from directory", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "src");
    const outDir = join(tmpDir, "out");
    const bankDir = join(srcDir, "genre");
    mkdirSync(bankDir, { recursive: true });

    const wavData = Buffer.alloc(44, 0);
    wavData.write("RIFF", 0, "ascii");
    wavData.write("WAVE", 8, "ascii");
    writeFileSync(join(bankDir, "sample001.wav"), wavData);

    const catalog = extractIndividualPxds(srcDir, outDir, false);
    expect(catalog.length).toBe(1);
    expect(catalog[0].filename).toBe("genre_sample001.wav");
    expect(catalog[0].alias).toBe("sample001");
    expect(catalog[0].format).toBe("wav");
    expect(existsSync(join(outDir, "genre_sample001.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("normalizes wrapper source paths and still includes sibling Special WAV folders", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "ext-"));
    const srcDir = join(tmpDir, "Dance eJay 1");
    const outDir = join(tmpDir, "out");
    const bankDir = join(srcDir, "dance", "AA");
    const specialDir = join(srcDir, "Special");
    const rekitDir = join(srcDir, "PXD", "rekit1", "15");
    mkdirSync(bankDir, { recursive: true });
    mkdirSync(specialDir, { recursive: true });
    mkdirSync(rekitDir, { recursive: true });

    writeFileSync(join(bankDir, "base001.pxd"), makePxd("Base", 2, [0x80, 0x80]));
    writeFileSync(join(rekitDir, "r2sr512.pxd"), makePxd("Expansion", 2, [0x80, 0x80]));

    const wavData = Buffer.alloc(44, 0);
    wavData.write("RIFF", 0, "ascii");
    wavData.write("WAVE", 8, "ascii");
    writeFileSync(join(specialDir, "special01.wav"), wavData);

    const catalog = extractIndividualPxds(srcDir, outDir, false);
    const base = catalog.find((entry) => entry.source === "AA/base001.pxd");
    const expansion = catalog.find((entry) => entry.source === "rekit1/15/r2sr512.pxd");
    const special = catalog.find((entry) => entry.source === "Special/special01.wav");

    expect(base).toMatchObject({ filename: "AA_base001.wav", bank: "AA" });
    expect(expansion).toMatchObject({ filename: "rekit1_r2sr512.wav", bank: "rekit1" });
    expect(special).toMatchObject({ filename: "Special_special01.wav", bank: "Special", format: "wav" });

    expect(existsSync(join(outDir, "AA_base001.wav"))).toBe(true);
    expect(existsSync(join(outDir, "rekit1_r2sr512.wav"))).toBe(true);
    expect(existsSync(join(outDir, "Special_special01.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── extractPackedArchive ─────────────────────────────────────

describe("extractPackedArchive", () => {
  let tmpDir: string;

  function makePxd(meta: string, decodedSize: number, audio: number[]): Buffer {
    const metaBuf = Buffer.from(meta, "ascii");
    const header = Buffer.alloc(5 + metaBuf.length + 7);
    header.write("tPxD", 0, "ascii");
    header[4] = metaBuf.length;
    metaBuf.copy(header, 5);
    const metaEnd = 5 + metaBuf.length;
    header[metaEnd] = 0x54;
    header.writeUInt32LE(decodedSize, metaEnd + 1);
    header.writeUInt16LE(0, metaEnd + 5);
    return Buffer.concat([header, Buffer.from(audio)]);
  }

  it("extracts samples from packed archive with INF", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    // Build a packed archive with one PXD entry
    const pxd = makePxd("Sample", 2, [0x42, 0x43]);
    const archPath = join(tmpDir, "archive");
    writeFileSync(archPath, pxd);

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"SAMP1"', "0", String(pxd.length), '"Bass"', '"Bass 01"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    const infPath = join(tmpDir, "archive.inf");
    writeFileSync(infPath, infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir, infPath, false);
    expect(catalog.length).toBe(1);
    expect(catalog[0].filename).toBe("SAMP1.wav");
    expect(catalog[0].category).toBe("Bass");
    expect(catalog[0].alias).toBe("Bass 01");
    expect(existsSync(join(outDir, "SAMP1.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("auto-detects INF companion file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    const pxd = makePxd("S", 1, [0x80]);
    const archPath = join(tmpDir, "myarch");
    writeFileSync(archPath, pxd);

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"X"', "0", String(pxd.length), '"Cat"', '"Al"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    writeFileSync(archPath + ".inf", infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir);
    expect(catalog.length).toBe(1);
    rmSync(tmpDir, { recursive: true });
  });

  it("copies embedded WAV files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    const wavData = Buffer.alloc(44);
    wavData.write("RIFF", 0, "ascii");
    wavData.write("WAVE", 8, "ascii");
    const archPath = join(tmpDir, "arch");
    writeFileSync(archPath, wavData);

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"WAV1"', "0", "44", '"Cat"', '"Alias"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    writeFileSync(archPath + ".inf", infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir);
    expect(catalog.length).toBe(1);
    expect(catalog[0].format).toBe("wav");
    rmSync(tmpDir, { recursive: true });
  });

  it("switches archive parts when INF offsets wrap", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    const first = makePxd("First", 1, [0x80]);
    const second = makePxd("Second", 1, [0x81]);
    const archPath = join(tmpDir, "multi");
    writeFileSync(archPath, first);
    writeFileSync(archPath + "a", second);

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"PART1"', "0", String(first.length), '"Bass"', '"First"',
      "0", "0", "0", "0", "0",
      "2", "0", '"PART2"', "0", String(second.length), '"Bass"', '"Second"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    const infPath = join(tmpDir, "multi.inf");
    writeFileSync(infPath, infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir, infPath, false);
    expect(catalog.length).toBe(2);
    expect(catalog.map((entry) => entry.filename)).toEqual(["PART1.wav", "PART2.wav"]);
    expect(existsSync(join(outDir, "PART1.wav"))).toBe(true);
    expect(existsSync(join(outDir, "PART2.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("interleaves stereo L/R pairs into a single stereo WAV", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    const left = makePxd("Bass Left", 2, [0x80, 0x81]);
    const right = makePxd("Bass Right", 2, [0x80, 0x7f]);
    const archPath = join(tmpDir, "stereo");
    writeFileSync(archPath, Buffer.concat([left, right]));

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"BASS01L"', "0", String(left.length), '"Bass"', '"Bass (L)"',
      "0", "0", "0", "0", "0",
      "2", "0", '"BASS01R"', String(left.length), String(right.length), '"Bass"', '"Bass (R)"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    const infPath = join(tmpDir, "stereo.inf");
    writeFileSync(infPath, infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir, infPath, false);
    expect(catalog.length).toBe(1);
    expect(catalog[0].filename).toBe("BASS01.wav");
    expect(catalog[0].alias).toBe("Bass");
    expect(catalog[0].channels).toBe(2);

    const wavData = readFileSync(join(outDir, "BASS01.wav"));
    expect(wavData.readUInt16LE(22)).toBe(2);
    expect(wavData.readUInt32LE(40)).toBe(4);
    expect([...wavData.subarray(44)]).toEqual([0x80, 0x80, 0x81, 0x7f]);
    rmSync(tmpDir, { recursive: true });
  });

  it("skips tiny entries (< 10 bytes)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");

    const archPath = join(tmpDir, "arch");
    writeFileSync(archPath, Buffer.alloc(5));

    const infContent = [
      "[SAMPLES]",
      "1", "0", '"TINY"', "0", "5", '"Cat"', '"Al"',
      "0", "0", "0", "0", "0",
    ].join("\n");
    writeFileSync(archPath + ".inf", infContent, "ascii");

    const catalog = extractPackedArchive(archPath, outDir);
    expect(catalog.length).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when no INF found", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pack-"));
    const outDir = join(tmpDir, "out");
    const archPath = join(tmpDir, "noinfarch");
    writeFileSync(archPath, "data");

    const catalog = extractPackedArchive(archPath, outDir);
    expect(catalog.length).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── organizeOutput ───────────────────────────────────────────

describe("organizeOutput", () => {
  let tmpDir: string;

  it("renames files according to format template", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-"));
    writeFileSync(join(tmpDir, "old.wav"), Buffer.alloc(10));
    const catalog: CatalogEntry[] = [{
      filename: "old.wav",
      alias: "Cool Bass",
      category: "Bass",
    }];
    organizeOutput(catalog, tmpDir, "{alias}");
    expect(catalog[0].filename).toBe("Cool Bass.wav");
    expect(existsSync(join(tmpDir, "Cool Bass.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("deduplicates filenames", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-"));
    writeFileSync(join(tmpDir, "a.wav"), Buffer.alloc(2));
    writeFileSync(join(tmpDir, "b.wav"), Buffer.alloc(2));
    const catalog: CatalogEntry[] = [
      { filename: "a.wav", alias: "Same" },
      { filename: "b.wav", alias: "Same" },
    ];
    organizeOutput(catalog, tmpDir, "{alias}");
    expect(catalog[0].filename).toBe("Same.wav");
    expect(catalog[1].filename).toBe("Same (2).wav");
    rmSync(tmpDir, { recursive: true });
  });

  it("skips missing files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-"));
    const catalog: CatalogEntry[] = [{ filename: "missing.wav", alias: "X" }];
    organizeOutput(catalog, tmpDir, "{alias}");
    expect(catalog[0].filename).toBe("missing.wav"); // unchanged
    rmSync(tmpDir, { recursive: true });
  });

  it("updates stereo_pair references after rename", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-"));
    writeFileSync(join(tmpDir, "a.wav"), Buffer.alloc(2));
    writeFileSync(join(tmpDir, "b.wav"), Buffer.alloc(2));
    const catalog: CatalogEntry[] = [
      { filename: "a.wav", alias: "Bass L", stereo_pair: "b.wav", stereo_channel: "L" },
      { filename: "b.wav", alias: "Bass R", stereo_pair: "a.wav", stereo_channel: "R" },
    ];
    organizeOutput(catalog, tmpDir, "{alias}");
    expect(catalog[0].stereo_pair).toBe("Bass R.wav");
    expect(catalog[1].stereo_pair).toBe("Bass L.wav");
    rmSync(tmpDir, { recursive: true });
  });

  it("uses category and bank in template", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-"));
    writeFileSync(join(tmpDir, "x.wav"), Buffer.alloc(2));
    const catalog: CatalogEntry[] = [{
      filename: "x.wav",
      alias: "Hit",
      category: "Drum",
      bank: "B1",
    }];
    organizeOutput(catalog, tmpDir, "{category}/{bank} - {alias}");
    expect(catalog[0].filename).toBe("Drum/B1 - Hit.wav");
    expect(existsSync(join(tmpDir, "Drum", "B1 - Hit.wav"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });
});
