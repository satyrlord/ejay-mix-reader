import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveMixUrl } from "../../vite.config.js";

describe("resolveMixUrl", () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(join(tmpdir(), "vite-mix-url-"));
    // Minimal archive layout matching ARCHIVE_MIX_DIRS for Dance_eJay1.
    mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "payload");
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it("resolves a valid /mix/<product>/<file>.mix URL to an absolute path", () => {
    const resolved = resolveMixUrl("/mix/Dance_eJay1/START.MIX", archiveRoot);
    expect(resolved).not.toBeNull();
    expect(resolved?.productId).toBe("Dance_eJay1");
    expect(resolved?.filename).toBe("START.MIX");
    expect(resolved?.absolutePath).toContain("Dance_eJay1");
  });

  it("decodes percent-encoded filenames", () => {
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "my song.mix"), "x");
    expect(resolveMixUrl("/mix/Dance_eJay1/my%20song.mix", archiveRoot)).not.toBeNull();
  });

  it("ignores query strings and hash fragments", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/START.MIX?t=1", archiveRoot)).not.toBeNull();
    expect(resolveMixUrl("/mix/Dance_eJay1/START.MIX#fragment", archiveRoot)).not.toBeNull();
  });

  it("returns null for URLs outside /mix/", () => {
    expect(resolveMixUrl("/archive/Dance_eJay1/MIX/START.MIX", archiveRoot)).toBeNull();
    expect(resolveMixUrl("/", archiveRoot)).toBeNull();
  });

  it("returns null for unknown products", () => {
    expect(resolveMixUrl("/mix/NotARealProduct/START.MIX", archiveRoot)).toBeNull();
  });

  it("rejects path traversal attempts", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/..%2FSTART.MIX", archiveRoot)).toBeNull();
    expect(resolveMixUrl("/mix/Dance_eJay1/..\\START.MIX", archiveRoot)).toBeNull();
  });

  it("rejects malformed percent encoding", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/%ZZ.mix", archiveRoot)).toBeNull();
  });

  it("rejects non-mix filenames", () => {
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "notes.txt"), "x");
    expect(resolveMixUrl("/mix/Dance_eJay1/notes.txt", archiveRoot)).toBeNull();
  });

  it("returns null when the file does not exist", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/MISSING.MIX", archiveRoot)).toBeNull();
  });

  it("returns null when the archive path is a directory", () => {
    mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX", "folder.mix"));
    expect(resolveMixUrl("/mix/Dance_eJay1/folder.mix", archiveRoot)).toBeNull();
  });

  it("returns null for URLs with additional path segments", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/nested/START.MIX", archiveRoot)).toBeNull();
  });
});
