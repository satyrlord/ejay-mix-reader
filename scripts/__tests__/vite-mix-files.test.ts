import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMixFilesForCopy } from "../dev-server/mix-files.js";

describe("listMixFilesForCopy", () => {
  let archiveRoot: string;
  let outDir: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(join(tmpdir(), "mix-files-src-"));
    outDir = mkdtempSync(join(tmpdir(), "mix-files-dst-"));
    // Minimal layout matching ARCHIVE_MIX_DIRS for Dance_eJay1.
    mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "payload");
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "DEMO.MIX"), "payload2");
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("returns entries for every .mix file in a known product directory", () => {
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const productEntries = entries.filter((e) => e.productId === "Dance_eJay1");
    expect(productEntries.length).toBe(2);
  });

  it("sets src to the archive path and dest inside outDir", () => {
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const start = entries.find((e) => e.filename === "START.MIX" && e.productId === "Dance_eJay1");
    expect(start).toBeDefined();
    expect(start!.src).toBe(resolve(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"));
    expect(start!.dest).toBe(resolve(outDir, "Dance_eJay1", "START.MIX"));
  });

  it("ignores non-.mix files in the mix directory", () => {
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "readme.txt"), "x");
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const nonMix = entries.filter((e) => e.filename === "readme.txt");
    expect(nonMix).toHaveLength(0);
  });

  it("skips products whose mix directory does not exist", () => {
    // Dance_eJay2 dir is not created — should not throw or return entries for it
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const d2Entries = entries.filter((e) => e.productId === "Dance_eJay2");
    expect(d2Entries).toHaveLength(0);
  });

  it("returns an empty array when archiveRoot has no recognised subdirectories", () => {
    const empty = mkdtempSync(join(tmpdir(), "mix-files-empty-"));
    try {
      const entries = listMixFilesForCopy(empty, outDir);
      expect(entries).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("accepts recreated archive folder aliases when copying mixes", () => {
    mkdirSync(join(archiveRoot, "Dance eJay 2", "MIX"), { recursive: true });
    writeFileSync(join(archiveRoot, "Dance eJay 2", "MIX", "ALT.MIX"), "payload");

    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const aliasEntry = entries.find((entry) => entry.productId === "Dance_eJay2" && entry.filename === "ALT.MIX");
    expect(aliasEntry).toBeDefined();
    expect(aliasEntry?.src).toBe(resolve(archiveRoot, "Dance eJay 2", "MIX", "ALT.MIX"));
  });

  it("skips entries where the filesystem path is a directory, not a file", () => {
    mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX", "folder.mix"), { recursive: true });
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    const folderEntry = entries.find((e) => e.filename === "folder.mix");
    expect(folderEntry).toBeUndefined();
  });

  it("skips symlinked .mix files", () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), "mix-files-outside-"));
    try {
      const outsideMix = join(outsideRoot, "outside.mix");
      writeFileSync(outsideMix, "payload");
      const linkPath = join(archiveRoot, "Dance_eJay1", "MIX", "link.mix");
      try {
        symlinkSync(outsideMix, linkPath);
      } catch {
        return;
      }

      const entries = listMixFilesForCopy(archiveRoot, outDir);
      const symlinkEntry = entries.find((entry) => entry.filename === "link.mix");
      expect(symlinkEntry).toBeUndefined();
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("exposes productId and filename on every entry", () => {
    const entries = listMixFilesForCopy(archiveRoot, outDir);
    for (const entry of entries) {
      expect(typeof entry.productId).toBe("string");
      expect(typeof entry.filename).toBe("string");
      expect(/\.mix$/i.test(entry.filename)).toBe(true);
    }
  });

  describe("_userdata entries", () => {
    beforeEach(() => {
      mkdirSync(join(archiveRoot, "_userdata", "mysets"), { recursive: true });
      writeFileSync(join(archiveRoot, "_userdata", "mysets", "track.mix"), "payload");
    });

    it("includes userdata mixes in the result", () => {
      const entries = listMixFilesForCopy(archiveRoot, outDir);
      const ud = entries.find((e) => e.productId === "_userdata/mysets");
      expect(ud).toBeDefined();
      expect(ud!.filename).toBe("track.mix");
    });

    it("maps src and dest correctly for userdata mixes", () => {
      const entries = listMixFilesForCopy(archiveRoot, outDir);
      const ud = entries.find((e) => e.productId === "_userdata/mysets");
      expect(ud!.src).toBe(resolve(archiveRoot, "_userdata", "mysets", "track.mix"));
      expect(ud!.dest).toBe(resolve(outDir, "_userdata", "mysets", "track.mix"));
    });

    it("falls back to archive/_user and keeps canonical _userdata output paths", () => {
      rmSync(join(archiveRoot, "_userdata"), { recursive: true, force: true });
      mkdirSync(join(archiveRoot, "_user", "mysets"), { recursive: true });
      writeFileSync(join(archiveRoot, "_user", "mysets", "track.mix"), "payload");

      const entries = listMixFilesForCopy(archiveRoot, outDir);
      const ud = entries.find((e) => e.productId === "_userdata/mysets");
      expect(ud).toBeDefined();
      expect(ud!.src).toBe(resolve(archiveRoot, "_user", "mysets", "track.mix"));
      expect(ud!.dest).toBe(resolve(outDir, "_userdata", "mysets", "track.mix"));
    });
  });
});
