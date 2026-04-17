import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  DRUM_SUBS,
  FINAL_CATEGORIES,
  VOICE_SUBS,
  chooseFlatFilename,
  classify,
  classifyDrumSub,
  classifyVoiceSub,
  isOrchestral,
  listProductDirs,
  normalize,
  scaffoldTree,
} from "../normalize.js";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "ejay-normalize-"));
}

// ── Constants ────────────────────────────────────────────────

describe("constants", () => {
  it("exposes the expected final category list", () => {
    expect(FINAL_CATEGORIES).toContain("Loop");
    expect(FINAL_CATEGORIES).toContain("Sequence");
    expect(FINAL_CATEGORIES).toContain("Orchestral");
    expect(FINAL_CATEGORIES).toContain("Unsorted");
  });

  it("exposes drum and voice subs", () => {
    expect(DRUM_SUBS).toContain("kick");
    expect(DRUM_SUBS).toContain("clap");
    expect(VOICE_SUBS).toContain("rap male");
    expect(VOICE_SUBS).toContain("robot");
  });
});

// ── isOrchestral ─────────────────────────────────────────────

describe("isOrchestral", () => {
  it("returns true when keyword is in category", () => {
    expect(isOrchestral({ category: "violin pluck" })).toBe(true);
    expect(isOrchestral({ category: "brass stab" })).toBe(true);
    expect(isOrchestral({ category: "choir" })).toBe(true);
    expect(isOrchestral({ alias: "symphonic pad" })).toBe(true);
  });

  it("returns false when no keyword matches", () => {
    expect(isOrchestral({ category: "bazz" })).toBe(false);
    expect(isOrchestral({})).toBe(false);
    expect(isOrchestral({ alias: "", category: "" })).toBe(false);
  });
});

// ── Drum sub classification ──────────────────────────────────

describe("classifyDrumSub", () => {
  it.each([
    ["kick drum", "kick"],
    ["BD 909", "kick"],
    ["clap loud", "clap"],
    ["snare crisp", "snare"],
    ["rim shot", "snare"],
    ["hihat open", "hi-hats"],
    ["hi-hat closed", "hi-hats"],
    ["tom high", "toms"],
    ["crash ride", "crash"],
    ["cymbal splash", "crash"],
    ["conga hit", "perc"],
    ["cowbell", "perc"],
  ])("classifies %q as %s", (category, expected) => {
    expect(classifyDrumSub({ category })).toBe(expected);
  });

  it("falls back to perc when no keyword matches", () => {
    expect(classifyDrumSub({ category: "unknown stuff" })).toBe("perc");
    expect(classifyDrumSub({})).toBe("perc");
  });
});

// ── Voice sub classification ─────────────────────────────────

describe("classifyVoiceSub", () => {
  it("detects robot via keywords", () => {
    expect(classifyVoiceSub({ alias: "vocoder vox" }, null)).toBe("robot");
    expect(classifyVoiceSub({ category: "talkbox" }, null)).toBe("robot");
  });

  it("combines style and gender from text", () => {
    expect(classifyVoiceSub({ category: "rap female" }, null)).toBe("rap female");
    expect(classifyVoiceSub({ category: "sing male" }, null)).toBe("sing male");
  });

  it("uses channel hints when text lacks gender or style", () => {
    expect(classifyVoiceSub({ category: "rap verse" }, "female")).toBe("rap female");
    expect(classifyVoiceSub({ category: "vocal hook" }, "male")).toBe("sing male");
    expect(classifyVoiceSub({ category: "woman speaking" }, "rap")).toBe("rap female");
  });

  it("falls back to misc when style or gender is unknown", () => {
    expect(classifyVoiceSub({ alias: "one" }, null)).toBe("misc");
    expect(classifyVoiceSub({ category: "rap verse" }, null)).toBe("misc");
    expect(classifyVoiceSub({ category: "vocal hook" }, null)).toBe("misc");
  });
});

// ── classify ─────────────────────────────────────────────────

