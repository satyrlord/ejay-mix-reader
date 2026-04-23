import { defineConfig } from "@playwright/test";

const HOST = "127.0.0.1";
const coverageEnabled = process.env.VITE_COVERAGE === "true";
const defaultPort = coverageEnabled ? 3001 : 3002;
const parsedPort = process.env.PLAYWRIGHT_PORT ? parseInt(process.env.PLAYWRIGHT_PORT, 10) : NaN;
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : defaultPort;
const BASE_URL = `http://${HOST}:${PORT}`;
const isCI = process.env.CI === "true";
const allowServerReuse = process.env.PLAYWRIGHT_REUSE_SERVER === "true";
// PLAYWRIGHT_WORKERS lets CI/local environments tune parallelism without code changes.
const parsedWorkers = process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS, 10) : 4;
const workers = !isNaN(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : 4;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // Limit worker count to reduce resource contention with the Vite web server
  // and improve test stability in local/CI runs, even if it increases runtime.
  workers,
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `npx vite --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    env: {
      ...process.env,
      VITE_COVERAGE: coverageEnabled ? "true" : "false",
      VITE_DEV_SERVER_PORT: String(PORT),
    },
    // Prefer deterministic runs: start a fresh Vite server by default so
    // build/version assertions cannot read stale state from an existing server.
    // Opt in to reuse with PLAYWRIGHT_REUSE_SERVER=true for local debugging.
    reuseExistingServer: !coverageEnabled && allowServerReuse,
    timeout: 60_000,
  },
});
