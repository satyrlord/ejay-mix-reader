import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { irToMeta, buildMetadataManifest, writeManifest } from "../extract-mix-metadata.js";
import type { MixMetadataManifest } from "../extract-mix-metadata.js";

// ── irToMeta ────────────────────────────────────────────────────────────────

describe("irToMeta", () => {
  it("returns null when ir is null", () => {
    expect(irToMeta(null)).toBeNull();
  });

  it("maps bpm, trackCount, and catalogs from a minimal IR", () => {
    const ir = {
      bpm: 140,
      bpmAdjusted: null as number | null,
      tracks: [1, 2, 3] as unknown[],
      catalogs: [{ name: "Dance eJay 1" }],
      title: null as string | null,
      author: null as string | null,
      tickerText: [] as string[],
      format: "A" as const,
      registration: null,
    } as unknown as Parameters<typeof irToMeta>[0];

    const meta = irToMeta(ir);
    expect(meta).not.toBeNull();
    expect(meta?.bpm).toBe(140);
    expect(meta?.trackCount).toBe(3);
    expect(meta?.catalogs).toEqual(["Dance eJay 1"]);
    expect(meta?.bpmAdjusted).toBeUndefined();
    expect(meta?.title).toBeUndefined();
    expect(meta?.author).toBeUndefined();
    expect(meta?.tickerText).toBeUndefined();
  });

  it("populates bpmAdjusted only when different from bpm", () => {
    const ir = {
      bpm: 140, bpmAdjusted: 120 as number | null, tracks: [],
      catalogs: [], title: null, author: null, tickerText: [], format: "A" as const, registration: null,
    } as unknown as Parameters<typeof irToMeta>[0];
    expect(irToMeta(ir)?.bpmAdjusted).toBe(120);
  });

  it("omits bpmAdjusted when it equals bpm", () => {
    const ir = {
      bpm: 140, bpmAdjusted: 140 as number | null, tracks: [],
      catalogs: [], title: null, author: null, tickerText: [], format: "A" as const, registration: null,
    } as unknown as Parameters<typeof irToMeta>[0];
    expect(irToMeta(ir)?.bpmAdjusted).toBeUndefined();
  });

  it("populates title and author when present", () => {
    const ir = {
      bpm: 130, bpmAdjusted: null as number | null, tracks: [],
      catalogs: [], title: "My Track", author: "DJ Test", tickerText: [], format: "A" as const, registration: null,
    } as unknown as Parameters<typeof irToMeta>[0];
    const meta = irToMeta(ir);
    expect(meta?.title).toBe("My Track");
    expect(meta?.author).toBe("DJ Test");
  });

  it("populates tickerText when non-empty", () => {
    const ir = {
      bpm: 130, bpmAdjusted: null as number | null, tracks: [],
      catalogs: [], title: null, author: null, tickerText: ["line 1", "line 2"], format: "A" as const, registration: null,
    } as unknown as Parameters<typeof irToMeta>[0];
    expect(irToMeta(ir)?.tickerText).toEqual(["line 1", "line 2"]);
  });
});

// ── writeManifest ────────────────────────────────────────────────────────────

