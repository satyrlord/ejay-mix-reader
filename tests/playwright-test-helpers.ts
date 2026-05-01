import type { Page } from "@playwright/test";

export const browserAppStartupTimeoutMs = process.env.VITE_COVERAGE === "true" ? 15_000 : 10_000;

export async function openHomeAndWaitForNetworkIdle(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

export async function openCoverageHarnessAndWaitForNetworkIdle(page: Page): Promise<void> {
  await page.goto("/coverage-harness.html");
  await page.waitForLoadState("networkidle");
}
