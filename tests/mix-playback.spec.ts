import { readFileSync } from "fs";
import { join } from "path";

import type { Page } from "@playwright/test";

import { test, expect } from "./baseFixtures.js";

interface MixPlaybackCase {
  appId: number;
  productId: string;
  group: string;
  filename: string;
  trackCount: number;
  format: string | null;
}

interface IndexMixMeta {
  appId?: number;
  trackCount?: number;
  format?: string;
}

interface IndexMixFileEntry {
  filename: string;
  meta?: IndexMixMeta;
}

interface IndexMixLibraryEntry {
  id: string;
  name: string;
  mixes: IndexMixFileEntry[];
}

interface IndexDataLike {
  mixLibrary?: IndexMixLibraryEntry[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadAppIdPlaybackCases(): MixPlaybackCase[] {
  const parsed = JSON.parse(readFileSync(join(process.cwd(), "data", "index.json"), "utf-8")) as IndexDataLike;
  const cases = new Map<number, MixPlaybackCase>();

  for (const group of parsed.mixLibrary ?? []) {
    if (group.id.startsWith("_userdata/")) continue;

    for (const mix of group.mixes) {
      const appId = mix.meta?.appId;
      const trackCount = mix.meta?.trackCount ?? 0;
      if (typeof appId !== "number" || trackCount <= 0) continue;

      const nextCase: MixPlaybackCase = {
        appId,
        productId: group.id,
        group: group.name,
        filename: mix.filename,
        trackCount,
        format: mix.meta?.format ?? null,
      };
      const current = cases.get(appId);
      if (!current || nextCase.trackCount > current.trackCount) {
        cases.set(appId, nextCase);
      }
    }
  }

  return [...cases.values()].sort((left, right) => left.appId - right.appId);
}

const APP_ID_PLAYBACK_CASES = loadAppIdPlaybackCases();
const LONG_MIX_PLAYBACK_CASE = APP_ID_PLAYBACK_CASES.reduce<MixPlaybackCase | null>((selected, candidate) => {
  if (!selected) return candidate;
  return candidate.trackCount > selected.trackCount ? candidate : selected;
}, null);
const coveragePlaybackStartTimeoutMs = process.env.VITE_COVERAGE === "true" ? 60_000 : 30_000;
const mixPlaybackSuiteTimeoutMs = process.env.VITE_COVERAGE === "true" ? 120_000 : 90_000;
const mixArchiveLoadTimeoutMs = process.env.VITE_COVERAGE === "true" ? 15_000 : 5_000;

async function openMixFromArchive(page: Page, mixCase: MixPlaybackCase): Promise<void> {
  const response = await page.request.get(`/mix/${mixCase.productId}/${encodeURIComponent(mixCase.filename)}`).catch(() => null);
  if (!response || response.status() !== 200) {
    test.skip(true, `${mixCase.productId}/${mixCase.filename} not present in archive/`);
  }

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#archive-tree")).toBeVisible();

  await page.locator("#archive-tree").click();
  await expect.poll(async () => page.locator(".mix-tree-group").count(), {
    timeout: mixArchiveLoadTimeoutMs,
  }).toBeGreaterThan(0);
  const group = page.locator(".mix-tree-group").filter({ hasText: mixCase.group }).first();
  await expect(group).toBeVisible({ timeout: mixArchiveLoadTimeoutMs });

  const item = group.locator(".mix-tree-item", { hasText: mixCase.filename }).first();
  if (!await item.isVisible().catch(() => false)) {
    await group.locator(".mix-tree-group-header").click();
  }
  await expect(item).toBeVisible({ timeout: mixArchiveLoadTimeoutMs });
  await item.click();
  await expect(page.locator(".mix-meta-popup")).toHaveCount(1);
  await expect(page.locator(".context-mix-name")).toHaveText("No mix loaded");

  await item.dispatchEvent("dblclick", { bubbles: true });
  const stem = mixCase.filename.replace(/\.mix$/i, "");
  await expect(page.locator(".context-mix-name")).toHaveText(new RegExp(escapeRegex(stem), "i"));
  await expect(page.locator(".mix-meta-popup")).toHaveCount(0);
}

async function assertMixPlaybackTransport(page: Page): Promise<void> {
  const playbackStartTimeoutMs = coveragePlaybackStartTimeoutMs;
  const initialPosition = await page.locator(".seq-position").textContent();
  const initialTimeline = await page.locator(".sequencer-scroll").evaluate((el: HTMLElement) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
  }));

  expect(initialTimeline.scrollWidth).toBeGreaterThanOrEqual(initialTimeline.clientWidth);
  expect(await page.locator(".sequencer-beat-number").count()).toBeGreaterThan(0);
  await expect(page.locator(".seq-play-btn")).toBeEnabled();

  await page.locator(".seq-play-btn").evaluate((button: HTMLButtonElement) => {
    button.click();
  });