describe("classify", () => {
  it("routes orchestral samples regardless of channel", () => {
    const result = classify(
      { internal_name: "PN100", category: "pizzicato strings" },
      "test",
    );
    expect(result).toEqual({ category: "Orchestral", subcategory: null });
  });

  it("routes drum beat-loop prefixes to Loop", () => {
    const result = classify({ internal_name: "DA001", category: "drum beat" }, "dance_ejay1");
    expect(result).toEqual({ category: "Loop", subcategory: null });
  });

  it("routes single drum hits to Drum with subcategory", () => {
    const result = classify(
      { internal_name: "MA001", category: "kick drum" },
      "dance_ejay2",
    );
    expect(result).toEqual({ category: "Drum", subcategory: "kick" });
  });

  it("routes bass prefix to Bass", () => {
    expect(classify({ internal_name: "BS001", category: "bass" }, "p")).toEqual({
      category: "Bass",
      subcategory: null,
    });
  });

  it("routes guitar prefix to Guitar", () => {
    expect(classify({ internal_name: "GT001", category: "guitar" }, "p")).toEqual({
      category: "Guitar",
      subcategory: null,
    });
  });

  it("routes keys and seq to Keys", () => {
    expect(classify({ internal_name: "PN001", category: "piano" }, "p").category).toBe("Keys");
    expect(classify({ internal_name: "SQ001", category: "seq" }, "p").category).toBe("Keys");
  });

  it("routes loop and groove to Loop", () => {
    expect(classify({ internal_name: "LA001", category: "loop" }, "p").category).toBe("Loop");
    expect(
      classify({ internal_name: "HS1AEX01", category: "groove" }, "house_ejay").category,
    ).toBe("Loop");
  });

  it("routes layer/sphere/wave to Pads", () => {
    expect(classify({ internal_name: "LY001", category: "pad" }, "p").category).toBe("Pads");
    expect(classify({ internal_name: "EY001", category: "wave" }, "p").category).toBe("Pads");
    expect(
      classify({ internal_name: "SRC001", category: "sphere" }, "techno_ejay3").category,
    ).toBe("Pads");
  });

  it("routes voice variants", () => {
    const voice = classify(
      { internal_name: "VA001", category: "vocal hook" },
      "p",
    );
    expect(voice.category).toBe("Voice");
    expect(VOICE_SUBS).toContain(voice.subcategory as (typeof VOICE_SUBS)[number]);

    const rap = classify({ internal_name: "RP001", category: "rap male" }, "p");
    expect(rap).toEqual({ category: "Voice", subcategory: "rap male" });
  });

  it("routes HipHop 4 Ladies and Fellas with gender hint", () => {
    const ladies = classify(
      { internal_name: "HIPHOP_FEMALE001", category: "singing" },
      "hiphop_ejay4",
    );
    expect(ladies).toEqual({ category: "Voice", subcategory: "sing female" });

    const fellas = classify(
      { internal_name: "HIPHOP_MALE001", category: "rap verse" },
      "hiphop_ejay4",
    );
    expect(fellas).toEqual({ category: "Voice", subcategory: "rap male" });
  });

  it("routes effects, scratch, and extras", () => {
    expect(classify({ internal_name: "FX001", category: "fx" }, "p").category).toBe("Effect");
    expect(classify({ internal_name: "ST001", category: "scratch" }, "p").category).toBe("Scratch");
    expect(classify({ internal_name: "SX001", category: "sax" }, "p").category).toBe("Orchestral");
    expect(classify({ internal_name: "EX001", category: "extra" }, "p").category).toBe("Extra");
  });

  it("derives internal name from source when missing", () => {
    const result = classify({ source: "MA099.PXD", category: "kick drum" }, "p");
    expect(result).toEqual({ category: "Drum", subcategory: "kick" });
  });

  it("falls back to Extra when getChannel cannot resolve a prefix", () => {
    const result = classify({ internal_name: "Q99", category: "" }, "p");
    expect(result.category).toBe("Extra");
  });
});

// ── chooseFlatFilename ───────────────────────────────────────

