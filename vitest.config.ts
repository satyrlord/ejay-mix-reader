import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/__tests__/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["scripts/**/*.ts"],
      exclude: [
        "scripts/__tests__/**",
        "scripts/test-coverage.ts",
        // One-shot investigation scripts: not part of the production
        // pipeline; documented in docs/mix-format-analysis.md.
        "scripts/investigate-mix-followups.ts",
        "scripts/probe-header-aux.ts",
        // Types-only file — no executable code to cover.
        "scripts/mix-types.ts",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage-unit",
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
