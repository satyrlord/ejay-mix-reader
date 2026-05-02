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
        "scripts/**/*.d.ts",
        "scripts/__tests__/**",
        "scripts/test-coverage.ts",
        // Reverse-engineering investigation utility (record dumper),
        // intentionally outside the browser runtime pipeline.
        "scripts/mix-format-cd-records.ts",
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