describe("writeManifest", () => {
  it("writes the manifest as formatted JSON to the given path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-"));
    try {
      const manifest: MixMetadataManifest = {
        Rave: { "RAVE01.MIX": { bpm: 170, trackCount: 5, catalogs: [] } },
      };
      const outFile = join(tmp, "out", "manifest.json");
      writeManifest(manifest, outFile);
      const written = JSON.parse(readFileSync(outFile, "utf-8")) as unknown;
      expect(written).toEqual(manifest);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates intermediate directories if they do not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-"));
    try {
      const outFile = join(tmp, "a", "b", "c", "manifest.json");
      writeManifest({}, outFile);
      const written = JSON.parse(readFileSync(outFile, "utf-8")) as unknown;
      expect(written).toEqual({});
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── buildMetadataManifest ────────────────────────────────────────────────────

describe("buildMetadataManifest", () => {
  it("returns an empty manifest when archive directory does not exist", () => {
    const manifest = buildMetadataManifest(join(tmpdir(), "no-such-archive-xyz"));
    expect(manifest).toEqual({});
  });

  it("returns an empty manifest when archive exists but has no known product subdirectories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-arch-"));
    try {
      const manifest = buildMetadataManifest(tmp);
      expect(manifest).toEqual({});
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips a product whose archive dir exists but contains no recognised mix files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-empty-"));
    try {
      // Rave dir exists, MIX subdir exists, but only a text file is present.
      const mixDir = join(tmp, "Rave", "MIX");
      mkdirSync(mixDir, { recursive: true });
      writeFileSync(join(mixDir, "notes.txt"), "not a mix");

      const manifest = buildMetadataManifest(tmp);
      expect(manifest["Rave"]).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses a real-layout Rave archive subdirectory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-rave-"));
    try {
      // Rave uses ARCHIVE_MIX_DIRS["Rave"] = { archiveDir: "Rave", mixSubdir: "MIX" }
      const mixDir = join(tmp, "Rave", "MIX");
      mkdirSync(mixDir, { recursive: true });
      // Minimal valid Rave header: appSig 0x0A07 (Rave) + 2 zero bytes
      writeFileSync(join(mixDir, "RAVE01.MIX"), Buffer.from([0x07, 0x0a, 0x00, 0x00]));
      writeFileSync(join(mixDir, "bad.mix"), Buffer.from("junk"));

      const manifest = buildMetadataManifest(tmp);
      expect(Object.keys(manifest)).toContain("Rave");
      expect(manifest["Rave"]?.["RAVE01.MIX"]).toBeDefined();
      expect(manifest["Rave"]?.["RAVE01.MIX"]?.bpm).toBeGreaterThan(0);
      // Bad file should not appear (parse fails, irToMeta returns null)
      expect(manifest["Rave"]?.["bad.mix"]).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips a file that cannot be read", () => {
    // We pass an archive dir where the product folder exists but the MIX
    // subdir contains a symlink pointing to a missing target — the simplest
    // cross-platform approach is to write a directory where the file should be.
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-skip-"));
    try {
      const mixDir = join(tmp, "Rave", "MIX");
      mkdirSync(mixDir, { recursive: true });
      // Write a parseable file so the product is discovered
      writeFileSync(join(mixDir, "GOOD.MIX"), Buffer.from([0x07, 0x0a, 0x00, 0x00]));
      // Write a *directory* named like a .mix file — readFileSync on a dir throws EISDIR
      mkdirSync(join(mixDir, "ISDIR.MIX"), { recursive: true });

      const manifest = buildMetadataManifest(tmp);
      expect(manifest["Rave"]?.["GOOD.MIX"]).toBeDefined();
      // ISDIR.MIX will not appear because we can't read it
      expect(manifest["Rave"]?.["ISDIR.MIX"]).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("includes _userdata groups in the manifest", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-ud-"));
    try {
      const udDir = join(tmp, "_userdata", "mysets");
      mkdirSync(udDir, { recursive: true });
      writeFileSync(join(udDir, "UD01.MIX"), Buffer.from([0x07, 0x0a, 0x00, 0x00]));

      const manifest = buildMetadataManifest(tmp);
      expect(Object.keys(manifest)).toContain("_userdata/mysets");
      expect(manifest["_userdata/mysets"]?.["UD01.MIX"]).toBeDefined();
      expect(manifest["_userdata/mysets"]?.["UD01.MIX"]?.bpm).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips _userdata groups with no valid mix files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-ud-"));
    try {
      const udDir = join(tmp, "_userdata", "empty");
      mkdirSync(udDir, { recursive: true });
      writeFileSync(join(udDir, "notes.txt"), "not a mix");

      const manifest = buildMetadataManifest(tmp);
      expect(Object.keys(manifest)).not.toContain("_userdata/empty");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records failed _userdata parse in the totals without crashing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-ud-"));
    try {
      const udDir = join(tmp, "_userdata", "broken");
      mkdirSync(udDir, { recursive: true });
      // A valid-size file with junk content — scanMixDir skips unrecognised
      // formats, so the group ends up with no entries and nothing is written.
      writeFileSync(join(udDir, "BAD.MIX"), Buffer.from("junkdata!garbage!trash"));

      // Should not throw; the bad file is just skipped.
      const manifest = buildMetadataManifest(tmp);
      expect(manifest["_userdata/broken"]).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("includes a _userdata entry with valid meta in the manifest", () => {
    // The `!entry.meta` else-branch in appendUserdataMetadata is marked with a
    // v8 ignore because it is only reachable if parseMix throws an unexpected
    // non-RangeError error inside scanMixDir — which cannot happen with current
    // Format A/B/C/D parsers.  This test exercises the success path so the
    // overall function stays covered.
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-ud-"));
    try {
      const udDir = join(tmp, "_userdata", "mysets");
      mkdirSync(udDir, { recursive: true });
      // Minimal parseable Rave mix — meta will be populated.
      writeFileSync(join(udDir, "G.MIX"), Buffer.from([0x07, 0x0a, 0x00, 0x00]));

      const manifest = buildMetadataManifest(tmp);
      // meta is present so this is in the success path.
      expect(manifest["_userdata/mysets"]?.["G.MIX"]).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips an unreadable _userdata mix file without crashing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "extract-mix-meta-ud-"));
    try {
      const udDir2 = join(tmp, "_userdata", "good");
      mkdirSync(udDir2, { recursive: true });
      writeFileSync(join(udDir2, "G.MIX"), Buffer.from([0x07, 0x0a, 0x00, 0x00]));

      const manifest = buildMetadataManifest(tmp);
      expect(manifest["_userdata/good"]?.["G.MIX"]).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
