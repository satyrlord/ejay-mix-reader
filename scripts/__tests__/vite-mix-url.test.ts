import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applySampleMoveToManifest, resolveMixUrl, validateSampleMovePaths } from "../dev-server/index.js";

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

  it("returns null for __proto__ as productId (prototype-pollution guard)", () => {
    expect(resolveMixUrl("/mix/__proto__/START.MIX", archiveRoot)).toBeNull();
  });

  it("returns null for URLs with additional path segments", () => {
    expect(resolveMixUrl("/mix/Dance_eJay1/nested/START.MIX", archiveRoot)).toBeNull();
  });

  describe("_userdata groups", () => {
    beforeEach(() => {
      mkdirSync(join(archiveRoot, "_userdata", "mysets"), { recursive: true });
      writeFileSync(join(archiveRoot, "_userdata", "mysets", "track.mix"), "payload");
    });

    it("resolves a _userdata group URL", () => {
      const resolved = resolveMixUrl("/mix/_userdata%2Fmysets/track.mix", archiveRoot);
      expect(resolved).not.toBeNull();
      expect(resolved?.productId).toBe("_userdata/mysets");
      expect(resolved?.filename).toBe("track.mix");
      expect(resolved?.absolutePath).toBe(resolve(archiveRoot, "_userdata", "mysets", "track.mix"));
    });

    it("productId encodes back to a URL that resolves to the same absolutePath", () => {
      const resolved = resolveMixUrl("/mix/_userdata%2Fmysets/track.mix", archiveRoot);
      expect(resolved).not.toBeNull();
      const reconstructedUrl = `/mix/${encodeURIComponent(resolved!.productId)}/${resolved!.filename}`;
      const roundtrip = resolveMixUrl(reconstructedUrl, archiveRoot);
      expect(roundtrip?.absolutePath).toBe(resolved!.absolutePath);
    });

    it("resolves a nested _userdata path", () => {
      mkdirSync(join(archiveRoot, "_userdata", "genre", "sub1"), { recursive: true });
      writeFileSync(join(archiveRoot, "_userdata", "genre", "sub1", "a.mix"), "x");
      const resolved = resolveMixUrl("/mix/_userdata%2Fgenre%2Fsub1/a.mix", archiveRoot);
      expect(resolved).not.toBeNull();
      expect(resolved?.productId).toBe("_userdata/genre/sub1");
    });

    it("rejects _userdata path traversal via .. in the relPath", () => {
      expect(resolveMixUrl("/mix/_userdata%2F../Dance_eJay1%2FMIX/START.MIX", archiveRoot)).toBeNull();
    });

    it("rejects empty path segments in _userdata relPath", () => {
      expect(resolveMixUrl("/mix/_userdata%2F%2Fmysets/track.mix", archiveRoot)).toBeNull();
    });

    it("returns null for a missing file in a _userdata group", () => {
      expect(resolveMixUrl("/mix/_userdata%2Fmysets/missing.mix", archiveRoot)).toBeNull();
    });
  });
});

describe("applySampleMoveToManifest", () => {
  it("updates the matching sample and rebuilds manifest aggregates", () => {
    const manifest = {
      total_samples: 99,
      per_category: {
        Bass: 1,
        "Drum/kick": 1,
      },
      samples: [
        { filename: "bass.wav", category: "Bass", subcategory: null },
        { filename: "kick.wav", category: "Drum", subcategory: "kick" },
      ],
    };

    const updated = applySampleMoveToManifest(manifest, {
      filename: "kick.wav",
      oldCategory: "Drum",
      oldSubcategory: "kick",
      newCategory: "Bass",
      newSubcategory: "fills",
    });

    expect(updated).toBe(true);
    expect(manifest.samples[1]).toMatchObject({
      filename: "kick.wav",
      category: "Bass",
      subcategory: "fills",
    });
    expect(manifest.total_samples).toBe(2);
    expect(manifest.per_category).toEqual({
      Bass: 1,
      "Bass/fills": 1,
    });
  });
});

describe("validateSampleMovePaths", () => {
  let outputRoot: string;

  beforeEach(() => {
    outputRoot = mkdtempSync(join(tmpdir(), "sample-move-"));
  });

  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("returns null for valid inputs without subcategories", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", null, "Bass", null)).toBeNull();
  });

  it("returns null for valid inputs with subcategories", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", "Perc", "Bass", "fills")).toBeNull();
  });

  it("accepts filenames with legitimate embedded .. (e.g. VXB010..wav)", () => {
    expect(validateSampleMovePaths(outputRoot, "VXB010..wav", "Drum", null, "Bass", null)).toBeNull();
  });

  it("rejects .. in oldCategory", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "..", null, "Bass", null)).toBe("Invalid path component");
  });

  it("rejects .. in newCategory", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", null, "..", null)).toBe("Invalid path component");
  });

  it("rejects .. in subcategory fields", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", "..", "Bass", null)).toBe("Invalid path component");
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", null, "Bass", "..")).toBe("Invalid path component");
  });

  it("rejects / in category or subcategory", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum/evil", null, "Bass", null)).toBe("Invalid path component");
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", "sub/evil", "Bass", null)).toBe("Invalid path component");
  });

  it("rejects \\\\ in category or subcategory", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum\\evil", null, "Bass", null)).toBe("Invalid path component");
  });

  it("rejects : in category (drive-letter injection)", () => {
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "C:", null, "Bass", null)).toBe("Invalid path component");
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "Drum", null, "C:", null)).toBe("Invalid path component");
  });

  it("rejects * ? < > \\\" | in category (shell-special characters)", () => {
    for (const ch of ["*", "?", "<", ">", '"', "|"]) {
      expect(
        validateSampleMovePaths(outputRoot, "kick.wav", `Drum${ch}`, null, "Bass", null),
        `char: ${ch}`,
      ).toBe("Invalid path component");
    }
  });

  it("rejects / or \\\\ in filename", () => {
    expect(validateSampleMovePaths(outputRoot, "sub/kick.wav", "Drum", null, "Bass", null)).toBe("Invalid path component");
    expect(validateSampleMovePaths(outputRoot, "sub\\kick.wav", "Drum", null, "Bass", null)).toBe("Invalid path component");
  });

  it("rejects shell-special characters in filename", () => {
    expect(validateSampleMovePaths(outputRoot, "kick*.wav", "Drum", null, "Bass", null)).toBe("Invalid path component");
  });

  it("rejects a literal .. filename (containment guard)", () => {
    // ".." alone as filename would path.resolve to the parent category directory
    expect(validateSampleMovePaths(outputRoot, "..", "Drum", null, "Bass", null)).toBe("Invalid path component");
  });

  it("rejects a category value that would resolve outside outputRoot (drive-letter, containment)", () => {
    // "C:" passes the character-class check on POSIX but should fail the
    // UNSAFE_SEGMENT_CHARS check on all platforms (`:` is in the set).
    // This test confirms the colon rejection specifically.
    expect(validateSampleMovePaths(outputRoot, "kick.wav", "C:", null, "Drum", null)).toBe("Invalid path component");
  });
});
