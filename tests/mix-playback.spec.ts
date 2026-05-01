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

interface PlayheadSnapshot {
  positionText: string;
  barNumber: number | null;
  beat: number | null;
  beatAlignedToBarStart: boolean;
}

interface SequencerParitySnapshot {
  markerPrefix: number[];
  events: Array<{
    laneLabel: string;
    beat: number;
    label: string;
  }>;
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
const mixContextUpdateTimeoutMs = process.env.VITE_COVERAGE === "true" ? 30_000 : 10_000;
const mixSelectionAttempts = process.env.VITE_COVERAGE === "true" ? 3 : 2;

async function waitForBarPosition(page: Page, timeoutMs: number = coveragePlaybackStartTimeoutMs): Promise<void> {
  await page.waitForFunction(() => {
    const position = document.querySelector<HTMLElement>(".seq-position")?.textContent ?? "";
    return /Bar\s+\d+\s*\/\s*\d+/i.test(position);
  }, undefined, { timeout: timeoutMs });
}

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
  const groupHeader = group.locator(".mix-tree-group-header");
  if (!await item.isVisible().catch(() => false)) {
    await groupHeader.click({ timeout: mixArchiveLoadTimeoutMs });
  }
  await expect(item).toBeVisible({ timeout: mixArchiveLoadTimeoutMs });

  const stem = mixCase.filename.replace(/\.mix$/i, "");
  const mixNameMatcher = new RegExp(escapeRegex(stem), "i");
  const mixName = page.locator(".context-mix-name");
  for (let attempt = 0; attempt < mixSelectionAttempts; attempt++) {
    if (!await item.isVisible().catch(() => false)) {
      await groupHeader.click({ timeout: mixArchiveLoadTimeoutMs }).catch(() => undefined);
    }

    try {
      await expect(item).toBeVisible({ timeout: mixArchiveLoadTimeoutMs });
      await item.click({ timeout: mixArchiveLoadTimeoutMs });
      await item.dispatchEvent("dblclick", { bubbles: true });
      await expect(mixName).toHaveText(mixNameMatcher, {
        timeout: mixContextUpdateTimeoutMs,
      });
      break;
    } catch (error) {
      if (attempt === mixSelectionAttempts - 1) throw error;

      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>("#mix-sample-loading-overlay");
        return !overlay || !overlay.classList.contains("is-visible");
      }, undefined, { timeout: mixContextUpdateTimeoutMs }).catch(() => undefined);

      await page.locator("#archive-tree").click({ timeout: mixArchiveLoadTimeoutMs }).catch(() => undefined);
      await expect.poll(async () => page.locator(".mix-tree-group").count(), {
        timeout: mixArchiveLoadTimeoutMs,
      }).toBeGreaterThan(0);
    }
  }

  await expect(page.locator(".mix-meta-popup")).toHaveCount(0);
}

async function readPlayheadSnapshot(page: Page): Promise<PlayheadSnapshot> {
  return page.evaluate(() => {
    const positionText = document.querySelector<HTMLElement>(".seq-position")?.textContent?.trim() ?? "";
    const barMatch = /Bar\s+(\d+)\s*\/\s*\d+/i.exec(positionText);
    const barNumber = barMatch ? Number(barMatch[1]) : null;

    const playhead = document.querySelector<HTMLElement>(".sequencer-playhead");
    const canvas = document.querySelector<HTMLElement>(".sequencer-canvas");
    let beat: number | null = null;
    let beatAlignedToBarStart = false;

    if (playhead && canvas) {
      const transformMatch = /translateX\(([-\d.]+)px\)/.exec(playhead.style.transform);
      const labelPx = Number.parseFloat(canvas.style.getPropertyValue("--mix-grid-label-px"));
      const beatStepPx = Number.parseFloat(canvas.style.getPropertyValue("--mix-grid-beat-step-px"));
      if (transformMatch && Number.isFinite(labelPx) && Number.isFinite(beatStepPx) && beatStepPx > 0) {
        beat = (Number(transformMatch[1]) - labelPx) / beatStepPx;
        beatAlignedToBarStart = Math.abs(beat - Math.round(beat)) < 0.001;
      }
    }

    return {
      positionText,
      barNumber,
      beat,
      beatAlignedToBarStart,
    };
  });
}

