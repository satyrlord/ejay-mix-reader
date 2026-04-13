import { resolve } from "path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import istanbulPlugin from "vite-plugin-istanbul";

const COVERAGE_SOURCE_FILES = ["src/main.ts"] as const;

export default defineConfig({
  appType: "spa",
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), "index.html"),
      },
    },
  },
  plugins: [
    tailwindcss(),
    ...(process.env.VITE_COVERAGE === "true"
      ? [istanbulPlugin({
          include: [...COVERAGE_SOURCE_FILES],
          extension: [".ts", ".js"],
          requireEnv: true,
        })]
      : []),
  ],
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
});
