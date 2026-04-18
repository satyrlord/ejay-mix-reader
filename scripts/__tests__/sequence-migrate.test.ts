import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { migrate } from "../sequence-migrate.js";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "ejay-seqmig-"));
}

function buildPcmWav({
  sampleRate,
  channels,
  bitDepth,
  samples,
}: {
  sampleRate: number;
  channels: number;
  bitDepth: 8 | 16;
  samples: number[];
}): Buffer {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const offset = 44 + i * bytesPerSample;
    if (bitDepth === 8) buf.writeUInt8(samples[i] & 0xff, offset);
    else buf.writeInt16LE(samples[i], offset);
  }
  return buf;
}

function pulsesPcm(sampleRate: number, pulses: number, gapSec: number): number[] {
  const out: number[] = [];
  const pulseLen = Math.floor(sampleRate * 0.04);
  const gapLen = Math.floor(sampleRate * gapSec);
  for (let p = 0; p < pulses; p++) {
    for (let i = 0; i < pulseLen; i++) out.push(i % 2 === 0 ? 24000 : -24000);
    for (let i = 0; i < gapLen; i++) out.push(0);
  }
  return out;
}

function pluckPcm(sampleRate: number, durationSec: number): number[] {
  const len = Math.floor(sampleRate * durationSec);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / (sampleRate * 0.15));
    out.push(Math.round((i % 2 === 0 ? 24000 : -24000) * env));
  }
  return out;
}

