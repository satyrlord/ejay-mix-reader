import { describe, expect, it } from "vitest";
import {
  cleanName,
  extractBase,
  numericSortKey,
  deriveAlias,
  planRenames,
  applyRenames,
  type ProductMetadata,
  type RenameEntry,
} from "../rename-samples.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ejay-rename-"));
}

// ── cleanName ────────────────────────────────────────────────

describe("cleanName", () => {
  it("lowercases the name", () => {
    expect(cleanName("MyBASS")).toBe("mybass");
  });

  it("replaces non-alphanumeric characters with dashes", () => {
    expect(cleanName("bass_drum (01)")).toBe("bass-drum-01");
  });

  it("collapses multiple dashes", () => {
    expect(cleanName("a---b")).toBe("a-b");
  });

  it("strips leading and trailing dashes", () => {
    expect(cleanName("-abc-")).toBe("abc");
  });

  it("returns 'unnamed' for empty result", () => {
    expect(cleanName("---")).toBe("unnamed");
    expect(cleanName("")).toBe("unnamed");
  });

  it("keeps digits", () => {
    expect(cleanName("bass01")).toBe("bass01");
  });

  it("handles spaces and special characters", () => {
    expect(cleanName("Hi!  @There#")).toBe("hi-there");
  });
});

// ── extractBase ──────────────────────────────────────────────

describe("extractBase", () => {
  it("strips single trailing -N segment", () => {
    expect(extractBase("kick-1")).toBe("kick");
  });

  it("strips multiple trailing -N segments", () => {
    expect(extractBase("warm-line-1-01")).toBe("warm-line");
  });

  it("leaves stem without trailing number unchanged", () => {
    expect(extractBase("synth")).toBe("synth");
  });

  it("strips from kick-e-fig-2", () => {
    expect(extractBase("kick-e-fig-2")).toBe("kick-e-fig");
  });

  it("handles multi-digit numbers", () => {
    expect(extractBase("loop-123")).toBe("loop");
  });

  it("handles stem that is just a number-like suffix", () => {
    // "01" has no dash prefix to strip — remains as-is
    expect(extractBase("01")).toBe("01");
  });
});

// ── numericSortKey ───────────────────────────────────────────

describe("numericSortKey", () => {
  it("extracts numeric segments", () => {
    expect(numericSortKey("bass-01-drum-02")).toEqual([1, 2]);
  });

  it("returns empty array for no numbers", () => {
    expect(numericSortKey("bass")).toEqual([]);
  });

  it("handles multi-digit numbers", () => {
    expect(numericSortKey("sample-123")).toEqual([123]);
  });

  it("handles consecutive numbers", () => {
    expect(numericSortKey("3x42")).toEqual([3, 42]);
  });
});

// ── deriveAlias ──────────────────────────────────────────────

describe("deriveAlias", () => {
  it("strips category prefix from stem", () => {
    expect(deriveAlias("bass-warm", "bass")).toBe("warm");
  });

  it("returns full stem when no category match", () => {
    expect(deriveAlias("kick-hard", "bass")).toBe("kick-hard");
  });

  it("returns full stem when stripping yields category itself", () => {
    // stem="no-no", cat="no" → candidate="no" == cat → keep full
    expect(deriveAlias("no-no", "no")).toBe("no-no");
  });

  it("returns full stem when category is empty", () => {
    expect(deriveAlias("kick-01", "")).toBe("kick-01");
  });

  it("strips correctly when category has dashes", () => {
    expect(deriveAlias("hip-hop-beat", "hip-hop")).toBe("beat");
  });
});

// ── planRenames ──────────────────────────────────────────────