  await page.waitForFunction(({ startingPosition, startingScrollLeft }: { startingPosition: string; startingScrollLeft: number }) => {
    const scroll = document.querySelector<HTMLElement>(".sequencer-scroll");
    const position = document.querySelector<HTMLElement>(".seq-position")?.textContent ?? "";
    const stopButton = document.querySelector<HTMLButtonElement>(".seq-stop-btn");
    const positionChanged = position !== (startingPosition ?? "");
    return scroll !== null && (
      scroll.scrollLeft > startingScrollLeft
      || positionChanged
      || (stopButton?.disabled === false)
    );
  }, { startingPosition: initialPosition ?? "", startingScrollLeft: initialTimeline.scrollLeft }, { timeout: playbackStartTimeoutMs });

  const playingTimeline = await page.locator(".sequencer-scroll").evaluate((el: HTMLElement) => ({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));

  expect(playingTimeline.scrollWidth).toBeGreaterThanOrEqual(playingTimeline.clientWidth);

  const positionText = (await page.locator(".seq-position").textContent()) ?? "";
  expect(positionText).toMatch(/Bar\s+\d+\s+\/\s+\d+|\d+\s+events\s+·\s+\d+\s+ready/);

  const stopButton = page.locator(".seq-stop-btn");
  const clickedStop = await stopButton.evaluate((button: HTMLButtonElement) => {
    if (button.disabled) return false;
    button.click();
    return true;
  });
  if (clickedStop) {
    await expect(stopButton).toBeDisabled();
  } else {
    await expect(stopButton).toBeDisabled();
  }

  if (initialTimeline.scrollWidth > initialTimeline.clientWidth) {
    await page.waitForFunction(() => {
      const scroll = document.querySelector<HTMLElement>(".sequencer-scroll");
      return scroll !== null && scroll.scrollLeft === 0;
    });
  }
}

async function assertMixAutoScroll(page: Page): Promise<void> {
  const playbackStartTimeoutMs = coveragePlaybackStartTimeoutMs;
  const initialTimeline = await page.locator(".sequencer-scroll").evaluate((el: HTMLElement) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
  }));

  expect(initialTimeline.scrollWidth).toBeGreaterThan(initialTimeline.clientWidth);
  await expect(page.locator(".seq-play-btn")).toBeEnabled();

  await page.locator(".seq-play-btn").evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await expect(page.locator(".seq-stop-btn")).toBeEnabled({ timeout: playbackStartTimeoutMs });

  await page.waitForFunction(() => {
    const scroll = document.querySelector<HTMLElement>(".sequencer-scroll");
    const position = document.querySelector<HTMLElement>(".seq-position")?.textContent ?? "";
    return scroll !== null && scroll.scrollLeft > 0 && /^Bar\s+\d+/.test(position);
  }, undefined, { timeout: playbackStartTimeoutMs });

  const playingTimeline = await page.locator(".sequencer-scroll").evaluate((el: HTMLElement) => ({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));

  expect(playingTimeline.scrollLeft).toBeGreaterThan(initialTimeline.scrollLeft);
  expect(playingTimeline.scrollWidth).toBeGreaterThan(playingTimeline.clientWidth);

  await page.locator(".seq-stop-btn").click();
  await expect(page.locator(".seq-stop-btn")).toBeDisabled();

  await page.waitForFunction(() => {
    const scroll = document.querySelector<HTMLElement>(".sequencer-scroll");
    return scroll !== null && scroll.scrollLeft === 0;
  });
}

test.describe("MIX playback (prerequisite 13)", () => {
  test.setTimeout(mixPlaybackSuiteTimeoutMs);

  test("serves a MIX file through the /mix/ dev-server middleware", async ({ page }) => {
    const response = await page.request.get("/mix/Dance_eJay1/START.MIX").catch(() => null);
    if (!response) test.skip(true, "Dance_eJay1/START.MIX not present in archive/");
    expect(response!.status()).toBe(200);
    expect(response!.headers()["content-type"]).toContain("application/octet-stream");
    const body = await response!.body();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("rejects path-traversal attempts", async ({ page }) => {
    const response = await page.request.get("/mix/Dance_eJay1/..%2Fsecrets.mix");
    expect(response.status()).toBe(404);
  });

  test("returns 404 for unknown products", async ({ page }) => {
    const response = await page.request.get("/mix/NotAProduct/anything.mix");
    expect(response.status()).toBe(404);
  });

  test("auto-scrolls the playhead for a long representative mix", async ({ page }) => {
    if (!LONG_MIX_PLAYBACK_CASE) {
      test.skip(true, "No playable appId-backed mixes found in data/index.json");
    }

    await openMixFromArchive(page, LONG_MIX_PLAYBACK_CASE!);
    await assertMixAutoScroll(page);
  });

  for (const mixCase of APP_ID_PLAYBACK_CASES) {
    const appIdHex = `0x${mixCase.appId.toString(16).padStart(8, "0")}`;
    test(`plays one representative mix for appId ${appIdHex} (${mixCase.group} / ${mixCase.filename})`, async ({ page }) => {
      await openMixFromArchive(page, mixCase);
      await assertMixPlaybackTransport(page);
    });
  }
});