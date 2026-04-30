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
// Coverage mode runs Vite with Istanbul instrumentation enabled during module
// transforms, which increases startup CPU/RAM pressure and makes high
// parallelism more failure-prone.
// The defaults were chosen empirically for this repo:
// - 2 workers in coverage mode: avoids transform/serve contention and flaky CI starts.
// - 4 workers in normal mode: keeps local runs reasonably fast without overloading Vite.
const defaultWorkers = coverageEnabled ? 2 : 4;
const parsedWorkers = process.env.PLAYWRIGHT_WORKERS
  ? parseInt(process.env.PLAYWRIGHT_WORKERS, 10)
  : defaultWorkers;
const workers = !isNaN(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : defaultWorkers;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  // Coverage runs are more resource-intensive and occasionally hit transient
  // startup/network flakes locally; allow one retry in that mode.
  retries: coverageEnabled || isCI ? 1 : 0,
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
    // Instrumented coverage builds take longer to transform modules before the
    // server is reachable, so allow extra startup headroom in that mode.
    timeout: coverageEnabled ? 90_000 : 60_000,
  },
});
