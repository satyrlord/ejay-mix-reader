import { describe, expect, it } from "vitest";

import { COVERAGE_SOURCE_FILES, WARMUP_FILES } from "../dev-server/warmup.js";

describe("warmup constants", () => {
  it("COVERAGE_SOURCE_FILES is a non-empty tuple of src/*.ts paths", () => {
    expect(COVERAGE_SOURCE_FILES.length).toBeGreaterThan(0);
    for (const file of COVERAGE_SOURCE_FILES) {
      expect(file).toMatch(/^src\//);
      expect(file).toMatch(/\.ts$/);
    }
  });

  it("WARMUP_FILES is a superset of COVERAGE_SOURCE_FILES", () => {
    for (const file of COVERAGE_SOURCE_FILES) {
      expect(WARMUP_FILES).toContain(file);
    }
  });

  it("WARMUP_FILES includes app.css", () => {
    expect(WARMUP_FILES).toContain("src/app.css");
  });

  it("COVERAGE_SOURCE_FILES includes src/product-mode.ts", () => {
    expect(COVERAGE_SOURCE_FILES).toContain("src/product-mode.ts");
  });

  it("WARMUP_FILES is exactly one entry larger than COVERAGE_SOURCE_FILES", () => {
    expect(WARMUP_FILES.length).toBe(COVERAGE_SOURCE_FILES.length + 1);
  });
});