describe("planRenames", () => {
  it("plans filename normalization (lowercasing, special chars)", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "Bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "My_Bass (1).wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "My_Bass (1).wav", alias: "My Bass (1)", category: "Bass", channel: "Bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].new_filename).toMatch(/\.wav$/);
      // The new filename should be normalized
      expect(plan[0].new_filename).not.toContain("(");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty plan when nothing changes", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "kick.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "kick.wav", alias: "kick", category: "bass", channel: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("renumbers groups with same base name", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "kick-1.wav"), Buffer.alloc(10));
      writeFileSync(join(channelDir, "kick-2.wav"), Buffer.alloc(10));
      writeFileSync(join(channelDir, "kick-3.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "kick-1.wav", alias: "Kick 1", category: "bass", channel: "bass" },
          { filename: "kick-2.wav", alias: "Kick 2", category: "bass", channel: "bass" },
          { filename: "kick-3.wav", alias: "Kick 3", category: "bass", channel: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      // Should renumber with zero-padding
      const newFilenames = plan.map((e) => e.new_filename);
      expect(newFilenames).toContain("kick-01.wav");
      expect(newFilenames).toContain("kick-02.wav");
      expect(newFilenames).toContain("kick-03.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps singletons as bare base name", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "synth-1.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "synth-1.wav", alias: "Synth 1", category: "bass", channel: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      // Singleton should get bare base (no number suffix)
      const entry = plan.find((e) => e.new_filename.startsWith("synth"));
      expect(entry).toBeDefined();
      expect(entry!.new_filename).toBe("synth.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves full normalized stem as alias when alias_mode is preserve-stem", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "Loop");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "LOOP_053_L.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        alias_mode: "preserve-stem",
        samples: [
          { filename: "LOOP_053_L.wav", alias: "LOOP_053_L", category: "loop", channel: "Loop" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan).toHaveLength(1);
      expect(plan[0].new_filename).toBe("loop-053-l.wav");
      expect(plan[0].new_alias).toBe("loop-053-l");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── applyRenames ─────────────────────────────────────────────

describe("applyRenames", () => {
  it("renames files on disk and updates metadata", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "OLD.wav"), "pcm-data");

      const meta: ProductMetadata = {
        samples: [
          { filename: "OLD.wav", alias: "Old", category: "bass", channel: "bass" },
        ],
      };

      const plan: RenameEntry[] = [
        {
          index: "0",
          old_path: join(channelDir, "OLD.wav"),
          new_path: join(channelDir, "new.wav"),
          old_filename: "OLD.wav",
          new_filename: "new.wav",
          old_alias: "Old",
          new_alias: "new",
          old_category: "bass",
          new_category: "bass",
          old_detail: "",
          new_detail: "",
        },
      ];

      const renamed = applyRenames(tmp, meta, plan);
      expect(renamed).toBe(1);
      expect(meta.samples[0].filename).toBe("new.wav");
      expect(meta.samples[0].alias).toBe("new");
      // Check file on disk
      expect(readFileSync(join(channelDir, "new.wav"), "utf-8")).toBe("pcm-data");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles meta-only changes (no disk rename)", () => {
    const tmp = createTempDir();
    try {
      const channelDir = join(tmp, "bass");
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(join(channelDir, "kick.wav"), "data");

      const meta: ProductMetadata = {
        samples: [
          { filename: "kick.wav", alias: "Old Alias", category: "BASS", channel: "bass" },
        ],
      };

      const samePath = join(channelDir, "kick.wav");
      const plan: RenameEntry[] = [
        {
          index: "0",
          old_path: samePath,
          new_path: samePath,
          old_filename: "kick.wav",
          new_filename: "kick.wav",
          old_alias: "Old Alias",
          new_alias: "kick",
          old_category: "BASS",
          new_category: "bass",
          old_detail: "",
          new_detail: "",
        },
      ];

      const renamed = applyRenames(tmp, meta, plan);
      expect(renamed).toBe(0);
      expect(meta.samples[0].alias).toBe("kick");
      expect(meta.samples[0].category).toBe("bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns 0 for empty plan", () => {
    const meta: ProductMetadata = { samples: [] };
    expect(applyRenames("/tmp", meta, [])).toBe(0);
  });

  it("handles slash-containing filenames in metadata", () => {
    const tmp = createTempDir();
    try {
      const subDir = join(tmp, "Bass");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "OLD.wav"), "pcm");

      const meta: ProductMetadata = {
        samples: [
          { filename: "Bass/OLD.wav", alias: "Old" },
        ],
      };

      const plan: RenameEntry[] = [{
        index: "0",
        old_path: join(subDir, "OLD.wav"),
        new_path: join(subDir, "new.wav"),
        old_filename: "Bass/OLD.wav",
        new_filename: "Bass/new.wav",
        old_alias: "Old",
        new_alias: "new",
        old_category: "",
        new_category: "",
        old_detail: "",
        new_detail: "",
      }];

      const renamed = applyRenames(tmp, meta, plan);
      expect(renamed).toBe(1);
      expect(meta.samples[0].filename).toBe("Bass/new.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("updates detail field when present in sample", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "bass");
      mkdirSync(dir, { recursive: true });
      const p = join(dir, "x.wav");
      writeFileSync(p, "data");

      const meta: ProductMetadata = {
        samples: [
          { filename: "x.wav", alias: "X", category: "bass", channel: "bass", detail: "Old Detail" },
        ],
      };

      const plan: RenameEntry[] = [{
        index: "0",
        old_path: p,
        new_path: p,
        old_filename: "x.wav",
        new_filename: "x.wav",
        old_alias: "X",
        new_alias: "x",
        old_category: "bass",
        new_category: "bass",
        old_detail: "Old Detail",
        new_detail: "new-detail",
      }];

      applyRenames(tmp, meta, plan);
      expect(meta.samples[0].detail).toBe("new-detail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("restores original files when a final rename fails", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "bass");
      mkdirSync(dir, { recursive: true });

      const oldOne = join(dir, "one.wav");
      const oldTwo = join(dir, "two.wav");
      writeFileSync(oldOne, "one");
      writeFileSync(oldTwo, "two");
      mkdirSync(join(dir, "blocked.wav"), { recursive: true });

      const meta: ProductMetadata = {
        samples: [
          { filename: "one.wav", alias: "One", category: "bass", channel: "bass" },
          { filename: "two.wav", alias: "Two", category: "bass", channel: "bass" },
        ],
      };

      const plan: RenameEntry[] = [
        {
          index: "0",
          old_path: oldOne,
          new_path: join(dir, "renamed.wav"),
          old_filename: "one.wav",
          new_filename: "renamed.wav",
          old_alias: "One",
          new_alias: "renamed",
          old_category: "bass",
          new_category: "bass",
          old_detail: "",
          new_detail: "",
        },
        {
          index: "1",
          old_path: oldTwo,
          new_path: join(dir, "blocked.wav"),
          old_filename: "two.wav",
          new_filename: "blocked.wav",
          old_alias: "Two",
          new_alias: "blocked",
          old_category: "bass",
          new_category: "bass",
          old_detail: "",
          new_detail: "",
        },
      ];

      expect(() => applyRenames(tmp, meta, plan)).toThrow();
      expect(readFileSync(oldOne, "utf-8")).toBe("one");
      expect(readFileSync(oldTwo, "utf-8")).toBe("two");
      expect(existsSync(join(dir, "renamed.wav"))).toBe(false);
      expect(meta.samples[0].filename).toBe("one.wav");
      expect(meta.samples[1].filename).toBe("two.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── planRenames edge cases ───────────────────────────────────

describe("planRenames - edge cases", () => {
  it("handles slash-containing filenames for physical path", () => {
    const tmp = createTempDir();
    try {
      const subDir = join(tmp, "Bass");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "KICK_01.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "Bass/KICK_01.wav", alias: "Kick", category: "Bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
      // new_filename should preserve the prefix
      expect(plan[0].new_filename).toMatch(/^Bass\//);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses category as fallback for channel in physical path", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Drum");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "HIT_01.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "HIT_01.wav", alias: "Hit", category: "Drum" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("derives alias by stripping category prefix", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "bass");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "bass-warm.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "bass-warm.wav", alias: "Bass Warm", category: "bass", channel: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      const entry = plan.find((e) => e.new_alias === "warm");
      expect(entry).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles empty detail field", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "bass");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "X-1.wav"), Buffer.alloc(10));

      const meta: ProductMetadata = {
        samples: [
          { filename: "X-1.wav", alias: "X", category: "bass", channel: "bass", detail: "" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].new_detail).toBe("");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
