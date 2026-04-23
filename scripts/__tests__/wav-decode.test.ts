import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { decodeWavBuffer, decodeWavFile, readWavInfo } from "../wav-decode.js";
import { buildPcmWav } from "./wav-test-utils.js";

describe("decodeWavBuffer", () => {
  it("decodes 16-bit mono PCM into [-1, 1]", () => {
    const wav = decodeWavBuffer(
      buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 16, samples: [0, 16384, -16384, 32767] }),
    );
    expect(wav.sampleRate).toBe(8000);
    expect(wav.channels).toBe(1);
    expect(wav.bitDepth).toBe(16);
    expect(wav.samples.length).toBe(4);
    expect(wav.samples[0]).toBeCloseTo(0, 5);
    expect(wav.samples[1]).toBeCloseTo(0.5, 4);
    expect(wav.samples[2]).toBeCloseTo(-0.5, 4);
    expect(wav.samples[3]).toBeCloseTo(0.99997, 4);
    expect(wav.duration).toBeCloseTo(4 / 8000);
  });

  it("downmixes stereo to mono by averaging", () => {
    const wav = decodeWavBuffer(
      buildPcmWav({
        sampleRate: 4000,
        channels: 2,
        bitDepth: 16,
        // Two frames: L=16384, R=-16384 → 0; L=8192, R=8192 → 8192.
        samples: [16384, -16384, 8192, 8192],
      }),
    );
    expect(wav.channels).toBe(2);
    expect(wav.samples.length).toBe(2);
    expect(wav.samples[0]).toBeCloseTo(0, 5);
    expect(wav.samples[1]).toBeCloseTo(0.25, 4);
  });

  it("decodes 8-bit unsigned PCM with midpoint 128", () => {
    const wav = decodeWavBuffer(
      buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 8, samples: [128, 192, 64, 255] }),
    );
    expect(wav.bitDepth).toBe(8);
    expect(wav.samples[0]).toBeCloseTo(0, 5);
    expect(wav.samples[1]).toBeCloseTo(0.5, 4);
    expect(wav.samples[2]).toBeCloseTo(-0.5, 4);
  });

  it("decodes 24-bit signed PCM", () => {
    // 0x000000 = 0, 0x400000 = 4194304 / 8388608 = 0.5,
    // 0xC00000 = -4194304 / 8388608 = -0.5
    const wav = decodeWavBuffer(
      buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 24, samples: [0x000000, 0x400000, 0xc00000] }),
    );
    expect(wav.bitDepth).toBe(24);
    expect(wav.samples[0]).toBeCloseTo(0, 5);
    expect(wav.samples[1]).toBeCloseTo(0.5, 5);
    expect(wav.samples[2]).toBeCloseTo(-0.5, 5);
  });

  it("throws on a non-RIFF buffer", () => {
    expect(() => decodeWavBuffer(Buffer.alloc(64))).toThrow(/RIFF/);
  });

  it("throws on a buffer that is too small", () => {
    expect(() => decodeWavBuffer(Buffer.alloc(10))).toThrow(/too small/);
  });

  it("throws on non-PCM format codes", () => {
    const buf = buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 16, samples: [0] });
    buf.writeUInt16LE(3, 20); // float, not PCM
    expect(() => decodeWavBuffer(buf)).toThrow(/PCM only/);
  });

  it("throws on unsupported channel count", () => {
    const buf = buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 16, samples: [0] });
    buf.writeUInt16LE(5, 22);
    expect(() => decodeWavBuffer(buf)).toThrow(/channel count/);
  });

  it("throws on unsupported bit depth", () => {
    const buf = buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 16, samples: [0] });
    buf.writeUInt16LE(32, 34);
    expect(() => decodeWavBuffer(buf)).toThrow(/bit depth/);
  });

  it("throws when no data chunk is present", () => {
    const buf = Buffer.alloc(48);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(40, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(8000, 24);
    buf.writeUInt32LE(8000, 28);
    buf.writeUInt16LE(1, 32);
    buf.writeUInt16LE(8, 34);
    // No `data` chunk written; remaining bytes are zero.
    expect(() => decodeWavBuffer(buf)).toThrow(/data chunk/);
  });

  it("skips unknown chunks before the data chunk", () => {
    // Build a valid file but inject a `LIST` chunk between `fmt ` and `data`.
    const dataSamples = [0, 16384];
    const dataSize = dataSamples.length * 2;
    const listSize = 6;
    const total = 12 + 8 + 16 + 8 + listSize + 8 + dataSize;
    const buf = Buffer.alloc(total);
    let p = 0;
    buf.write("RIFF", p); p += 4;
    buf.writeUInt32LE(total - 8, p); p += 4;
    buf.write("WAVE", p); p += 4;
    buf.write("fmt ", p); p += 4;
    buf.writeUInt32LE(16, p); p += 4;
    buf.writeUInt16LE(1, p); p += 2;
    buf.writeUInt16LE(1, p); p += 2;
    buf.writeUInt32LE(8000, p); p += 4;
    buf.writeUInt32LE(16000, p); p += 4;
    buf.writeUInt16LE(2, p); p += 2;
    buf.writeUInt16LE(16, p); p += 2;
    buf.write("LIST", p); p += 4;
    buf.writeUInt32LE(listSize, p); p += 4;
    p += listSize;
    buf.write("data", p); p += 4;
    buf.writeUInt32LE(dataSize, p); p += 4;
    buf.writeInt16LE(0, p);
    buf.writeInt16LE(16384, p + 2);

    const wav = decodeWavBuffer(buf);
    expect(wav.samples.length).toBe(2);
    expect(wav.samples[1]).toBeCloseTo(0.5, 4);
  });
});

describe("decodeWavFile", () => {
  it("reads a WAV file from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "ejay-wav-"));
    try {
      const path = join(dir, "x.wav");
      writeFileSync(path, buildPcmWav({ sampleRate: 8000, channels: 1, bitDepth: 16, samples: [0, 16384] }));
      const wav = decodeWavFile(path);
      expect(wav.samples.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readWavInfo", () => {
  it("returns header info without decoding PCM", () => {
    const buf = buildPcmWav({ sampleRate: 44100, channels: 1, bitDepth: 16, samples: new Array(44100).fill(0) });
    const info = readWavInfo(buf);
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(1);
    expect(info.bitDepth).toBe(16);
    expect(info.dataSize).toBe(88200);
    expect(info.duration).toBeCloseTo(1.0, 4);
  });

  it("handles stereo files", () => {
    const buf = buildPcmWav({ sampleRate: 22050, channels: 2, bitDepth: 16, samples: new Array(44100).fill(0) });
    const info = readWavInfo(buf);
    expect(info.channels).toBe(2);
    expect(info.duration).toBeCloseTo(1.0, 4);
  });

  it("throws for buffers too small", () => {
    expect(() => readWavInfo(Buffer.alloc(20))).toThrow("buffer too small");
  });

  it("throws for non-RIFF files", () => {
    const buf = Buffer.alloc(44);
    expect(() => readWavInfo(buf)).toThrow("not a RIFF/WAVE");
  });

  it("throws when no data chunk exists", () => {
    const buf = Buffer.alloc(44);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(44100, 24);
    buf.writeUInt32LE(88200, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    // No "data" chunk follows
    expect(() => readWavInfo(buf)).toThrow("no data chunk");
  });
});
