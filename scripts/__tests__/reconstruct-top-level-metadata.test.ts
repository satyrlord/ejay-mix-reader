import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildTemporaryMetadata,
  reconstructTopLevelMetadata,
} from "../reconstruct-top-level-metadata.js";
import { type ConsolidatedMetadata } from "../rename-samples.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ejay-rebuild-meta-"));
}

describe("buildTemporaryMetadata", () => {
  it("reconstructs minimal metadata from a channel-folder WAV layout", () => {
    const tmp = createTempDir();
    try {
      const bassDir = join(tmp, "Bass");
      const voiceDir = join(tmp, "Voice");
      mkdirSync(bassDir, { recursive: true });
      mkdirSync(voiceDir, { recursive: true });
      writeFileSync(join(bassDir, "Warm Line.wav"), "bass");
      writeFileSync(join(voiceDir, "Shout!.wav"), "voice");

      const meta = buildTemporaryMetadata(tmp);
      expect(meta.samples).toHaveLength(2);
      expect(meta.samples).toEqual([
        {
          filename: "Bass/Warm Line.wav",
          alias: "Warm Line",
          category: "bass",
          channel: "Bass",
        },
        {
          filename: "Voice/Shout!.wav",
          alias: "Shout!",
          category: "voice",
          channel: "Voice",
        },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when a WAV lives at the product root without a channel folder", () => {
    const tmp = createTempDir();
    try {
      writeFileSync(join(tmp, "orphan.wav"), "orphan");
      expect(buildTemporaryMetadata(tmp).samples).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("reconstructTopLevelMetadata", () => {
  it("returns skipped-empty when no WAV files exist", () => {
    const tmp = createTempDir();
    try {
      const result = reconstructTopLevelMetadata(tmp, { apply: true });
      expect(result.status).toBe("skipped-empty");
      expect(result.sampleCount).toBe(0);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a top-level metadata.json when one is missing", () => {
    const tmp = createTempDir();
    try {
      const drumDir = join(tmp, "Drum");
      mkdirSync(drumDir, { recursive: true });
      writeFileSync(join(drumDir, "KICK 01.wav"), "kick");

      const result = reconstructTopLevelMetadata(tmp, { apply: true });
      expect(result.status).toBe("written");
      expect(result.sampleCount).toBe(1);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(true);

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8")) as ConsolidatedMetadata;
      expect(meta.samples).toHaveLength(1);
      expect(meta.samples[0]).toMatchObject({
        filename: "Drum/KICK 01.wav",
        alias: "KICK 01",
        category: "drum",
        channel: "Drum",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports dry-run without writing metadata.json", () => {
    const tmp = createTempDir();
    try {
      const fxDir = join(tmp, "Effect");
      mkdirSync(fxDir, { recursive: true });
      writeFileSync(join(fxDir, "Hit.wav"), "hit");

      const result = reconstructTopLevelMetadata(tmp, { apply: false });
      expect(result.status).toBe("dry-run");
      expect(result.sampleCount).toBe(1);
      expect(existsSync(join(tmp, "metadata.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips products that already have top-level metadata unless overwrite is set", () => {
    const tmp = createTempDir();
    try {
      const bassDir = join(tmp, "Bass");
      mkdirSync(bassDir, { recursive: true });
      writeFileSync(join(bassDir, "One.wav"), "one");
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({ samples: [{ filename: "Bass/existing.wav", alias: "existing", channel: "Bass" }] }),
      );

      const result = reconstructTopLevelMetadata(tmp, { apply: true });
      expect(result.status).toBe("skipped-existing");

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8")) as ConsolidatedMetadata;
      expect(meta.samples[0].filename).toBe("Bass/existing.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("overwrites existing top-level metadata when overwrite is set", () => {
    const tmp = createTempDir();
    try {
      const bassDir = join(tmp, "Bass");
      mkdirSync(bassDir, { recursive: true });
      writeFileSync(join(bassDir, "One.wav"), "one");
      writeFileSync(
        join(tmp, "metadata.json"),
        JSON.stringify({ samples: [{ filename: "Bass/existing.wav", alias: "existing", channel: "Bass" }] }),
      );

      const result = reconstructTopLevelMetadata(tmp, { apply: true, overwrite: true });
      expect(result.status).toBe("written");

      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8")) as ConsolidatedMetadata;
      expect(meta.samples).toEqual([
        {
          filename: "Bass/One.wav",
          alias: "One",
          category: "bass",
          channel: "Bass",
        },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("produces valid metadata structure with samples array", () => {
    const tmp = createTempDir();
    try {
      const bassDir = join(tmp, "Bass");
      const voiceDir = join(tmp, "Voice");
      mkdirSync(bassDir, { recursive: true });
      mkdirSync(voiceDir, { recursive: true });
      writeFileSync(join(bassDir, "Warm Line 01.wav"), "bass");
      writeFileSync(join(voiceDir, "Shout!.wav"), "voice");

      reconstructTopLevelMetadata(tmp, { apply: true });
      const meta = JSON.parse(readFileSync(join(tmp, "metadata.json"), "utf-8")) as ConsolidatedMetadata;

      expect(meta.samples).toHaveLength(2);
      expect(meta.samples[0]).toMatchObject({ category: "bass", channel: "Bass" });
      expect(meta.samples[1]).toMatchObject({ category: "voice", channel: "Voice" });
      expect(meta.samples.every((s) => s.filename && s.alias)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});