describe("chooseFlatFilename", () => {
  it("uses the base name when there is no collision", () => {
    const dir = tmpRoot();
    try {
      const taken = new Set<string>();
      expect(chooseFlatFilename(dir, "Bass/BS001.wav", "prod", taken)).toBe("BS001.wav");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to product-prefixed name when base is taken", () => {
    const dir = tmpRoot();
    try {
      writeFileSync(join(dir, "BS001.wav"), "x");
      const taken = new Set<string>();
      expect(chooseFlatFilename(dir, "BS001.wav", "prod", taken)).toBe("prod__BS001.wav");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends numeric suffix when prefixed name also clashes", () => {
    const dir = tmpRoot();
    try {
      writeFileSync(join(dir, "BS001.wav"), "x");
      writeFileSync(join(dir, "prod__BS001.wav"), "x");
      const taken = new Set<string>();
      expect(chooseFlatFilename(dir, "BS001.wav", "prod", taken)).toBe("prod__BS001 (2).wav");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remembers in-session takes to avoid same-run collisions", () => {
    const dir = tmpRoot();
    try {
      const taken = new Set<string>();
      const first = chooseFlatFilename(dir, "LP01.wav", "prod", taken);
      const second = chooseFlatFilename(dir, "LP01.wav", "prod", taken);
      expect(first).toBe("LP01.wav");
      expect(second).toBe("prod__LP01.wav");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── listProductDirs ──────────────────────────────────────────

describe("listProductDirs", () => {
  it("returns [] when the root does not exist", () => {
    expect(listProductDirs(join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });

  it("lists only dirs with metadata.json and skips underscore-prefixed dirs", () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, "Alpha"));
      writeFileSync(join(root, "Alpha", "metadata.json"), "{}");
      mkdirSync(join(root, "Beta"));
      // no metadata.json in Beta
      mkdirSync(join(root, "_normalized"));
      writeFileSync(join(root, "_normalized", "metadata.json"), "{}");

      const dirs = listProductDirs(root);
      expect(dirs.map((d) => d.replace(root, "").replace(/^[\\/]/, ""))).toEqual(["Alpha"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── scaffoldTree ─────────────────────────────────────────────

describe("scaffoldTree", () => {
  it("creates all categories and subcategories", () => {
    const root = tmpRoot();
    try {
      const dest = join(root, "out");
      scaffoldTree(dest);
      for (const cat of FINAL_CATEGORIES) {
        expect(existsSync(join(dest, cat))).toBe(true);
      }
      for (const sub of DRUM_SUBS) {
        expect(existsSync(join(dest, "Drum", sub))).toBe(true);
      }
      for (const sub of VOICE_SUBS) {
        expect(existsSync(join(dest, "Voice", sub))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── normalize integration ────────────────────────────────────

describe("normalize", () => {
  it("flattens samples from multiple products into a single tree", () => {
    const root = tmpRoot();
    try {
      // product A: one bass, one drum kick, one orchestral-by-keyword
      const a = join(root, "ProductA");
      mkdirSync(a, { recursive: true });
      writeFileSync(join(a, "BS001.wav"), "a-bass");
      writeFileSync(join(a, "MA001.wav"), "a-kick");
      writeFileSync(join(a, "PN050.wav"), "a-violin"); // promoted via category
      writeFileSync(
        join(a, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "BS001.wav", internal_name: "BS001", category: "bass", alias: "1" },
            { filename: "MA001.wav", internal_name: "MA001", category: "kick drum", alias: "2" },
            { filename: "PN050.wav", internal_name: "PN050", category: "violin strings", alias: "3" },
          ],
        }),
      );

      // product B: bass collision (same base filename) and a scratch
      const b = join(root, "ProductB");
      mkdirSync(b, { recursive: true });
      writeFileSync(join(b, "BS001.wav"), "b-bass");
      writeFileSync(join(b, "ST001.wav"), "b-scratch");
      writeFileSync(
        join(b, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "BS001.wav", internal_name: "BS001", category: "bass" },
            { filename: "ST001.wav", internal_name: "ST001", category: "scratch" },
          ],
        }),
      );

      // product C with a missing-on-disk sample (exercises skipped path)
      const c = join(root, "ProductC");
      mkdirSync(c, { recursive: true });
      writeFileSync(
        join(c, "metadata.json"),
        JSON.stringify({
          samples: [
            { filename: "", internal_name: "EMPTY" },
            { filename: "missing.wav", internal_name: "XX001" },
          ],
        }),
      );

      // underscore dir that must be skipped
      mkdirSync(join(root, "_cache"), { recursive: true });
      writeFileSync(join(root, "_cache", "metadata.json"), "{}");

      const dest = join(root, "_normalized");
      const result = normalize({ outputRoot: root, dest });

      expect(result.processed).toBe(5);
      expect(result.skipped).toBe(2);
      expect(result.perCategory["Bass"]).toBe(2);
      expect(result.perCategory["Drum/kick"]).toBe(1);
      expect(result.perCategory["Orchestral"]).toBe(1);
      expect(result.perCategory["Scratch"]).toBe(1);

      // Collision: ProductA kept the bare name, ProductB got the prefix.
      expect(existsSync(join(dest, "Bass", "BS001.wav"))).toBe(true);
      expect(existsSync(join(dest, "Bass", "ProductB__BS001.wav"))).toBe(true);
      expect(existsSync(join(dest, "Drum", "kick", "MA001.wav"))).toBe(true);
      expect(existsSync(join(dest, "Orchestral", "PN050.wav"))).toBe(true);
      expect(existsSync(join(dest, "Scratch", "ST001.wav"))).toBe(true);

      // Sources preserved (copy default).
      expect(existsSync(join(a, "BS001.wav"))).toBe(true);

      // Consolidated metadata written.
      const meta = JSON.parse(readFileSync(join(dest, "metadata.json"), "utf-8")) as {
        total_samples: number;
        per_category: Record<string, number>;
        samples: Array<{ category: string; product: string; original_filename: string }>;
      };
      expect(meta.total_samples).toBe(5);
      expect(meta.samples.every((s) => s.product && s.original_filename)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports move mode and dry-run mode", () => {
    const root = tmpRoot();
    try {
      const a = join(root, "P");
      mkdirSync(a, { recursive: true });
      writeFileSync(join(a, "BS001.wav"), "x");
      writeFileSync(
        join(a, "metadata.json"),
        JSON.stringify({
          samples: [{ filename: "BS001.wav", internal_name: "BS001", category: "bass" }],
        }),
      );

      // Dry run: no destination files, no metadata.json under dest.
      const dryDest = join(root, "_dry");
      const dryResult = normalize({ outputRoot: root, dest: dryDest, dryRun: true });
      expect(dryResult.processed).toBe(1);
      expect(existsSync(join(dryDest, "Bass", "BS001.wav"))).toBe(false);
      expect(existsSync(join(dryDest, "metadata.json"))).toBe(false);

      // Move mode: source disappears, dest exists.
      const moveDest = join(root, "_moved");
      normalize({ outputRoot: root, dest: moveDest, move: true });
      expect(existsSync(join(a, "BS001.wav"))).toBe(false);
      expect(existsSync(join(moveDest, "Bass", "BS001.wav"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
