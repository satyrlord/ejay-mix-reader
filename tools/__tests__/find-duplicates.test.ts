import { describe, expect, it } from "vitest";
import {
  pcmDataOffset,
  hashPcm,
  scanOutput,
  filterSameProduct,
  filterCrossProduct,
  printReport,
  writeCsv,
} from "../find-duplicates.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Helpers ──────────────────────────────────────────────────

/** Build a minimal valid WAV file buffer with given PCM data. */
function makeWav(pcmData: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(44100, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ejay-test-"));
}

// ── pcmDataOffset ────────────────────────────────────────────

describe("pcmDataOffset", () => {
  it("returns data chunk offset for valid WAV", () => {
    const pcm = Buffer.from([0x80, 0x80, 0x80]);
    const wav = makeWav(pcm);
    const offset = pcmDataOffset(wav);
    expect(offset).toBe(44);
  });

  it("returns 44 for non-RIFF data", () => {
    const data = Buffer.from("NOT_A_WAV_FILE_AT_ALL_BUT_LONG_ENOUGH_DATA_HERE");
    expect(pcmDataOffset(data)).toBe(44);
  });

  it("returns null for RIFF file without data chunk", () => {
    const buf = Buffer.alloc(20);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(12, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(0, 16); // fmt chunk size = 0
    expect(pcmDataOffset(buf)).toBeNull();
  });

  it("handles WAV with extra chunks before data", () => {
    // RIFF header + WAVE + "fmt " chunk (16 bytes) + "fact" chunk (4 bytes) + "data" chunk
    const pcmData = Buffer.from([0x42, 0x43]);
    const fmtChunk = Buffer.alloc(24);
    fmtChunk.write("fmt ", 0, "ascii");
    fmtChunk.writeUInt32LE(16, 4); // chunk size
    // 16 bytes of fmt data (can be zeros for this test)

    const factChunk = Buffer.alloc(12);
    factChunk.write("fact", 0, "ascii");
    factChunk.writeUInt32LE(4, 4);
    // 4 bytes of fact data

    const dataHeader = Buffer.alloc(8);
    dataHeader.write("data", 0, "ascii");
    dataHeader.writeUInt32LE(pcmData.length, 4);

    const riffHeader = Buffer.alloc(12);
    riffHeader.write("RIFF", 0, "ascii");
    const totalSize = fmtChunk.length + factChunk.length + dataHeader.length + pcmData.length + 4;
    riffHeader.writeUInt32LE(totalSize, 4);
    riffHeader.write("WAVE", 8, "ascii");

    const full = Buffer.concat([riffHeader, fmtChunk, factChunk, dataHeader, pcmData]);
    const offset = pcmDataOffset(full);
    expect(offset).toBe(12 + 24 + 12 + 8); // riff(12) + fmt(24) + fact(12) + data_header(8)
    expect(full.subarray(offset!)).toEqual(pcmData);
  });

  it("handles odd-sized chunks with word alignment padding", () => {
    // RIFF + WAVE + odd-sized chunk (size=3) + padding byte + data chunk
    const riffHeader = Buffer.alloc(12);
    riffHeader.write("RIFF", 0, "ascii");
    riffHeader.write("WAVE", 8, "ascii");

    // Odd-sized chunk: "test" with size 3
    const oddChunk = Buffer.alloc(8 + 3);
    oddChunk.write("test", 0, "ascii");
    oddChunk.writeUInt32LE(3, 4); // odd size!

    const padByte = Buffer.alloc(1); // word-alignment pad

    const dataHeader = Buffer.alloc(8);
    dataHeader.write("data", 0, "ascii");
    dataHeader.writeUInt32LE(2, 4);
    const pcm = Buffer.from([0xAB, 0xCD]);

    const totalSize = oddChunk.length + padByte.length + dataHeader.length + pcm.length + 4;
    riffHeader.writeUInt32LE(totalSize, 4);

    const full = Buffer.concat([riffHeader, oddChunk, padByte, dataHeader, pcm]);
    const offset = pcmDataOffset(full);
    // 12 (riff) + 11 (odd chunk) + 1 (pad) + 8 (data header) = 32
    expect(offset).toBe(32);
  });

  it("returns null for malformed chunk size exceeding buffer", () => {
    const buf = Buffer.alloc(24);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(16, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(9999, 16); // chunk size way too big
    expect(pcmDataOffset(buf)).toBeNull();
  });
});

// ── hashPcm ──────────────────────────────────────────────────

describe("hashPcm", () => {
  it("returns SHA-256 hash of PCM data in a WAV file", () => {
    const tmp = createTempDir();
    try {
      const pcm = Buffer.from([0x80, 0x80, 0x80]);
      const wav = makeWav(pcm);
      const file = join(tmp, "test.wav");
      writeFileSync(file, wav);
      const hash = hashPcm(file);
      expect(hash).toBeTruthy();
      expect(hash!.length).toBe(64); // SHA-256 hex = 64 chars
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns same hash for identical PCM data with different headers", () => {
    const tmp = createTempDir();
    try {
      const pcm = Buffer.from([0x42, 0x43, 0x44]);
      const wav1 = makeWav(pcm);
      const wav2 = makeWav(pcm);
      // Modify a non-PCM byte in wav2 header (e.g., sample rate)
      wav2.writeUInt32LE(22050, 24);
      writeFileSync(join(tmp, "a.wav"), wav1);
      writeFileSync(join(tmp, "b.wav"), wav2);
      expect(hashPcm(join(tmp, "a.wav"))).toBe(hashPcm(join(tmp, "b.wav")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null for non-existent file", () => {
    expect(hashPcm("/nonexistent/path/test.wav")).toBeNull();
  });

  it("returns different hashes for different PCM data", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "a.wav"), makeWav(Buffer.from([0x10, 0x20])));
      writeFileSync(join(tmp, "b.wav"), makeWav(Buffer.from([0x30, 0x40])));
      const h1 = hashPcm(join(tmp, "a.wav"));
      const h2 = hashPcm(join(tmp, "b.wav"));
      expect(h1).not.toBe(h2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when pcmDataOffset returns null", () => {
    const tmp = createTempDir();
    try {
      // Valid RIFF/WAVE but missing 'data' chunk
      const buf = Buffer.alloc(20);
      buf.write("RIFF", 0, "ascii");
      buf.writeUInt32LE(12, 4);
      buf.write("WAVE", 8, "ascii");
      buf.write("fmt ", 12, "ascii");
      buf.writeUInt32LE(0, 16);
      writeFileSync(join(tmp, "nodata.wav"), buf);
      expect(hashPcm(join(tmp, "nodata.wav"))).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when offset >= data length (header-only)", () => {
    const tmp = createTempDir();
    try {
      // Non-RIFF file shorter than 44 bytes — pcmDataOffset returns 44 but file is only 20 bytes
      writeFileSync(join(tmp, "tiny.wav"), Buffer.from("not riff short data"));
      expect(hashPcm(join(tmp, "tiny.wav"))).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── scanOutput ───────────────────────────────────────────────

describe("scanOutput", () => {
  it("finds duplicate WAV files with same PCM data", () => {
    const tmp = createTempDir();
    try {
      const productDir = join(tmp, "ProductA", "Bass");
      mkdirSync(productDir, { recursive: true });
      const pcm = Buffer.from([0x80, 0x80, 0x80, 0x80]);
      writeFileSync(join(productDir, "sample1.wav"), makeWav(pcm));
      writeFileSync(join(productDir, "sample2.wav"), makeWav(pcm));
      writeFileSync(join(productDir, "unique.wav"), makeWav(Buffer.from([0x42])));

      const groups = scanOutput(tmp);
      expect(groups.size).toBe(1);
      const [paths] = [...groups.values()];
      expect(paths.length).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty map when no duplicates exist", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Product");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "a.wav"), makeWav(Buffer.from([0x10])));
      writeFileSync(join(dir, "b.wav"), makeWav(Buffer.from([0x20])));

      const groups = scanOutput(tmp);
      expect(groups.size).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty map for empty directory", () => {
    const tmp = createTempDir();
    try {
      expect(scanOutput(tmp).size).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── filterSameProduct / filterCrossProduct ────────────────────

describe("filterSameProduct", () => {
  it("keeps groups where all files are in the same product", () => {
    const tmp = createTempDir();
    const groups = new Map<string, string[]>();
    groups.set("hash1", [
      join(tmp, "ProductA", "file1.wav"),
      join(tmp, "ProductA", "file2.wav"),
    ]);
    groups.set("hash2", [
      join(tmp, "ProductA", "file3.wav"),
      join(tmp, "ProductB", "file4.wav"),
    ]);

    const result = filterSameProduct(groups, tmp);
    expect(result.size).toBe(1);
    expect(result.has("hash1")).toBe(true);
  });
});

describe("filterCrossProduct", () => {
  it("keeps groups spanning multiple products", () => {
    const tmp = createTempDir();
    const groups = new Map<string, string[]>();
    groups.set("hash1", [
      join(tmp, "ProductA", "file1.wav"),
      join(tmp, "ProductA", "file2.wav"),
    ]);
    groups.set("hash2", [
      join(tmp, "ProductA", "file3.wav"),
      join(tmp, "ProductB", "file4.wav"),
    ]);

    const result = filterCrossProduct(groups, tmp);
    expect(result.size).toBe(1);
    expect(result.has("hash2")).toBe(true);
  });

  it("returns empty map when all dupes are same-product", () => {
    const tmp = createTempDir();
    const groups = new Map<string, string[]>();
    groups.set("hash1", [
      join(tmp, "ProductA", "f1.wav"),
      join(tmp, "ProductA", "f2.wav"),
    ]);
    expect(filterCrossProduct(groups, tmp).size).toBe(0);
  });
});

// ── printReport ──────────────────────────────────────────────

describe("printReport", () => {
  it("prints 'No duplicates found.' for empty groups", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      printReport(new Map(), "/fake");
      expect(logs.some((l) => l.includes("No duplicates found"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("prints groups with file sizes", () => {
    const tmp = createTempDir();
    try {
      const product = join(tmp, "Prod", "Bass");
      mkdirSync(product, { recursive: true });
      writeFileSync(join(product, "a.wav"), makeWav(Buffer.from([0x80, 0x80])));
      writeFileSync(join(product, "b.wav"), makeWav(Buffer.from([0x80, 0x80])));

      const groups = new Map<string, string[]>();
      groups.set("abcdef1234567890", [
        join(product, "a.wav"),
        join(product, "b.wav"),
      ]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));
      try {
        printReport(groups, tmp);
        const output = logs.join("\n");
        expect(output).toContain("1 duplicate group");
        expect(output).toContain("1 redundant file");
        expect(output).toContain("a.wav");
        expect(output).toContain("KB");
      } finally {
        console.log = origLog;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── writeCsv ─────────────────────────────────────────────────

describe("writeCsv", () => {
  it("writes a CSV file with correct headers and rows", async () => {
    const tmp = createTempDir();
    try {
      const product = join(tmp, "ProdA", "Bass");
      mkdirSync(product, { recursive: true });
      writeFileSync(join(product, "s1.wav"), makeWav(Buffer.from([0x10])));
      writeFileSync(join(product, "s2.wav"), makeWav(Buffer.from([0x10])));

      const groups = new Map<string, string[]>();
      groups.set("abc123def456789a", [
        join(product, "s1.wav"),
        join(product, "s2.wav"),
      ]);

      const csvPath = join(tmp, "dupes.csv");
      writeCsv(groups, tmp, csvPath);

      // Wait for stream to flush
      await new Promise((r) => setTimeout(r, 100));
      const csv = readFileSync(csvPath, "utf-8");
      const lines = csv.trim().split("\n");
      expect(lines[0]).toBe("hash_prefix,group,product,channel,filename,size_bytes");
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain("abc123def456789a");
      expect(lines[1]).toContain("ProdA");
      expect(lines[1]).toContain("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
