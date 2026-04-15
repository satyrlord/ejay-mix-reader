import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["tools/**/*.ts"],
      exclude: ["tools/__tests__/**"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage-unit",
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