function setupRoot(): { root: string; cleanup: () => void } {
  const root = tmpRoot();
  mkdirSync(join(root, "Keys"), { recursive: true });
  mkdirSync(join(root, "Sequence"), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("sequence-migrate", () => {
  it("promotes a tempo-aligned multi-attack loop and keeps a pluck in Keys", () => {
    const { root, cleanup } = setupRoot();
    try {
      const sampleRate = 8000;
      // ~2 s of pulses → 4 beats at 120 BPM.
      writeFileSync(
        join(root, "Keys", "loop.wav"),
        buildPcmWav({
          sampleRate,
          channels: 1,
          bitDepth: 16,
          samples: pulsesPcm(sampleRate, 4, 0.46),
        }),
      );
      writeFileSync(
        join(root, "Keys", "pluck.wav"),
        buildPcmWav({
          sampleRate,
          channels: 1,
          bitDepth: 16,
          samples: pluckPcm(sampleRate, 2),
        }),
      );

      const manifest = {
        samples: [
          { filename: "loop.wav", category: "Keys", subcategory: null, bpm: 120 },
          { filename: "pluck.wav", category: "Keys", subcategory: null, bpm: 120 },
          { filename: "snare.wav", category: "Drum", subcategory: "snare", bpm: 120 },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(manifest));

      const result = migrate({ root });
      expect(result.analyzed).toBe(2);
      expect(result.promoted).toBe(1);

      expect(existsSync(join(root, "Sequence", "loop.wav"))).toBe(true);
      expect(existsSync(join(root, "Keys", "loop.wav"))).toBe(false);
      expect(existsSync(join(root, "Keys", "pluck.wav"))).toBe(true);

      const written = JSON.parse(readFileSync(join(root, "metadata.json"), "utf-8"));
      const promoted = written.samples.find((s: { filename: string }) => s.filename === "loop.wav");
      const stayed = written.samples.find((s: { filename: string }) => s.filename === "pluck.wav");
      expect(promoted.category).toBe("Sequence");
      expect(promoted.sequence_analysis).toBeDefined();
      expect(promoted.sequence_analysis.transients).toBeGreaterThanOrEqual(3);
      expect(stayed.category).toBe("Keys");
      expect(stayed.sequence_analysis.transients).toBe(1);
      expect(written.per_category.Sequence).toBe(1);
      expect(written.per_category.Keys).toBe(1);
      expect(written.per_category["Drum/snare"]).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("dry-run does not move files or rewrite metadata", () => {
    const { root, cleanup } = setupRoot();
    try {
      const sampleRate = 8000;
      writeFileSync(
        join(root, "Keys", "loop.wav"),
        buildPcmWav({
          sampleRate,
          channels: 1,
          bitDepth: 16,
          samples: pulsesPcm(sampleRate, 4, 0.46),
        }),
      );
      const manifest = {
        samples: [{ filename: "loop.wav", category: "Keys", subcategory: null, bpm: 120 }],
      };
      const original = JSON.stringify(manifest);
      writeFileSync(join(root, "metadata.json"), original);

      const result = migrate({ root, dryRun: true });
      expect(result.promoted).toBe(1);
      expect(existsSync(join(root, "Keys", "loop.wav"))).toBe(true);
      expect(existsSync(join(root, "Sequence", "loop.wav"))).toBe(false);
      expect(readFileSync(join(root, "metadata.json"), "utf-8")).toBe(original);
    } finally {
      cleanup();
    }
  });

  it("uses cached analysis when present", () => {
    const { root, cleanup } = setupRoot();
    try {
      writeFileSync(join(root, "Keys", "cached.wav"), Buffer.from("not a real wav"));
      const manifest = {
        samples: [
          {
            filename: "cached.wav",
            category: "Keys",
            subcategory: null,
            bpm: 120,
            sequence_analysis: { duration: 2, beats: 4, transients: 5, loopable: true },
          },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(manifest));

      const result = migrate({ root });
      expect(result.analyzed).toBe(0);
      expect(result.fromCache).toBe(1);
      expect(result.promoted).toBe(1);
      expect(existsSync(join(root, "Sequence", "cached.wav"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("reanalyzes when --reanalyze is requested", () => {
    const { root, cleanup } = setupRoot();
    try {
      const sampleRate = 8000;
      writeFileSync(
        join(root, "Keys", "loop.wav"),
        buildPcmWav({
          sampleRate,
          channels: 1,
          bitDepth: 16,
          samples: pulsesPcm(sampleRate, 4, 0.46),
        }),
      );
      const manifest = {
        samples: [
          {
            filename: "loop.wav",
            category: "Keys",
            subcategory: null,
            bpm: 120,
            sequence_analysis: { duration: 2, beats: 4, transients: 1, loopable: false },
          },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(manifest));

      const result = migrate({ root, reanalyze: true });
      expect(result.analyzed).toBe(1);
      expect(result.fromCache).toBe(0);
      expect(result.promoted).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("counts missing files and decoder errors", () => {
    const { root, cleanup } = setupRoot();
    try {
      writeFileSync(join(root, "Keys", "broken.wav"), Buffer.from("not a wav"));
      const manifest = {
        samples: [
          { filename: "missing.wav", category: "Keys", subcategory: null, bpm: 120 },
          { filename: "broken.wav", category: "Keys", subcategory: null, bpm: 120 },
        ],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(manifest));

      const result = migrate({ root });
      expect(result.skippedMissing).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.promoted).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("skips samples shorter than the minimum duration", () => {
    const { root, cleanup } = setupRoot();
    try {
      const sampleRate = 8000;
      writeFileSync(
        join(root, "Keys", "tiny.wav"),
        buildPcmWav({ sampleRate, channels: 1, bitDepth: 16, samples: pulsesPcm(sampleRate, 1, 0.05) }),
      );
      const manifest = {
        samples: [{ filename: "tiny.wav", category: "Keys", subcategory: null, bpm: 120, duration: 0.1 }],
      };
      writeFileSync(join(root, "metadata.json"), JSON.stringify(manifest));

      const result = migrate({ root });
      expect(result.skippedShort).toBe(1);
      expect(result.promoted).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("respects the limit option", () => {
    const { root, cleanup } = setupRoot();
    try {
      const sampleRate = 8000;
      const samples: Array<{ filename: string; category: string; subcategory: null; bpm: number }> = [];
      for (let i = 0; i < 3; i++) {
        const name = `loop${i}.wav`;
        writeFileSync(
          join(root, "Keys", name),
          buildPcmWav({
            sampleRate,
            channels: 1,
            bitDepth: 16,
            samples: pulsesPcm(sampleRate, 4, 0.46),
          }),
        );
        samples.push({ filename: name, category: "Keys", subcategory: null, bpm: 120 });
      }
      writeFileSync(join(root, "metadata.json"), JSON.stringify({ samples }));

      const result = migrate({ root, limit: 1 });
      expect(result.analyzed).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("throws when metadata.json has no samples array", () => {
    const { root, cleanup } = setupRoot();
    try {
      writeFileSync(join(root, "metadata.json"), JSON.stringify({}));
      expect(() => migrate({ root })).toThrow(/samples array/);
    } finally {
      cleanup();
    }
  });
});
