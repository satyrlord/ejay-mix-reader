import { describe, expect, it } from "vitest";
import {
  cleanName,
  extractBase,
  numericSortKey,
  planRenames,
  applyRenames,
  type ConsolidatedMetadata,
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

// ── planRenames ──────────────────────────────────────────────

describe("planRenames", () => {
  it("plans filename normalization (lowercasing, special chars)", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "My_Bass (1).wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "My_Bass (1).wav", alias: "My Bass (1)", category: "Bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].new_filename).toMatch(/\.wav$/);
      expect(plan[0].new_filename).not.toContain("(");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty plan when nothing changes", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "kick.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "kick.wav", category: "bass" },
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
      const catDir = join(tmp, "bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "kick-1.wav"), Buffer.alloc(10));
      writeFileSync(join(catDir, "kick-2.wav"), Buffer.alloc(10));
      writeFileSync(join(catDir, "kick-3.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "kick-1.wav", category: "bass" },
          { filename: "kick-2.wav", category: "bass" },
          { filename: "kick-3.wav", category: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
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
      const catDir = join(tmp, "bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "synth-1.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "synth-1.wav", category: "bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      const entry = plan.find((e) => e.new_filename.startsWith("synth"));
      expect(entry).toBeDefined();
      expect(entry!.new_filename).toBe("synth.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles subcategory in path", () => {
    const tmp = createTempDir();
    try {
      const subDir = join(tmp, "Voice", "misc");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "SHOUT_01.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "SHOUT_01.wav", category: "Voice", subcategory: "misc" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBe(1);
      expect(plan[0].old_path).toBe(join(subDir, "SHOUT_01.wav"));
      expect(plan[0].new_path).toBe(join(subDir, "shout.wav"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("filters by product when option is set", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "KICK_A.wav"), Buffer.alloc(10));
      writeFileSync(join(catDir, "KICK_B.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "KICK_A.wav", category: "Bass", product: "ProductA" },
          { filename: "KICK_B.wav", category: "Bass", product: "ProductB" },
        ],
      };

      const plan = planRenames(tmp, meta, { product: "ProductA" });
      expect(plan.length).toBe(1);
      expect(plan[0].old_filename).toBe("KICK_A.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("groups files that clean to the same base instead of colliding", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "FOO_BAR.wav"), Buffer.alloc(10));
      writeFileSync(join(catDir, "FOO-BAR.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "FOO_BAR.wav", category: "Bass" },
          { filename: "FOO-BAR.wav", category: "Bass" },
        ],
      };

      const plan = planRenames(tmp, meta);
      const newFilenames = plan.map((e) => e.new_filename);
      // Both clean to base "foo-bar" and get renumbered
      expect(newFilenames).toContain("foo-bar-01.wav");
      expect(newFilenames).toContain("foo-bar-02.wav");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves alias, detail, and category in metadata", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "Drum&Bass_160bpm_SNTHBASS001_D+B_160_C_ST.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          {
            filename: "Drum&Bass_160bpm_SNTHBASS001_D+B_160_C_ST.wav",
            alias: "SNTHBASS001_D+B_160_C_ST",
            category: "Bass",
            detail: "Drum&Bass",
          },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBe(1);
      // Filename changes but alias/detail/category are not in the plan
      expect(plan[0].new_filename).not.toContain("&");
      expect(plan[0].new_filename).not.toContain("+");
      // The plan only contains filename fields, not alias/detail/category
      expect(plan[0]).not.toHaveProperty("new_alias");
      expect(plan[0]).not.toHaveProperty("new_category");
      expect(plan[0]).not.toHaveProperty("new_detail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── applyRenames ─────────────────────────────────────────────

describe("applyRenames", () => {
  it("renames files on disk and updates filename in metadata", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "OLD.wav"), "pcm-data");

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "OLD.wav", alias: "Old Sound", category: "Bass", detail: "Big Bass" },
        ],
      };

      const plan: RenameEntry[] = [
        {
          index: 0,
          old_path: join(catDir, "OLD.wav"),
          new_path: join(catDir, "old.wav"),
          old_filename: "OLD.wav",
          new_filename: "old.wav",
        },
      ];

      const renamed = applyRenames(tmp, meta, plan);
      expect(renamed).toBe(1);
      expect(meta.samples[0].filename).toBe("old.wav");
      // Alias and detail are NOT modified
      expect(meta.samples[0].alias).toBe("Old Sound");
      expect(meta.samples[0].detail).toBe("Big Bass");
      expect(meta.samples[0].category).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns 0 for empty plan", () => {
    const meta: ConsolidatedMetadata = { samples: [] };
    expect(applyRenames("/tmp", meta, [])).toBe(0);
  });

  it("does not modify alias, detail, or category", () => {
    const tmp = createTempDir();
    try {
      const catDir = join(tmp, "Bass");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "Drum&Bass_160bpm_X.wav"), "pcm");

      const meta: ConsolidatedMetadata = {
        samples: [
          {
            filename: "Drum&Bass_160bpm_X.wav",
            alias: "SNTHBASS001_D+B_160_C_ST",
            category: "Bass",
            detail: "Drum&Bass",
          },
        ],
      };

      const plan: RenameEntry[] = [{
        index: 0,
        old_path: join(catDir, "Drum&Bass_160bpm_X.wav"),
        new_path: join(catDir, "drum-bass-160bpm-x.wav"),
        old_filename: "Drum&Bass_160bpm_X.wav",
        new_filename: "drum-bass-160bpm-x.wav",
      }];

      applyRenames(tmp, meta, plan);
      expect(meta.samples[0].filename).toBe("drum-bass-160bpm-x.wav");
      expect(meta.samples[0].alias).toBe("SNTHBASS001_D+B_160_C_ST");
      expect(meta.samples[0].detail).toBe("Drum&Bass");
      expect(meta.samples[0].category).toBe("Bass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("restores original files when a final rename fails", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Bass");
      mkdirSync(dir, { recursive: true });

      const oldOne = join(dir, "one.wav");
      const oldTwo = join(dir, "two.wav");
      writeFileSync(oldOne, "one");
      writeFileSync(oldTwo, "two");
      mkdirSync(join(dir, "blocked.wav"), { recursive: true });

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "one.wav", category: "Bass" },
          { filename: "two.wav", category: "Bass" },
        ],
      };

      const plan: RenameEntry[] = [
        {
          index: 0,
          old_path: oldOne,
          new_path: join(dir, "renamed.wav"),
          old_filename: "one.wav",
          new_filename: "renamed.wav",
        },
        {
          index: 1,
          old_path: oldTwo,
          new_path: join(dir, "blocked.wav"),
          old_filename: "two.wav",
          new_filename: "blocked.wav",
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
  it("uses Unsorted as fallback when category is missing", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Unsorted");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "HIT_01.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "HIT_01.wav" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].old_path).toContain("Unsorted");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles null subcategory same as missing", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Bass");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "KICK_01.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "KICK_01.wav", category: "Bass", subcategory: null },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBe(1);
      // Path should NOT include null subcategory
      expect(plan[0].old_path).toBe(join(tmp, "Bass", "KICK_01.wav"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles empty detail field without modifying it", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Bass");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "X-1.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "X-1.wav", category: "Bass", detail: "" },
        ],
      };

      const plan = planRenames(tmp, meta);
      expect(plan.length).toBe(1);
      // detail is not tracked in plan
      expect(plan[0]).not.toHaveProperty("new_detail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("collision between renamed and skipped file throws", () => {
    const tmp = createTempDir();
    try {
      const dir = join(tmp, "Bass");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "kick.wav"), Buffer.alloc(10));
      writeFileSync(join(dir, "KICK.wav"), Buffer.alloc(10));

      const meta: ConsolidatedMetadata = {
        samples: [
          { filename: "kick.wav", category: "Bass", product: "A" },
          { filename: "KICK.wav", category: "Bass", product: "B" },
        ],
      };

      // Filtering by product B: "kick.wav" (product A) is skipped,
      // "KICK.wav" cleans to "kick.wav" — collision with skipped file
      expect(() => planRenames(tmp, meta, { product: "B" })).toThrow(/collision/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