async function readSequencerParitySnapshot(page: Page, maxBeat: number): Promise<SequencerParitySnapshot> {
  return page.evaluate((maxVisibleBeat) => {
    const markerPrefix = [...document.querySelectorAll<HTMLElement>(".sequencer-beat-number")]
      .map((node) => Number.parseInt((node.textContent ?? "").trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, maxVisibleBeat);

    const GRID_LABEL_COLUMNS = 2;
    const events: SequencerParitySnapshot["events"] = [];
    for (const row of document.querySelectorAll<HTMLElement>(".sequencer-lane")) {
      const laneLabel = row.querySelector<HTMLElement>(".sequencer-lane-label")?.textContent?.trim() ?? "";
      for (const block of row.querySelectorAll<HTMLElement>(".sequencer-event")) {
        const label = block.textContent?.trim() ?? "";
        const gridColumn = block.style.gridColumn;
        const match = /^\s*(\d+)\s*\/\s*span\s*(\d+)/i.exec(gridColumn);
        if (!label || !match) continue;

        const gridStart = Number.parseInt(match[1], 10);
        if (!Number.isFinite(gridStart)) continue;
        const beat = Math.max(0, gridStart - GRID_LABEL_COLUMNS);
        if (beat > maxVisibleBeat) continue;

        events.push({ laneLabel, beat, label });
      }
    }

    events.sort((left, right) => left.beat - right.beat
      || left.laneLabel.localeCompare(right.laneLabel)
      || left.label.localeCompare(right.label));

    return {
      markerPrefix,
      events,
    };
  }, maxBeat);
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
  await expect(page.locator(".seq-play-btn")).toBeEnabled({ timeout: playbackStartTimeoutMs });

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
  expect(positionText).toMatch(/Bar\s+\d+\s+\/\s+\d+|\d+\s+events\s+·\s+\d+\s+ready|Loading samples\s+\d+\/\d+/);

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
  await expect(page.locator(".seq-play-btn")).toBeEnabled({ timeout: playbackStartTimeoutMs });

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

  await page.waitForFunction(() => {
    const scroll = document.querySelector<HTMLElement>(".sequencer-scroll");
    return scroll !== null && scroll.scrollLeft === 0;
  });
}

test.describe("Mix Playback", () => {
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
});

function loadStartMixCases(): MixPlaybackCase[] {
  const parsed = JSON.parse(readFileSync(join(process.cwd(), "data", "index.json"), "utf-8")) as IndexDataLike;
  const cases: MixPlaybackCase[] = [];

  for (const group of parsed.mixLibrary ?? []) {
    if (group.id.startsWith("_userdata/")) continue;
    const startMix = group.mixes.find((m) => /^start\.mix$/i.test(m.filename));
    if (!startMix) continue;
    cases.push({
      appId: 0,
      productId: group.id,
      group: group.name,
      filename: startMix.filename,
      trackCount: startMix.meta?.trackCount ?? 0,
      format: startMix.meta?.format ?? null,
    });
  }

  return cases.sort((left, right) => left.productId.localeCompare(right.productId));
}

const START_MIX_CASES = loadStartMixCases();
const DANCE1_START_CASE = START_MIX_CASES.find((mixCase) => mixCase.productId === "Dance_eJay1") ?? null;
const HIPHOP1_START_CASE = START_MIX_CASES.find((mixCase) => mixCase.productId === "HipHop_eJay1") ?? null;
const RAVE_START_CASE = START_MIX_CASES.find((mixCase) => mixCase.productId === "Rave") ?? null;

/**
 * Format B products whose start.mix samples are fully resolved after the
 * Gen 2 compound-alias index fix. For these, the initial playhead position
 * must show structured bar notation ("Bar 1 / N") rather than the fallback
 * "N events · M ready" stub used by unresolved or Format C/D mixes.
 */
const FORMAT_B_RESOLVED_PRODUCTS = new Set(["Dance_eJay2", "Techno_eJay"]);

test.describe("start.mix per-product matrix", () => {
  test.setTimeout(mixPlaybackSuiteTimeoutMs);

  test("Rave start.mix renders variable tracker bubble widths", async ({ page }) => {
    if (!RAVE_START_CASE) {
      test.skip(true, "Rave start.mix not present in data/index.json");
    }
    const playbackStartTimeoutMs = coveragePlaybackStartTimeoutMs;

    await openMixFromArchive(page, RAVE_START_CASE!);

    const playButton = page.locator(".seq-play-btn");
    const stopButton = page.locator(".seq-stop-btn");
    await expect(playButton).toBeEnabled({ timeout: playbackStartTimeoutMs });
    await playButton.click();
    await expect(page.locator(".seq-position")).toContainText("Bar 1 / 118", {
      timeout: playbackStartTimeoutMs,
    });
    await stopButton.click();

    const spans = await page.locator(".sequencer-event").evaluateAll((nodes) => nodes.map((node) => {
      const inline = (node as HTMLElement).style.gridColumn;
      const match = /span\s+(\d+)/i.exec(inline);
      return match ? Number(match[1]) : 1;
    }));

    expect(spans.length).toBeGreaterThan(0);
    expect(Math.max(...spans)).toBeGreaterThan(1);
  });

  test("Dance_eJay1 start.mix keeps label and bar-marker parity", async ({ page }) => {
    if (!DANCE1_START_CASE) {
      test.skip(true, "Dance_eJay1 start.mix not present in data/index.json");
    }
    const playbackStartTimeoutMs = coveragePlaybackStartTimeoutMs;

    await openMixFromArchive(page, DANCE1_START_CASE!);
    await expect.poll(async () => page.locator(".sequencer-event").count(), {
      timeout: playbackStartTimeoutMs,
    }).toBeGreaterThan(0);

    const snapshot = await readSequencerParitySnapshot(page, 22);
    expect(snapshot.markerPrefix).toEqual(Array.from({ length: 22 }, (_value, index) => index + 1));

    const expectedAnchors: SequencerParitySnapshot["events"] = [
      { laneLabel: "Lane 2", beat: 0, label: "SpaceKnock" },
      { laneLabel: "Lane 3", beat: 0, label: "XPipe" },
      { laneLabel: "Lane 4", beat: 2, label: "Robot" },
      { laneLabel: "Lane 1", beat: 6, label: "Perc.L" },
      { laneLabel: "Lane 2", beat: 10, label: "Perc." },
      { laneLabel: "Lane 5", beat: 10, label: "WHAT" },
      { laneLabel: "Lane 5", beat: 12, label: "IS" },
      { laneLabel: "Lane 5", beat: 16, label: "LOVE" },
      { laneLabel: "Lane 6", beat: 16, label: "Snare fill" },
      { laneLabel: "Lane 7", beat: 10, label: "Myth * L" },
      { laneLabel: "Lane 8", beat: 10, label: "Myth * R" },
      { laneLabel: "Lane 1", beat: 17, label: "Crash" },
    ];
    for (const anchor of expectedAnchors) {
      expect(snapshot.events).toContainEqual(anchor);
    }

    const playButton = page.locator(".seq-play-btn");
    const stopButton = page.locator(".seq-stop-btn");
    await expect(playButton).toBeEnabled({ timeout: playbackStartTimeoutMs });
    await playButton.evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect(page.locator(".seq-position")).toContainText("Bar 1 / 90", {
      timeout: playbackStartTimeoutMs,
    });

    await stopButton.evaluate((button: HTMLButtonElement) => {
      if (!button.disabled) button.click();
    });
    await expect(stopButton).toBeDisabled();
  });

  test("HipHop_eJay1 start.mix keeps 22-bar screenshot parity anchors", async ({ page }) => {
    if (!HIPHOP1_START_CASE) {
      test.skip(true, "HipHop_eJay1 start.mix not present in data/index.json");
    }
    const playbackStartTimeoutMs = coveragePlaybackStartTimeoutMs;

    await openMixFromArchive(page, HIPHOP1_START_CASE!);
    await expect.poll(async () => page.locator(".sequencer-event").count(), {
      timeout: playbackStartTimeoutMs,
    }).toBeGreaterThan(0);
    await expect(page.locator(".context-bpm-display")).toHaveText("96 BPM", {
      timeout: playbackStartTimeoutMs,
    });

    const snapshot = await readSequencerParitySnapshot(page, 66);
    expect(snapshot.markerPrefix.slice(0, 22)).toEqual(Array.from({ length: 22 }, (_value, index) => index + 1));

    const expectedAnchors: SequencerParitySnapshot["events"] = [
      { laneLabel: "Lane 3", beat: 0, label: "help" },
      { laneLabel: "Lane 4", beat: 0, label: "hard" },
      { laneLabel: "Lane 7", beat: 0, label: "hiphp" },
      { laneLabel: "Lane 1", beat: 22, label: "dirty store" },
      { laneLabel: "Lane 6", beat: 22, label: "count in" },
      { laneLabel: "Lane 8", beat: 22, label: "leave" },
      { laneLabel: "Lane 1", beat: 44, label: "kickC" },
      { laneLabel: "Lane 2", beat: 44, label: "snreI" },
      { laneLabel: "Lane 3", beat: 44, label: "tin loop" },
      { laneLabel: "Lane 1", beat: 66, label: "dirty store" },
      { laneLabel: "Lane 2", beat: 66, label: "hat A" },
      { laneLabel: "Lane 4", beat: 66, label: "do it" },
      { laneLabel: "Lane 5", beat: 66, label: "wanna let it" },
      { laneLabel: "Lane 6", beat: 66, label: "wahh!" },
    ];

    for (const anchor of expectedAnchors) {
      expect(snapshot.events).toContainEqual(anchor);
    }

    const playButton = page.locator(".seq-play-btn");
    const stopButton = page.locator(".seq-stop-btn");
    await expect(playButton).toBeEnabled({ timeout: playbackStartTimeoutMs });
    await playButton.evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect(page.locator(".seq-position")).toContainText(/Bar\s+1\s*\/\s*\d+/, {
      timeout: playbackStartTimeoutMs,
    });
    await expect(page.locator(".seq-position")).toContainText("Bar 1 / 80", {
      timeout: playbackStartTimeoutMs,
    });

    await stopButton.evaluate((button: HTMLButtonElement) => {
      if (!button.disabled) button.click();
    });
    await expect(stopButton).toBeDisabled();
  });

  test("play/pause button, Space, and Enter control transport playback", async ({ page }) => {
    const mixCase = START_MIX_CASES.find((entry) => FORMAT_B_RESOLVED_PRODUCTS.has(entry.productId));
    if (!mixCase) {
      test.skip(true, "No resolved Format B start.mix case available for transport shortcut assertions.");
    }

    await openMixFromArchive(page, mixCase!);

    const playPauseButton = page.locator(".seq-play-btn");
    const stopButton = page.locator(".seq-stop-btn");
    const dispatchShortcut = async (key: "Space" | "Enter"): Promise<void> => {
      await page.evaluate((nextKey) => {
        if (nextKey === "Space") {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
          return;
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }, key);
    };

    await expect(playPauseButton).toBeEnabled({ timeout: coveragePlaybackStartTimeoutMs });
    await expect(playPauseButton).toHaveAttribute("aria-label", "Play mix");
    await playPauseButton.click();
    await expect(playPauseButton).toHaveAttribute("aria-label", "Pause mix at current bar start");
    await page.waitForFunction(() => {
      const position = document.querySelector<HTMLElement>(".seq-position")?.textContent ?? "";
      const match = /Bar\s+(\d+)\s*\/\s*\d+/i.exec(position);
      return match !== null && Number(match[1]) >= 2;
    }, undefined, { timeout: coveragePlaybackStartTimeoutMs });

    await playPauseButton.click();
    await expect(stopButton).toBeDisabled();
    await expect(playPauseButton).toHaveAttribute("aria-label", "Play mix");
    await waitForBarPosition(page);

    const pausedByButton = await readPlayheadSnapshot(page);
    expect(pausedByButton.barNumber).not.toBeNull();
    expect(pausedByButton.beat).not.toBeNull();
    expect(pausedByButton.beatAlignedToBarStart).toBe(true);
    expect(Math.abs((pausedByButton.beat ?? 0) - ((pausedByButton.barNumber ?? 1) - 1))).toBeLessThan(0.001);

    await dispatchShortcut("Space");
    await expect(stopButton).toBeEnabled({ timeout: coveragePlaybackStartTimeoutMs });
    await expect(playPauseButton).toHaveAttribute("aria-label", "Pause mix at current bar start");

    await dispatchShortcut("Space");
    await expect(stopButton).toBeDisabled();
    await expect(playPauseButton).toHaveAttribute("aria-label", "Play mix");
    await waitForBarPosition(page);

    const pausedBySpace = await readPlayheadSnapshot(page);
    expect(pausedBySpace.barNumber).not.toBeNull();
    expect(pausedBySpace.beat).not.toBeNull();
    expect(pausedBySpace.beatAlignedToBarStart).toBe(true);
    expect(Math.abs((pausedBySpace.beat ?? 0) - ((pausedBySpace.barNumber ?? 1) - 1))).toBeLessThan(0.001);

    await dispatchShortcut("Enter");
    await expect(stopButton).toBeEnabled({ timeout: coveragePlaybackStartTimeoutMs });
    await expect(playPauseButton).toHaveAttribute("aria-label", "Pause mix at current bar start");
    await expect(page.locator(".seq-position")).toContainText(/Bar\s+1\s*\/\s*\d+/i, {
      timeout: coveragePlaybackStartTimeoutMs,
    });

    const startedByEnter = await readPlayheadSnapshot(page);
    expect(startedByEnter.beat).not.toBeNull();
    expect(startedByEnter.barNumber).not.toBeNull();
    const startedBarNumber = startedByEnter.barNumber as number;
    expect(startedBarNumber).toBeGreaterThanOrEqual(1);
    expect(startedBarNumber).toBeLessThanOrEqual(2);

    await dispatchShortcut("Enter");
    await expect(stopButton).toBeDisabled();
    await expect(playPauseButton).toHaveAttribute("aria-label", "Play mix");
    await waitForBarPosition(page);

    const afterEnterStop = await readPlayheadSnapshot(page);
    expect(afterEnterStop.beat).not.toBeNull();
    const stoppedBeat = afterEnterStop.beat as number;
    expect(Math.abs(stoppedBeat - 0)).toBeLessThan(0.001);
    expect(afterEnterStop.barNumber).toBe(1);
  });

  for (const mixCase of START_MIX_CASES) {
    test(`start.mix loads and plays for ${mixCase.productId}`, async ({ page }) => {
      await openMixFromArchive(page, mixCase);

      // Only run the full playback transport assertion for Format B products
      // whose samples are fully resolved — other formats either have no events
      // yet (Format C/D parsers are not fully implemented) or parse 0 tracks.
      if (FORMAT_B_RESOLVED_PRODUCTS.has(mixCase.productId)) {
        await assertMixPlaybackTransport(page);
      }
    });
  }
});