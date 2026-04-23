import { readFileSync } from "node:fs";

import { test, expect } from "./baseFixtures.js";
import { buildDisplayVersion } from "../scripts/version.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version?: string;
};

const expectedTransportVersion = buildDisplayVersion(packageJson.version, {
  cwd: new URL("..", import.meta.url),
  deploymentCount: process.env.EJAY_GITHUB_DEPLOYMENT_COUNT,
});

test("page title is set", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/eJay/i);
});

test("SPA shell renders sidebar, tabs, and sample grid", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#category-sidebar")).toBeVisible();
  await expect(page.locator("#subcategory-tabs")).toBeVisible();
  await expect(page.locator("#sample-grid")).toBeVisible();
});

test("category sidebar renders the normalized category matrix", async ({ page }) => {
  await page.goto("/");
  const buttons = page.locator(".category-btn");
  await expect(buttons.first()).toBeVisible();
  expect(await buttons.count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.category-system-btn[data-category-id="Unsorted"]')).toBeVisible();
  await expect(page.locator(".load-json-btn.category-system-btn")).toBeVisible();
});

test("first category is active by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".category-btn.is-active").first()).toBeVisible();
});

test("tab bar shows at least one tab and the add button", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => page.locator("#subcategory-tabs .subcategory-tab").count()).toBeGreaterThan(0);
  await expect(page.locator('#subcategory-tabs .subcategory-tab[data-tab-id^="product:"]')).toHaveCount(0);
  await expect(page.locator('#subcategory-tabs .subcategory-tab[data-tab-id^="all:"]')).toHaveCount(0);
  await expect(page.locator("#subcategory-add")).toBeVisible();
  await expect(page.locator("#subcategory-add")).toBeEnabled();
});

test("adding a subcategory updates the ribbon immediately", async ({ page }) => {
  let categoryConfig = {
    categories: [
      { id: "Loop", name: "Loop", subcategories: ["unsorted"] },
      {
        id: "Drum",
        name: "Drum",
        subcategories: ["kick", "snare", "clap", "toms", "crash", "hi-hats", "perc", "misc"],
      },
      { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
      { id: "Guitar", name: "Guitar", subcategories: ["unsorted"] },
      { id: "Keys", name: "Keys", subcategories: ["unsorted"] },
      { id: "Sequence", name: "Sequence", subcategories: ["unsorted"] },
      {
        id: "Voice",
        name: "Voice",
        subcategories: ["rap male", "rap female", "sing male", "sing female", "robot", "misc"],
      },
      { id: "Effect", name: "Effect", subcategories: ["unsorted"] },
      { id: "Scratch", name: "Scratch", subcategories: ["unsorted"] },
      { id: "Orchestral", name: "Orchestral", subcategories: ["unsorted"] },
      { id: "Pads", name: "Pads", subcategories: ["unsorted"] },
      { id: "Extra", name: "Extra", subcategories: ["unsorted"] },
      { id: "Unsorted", name: "Unsorted", subcategories: ["unsorted"] },
    ],
  };

  await page.route("**/output/categories.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(categoryConfig),
    });
  });

  await page.route("**/__category-config", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }

    categoryConfig = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await page.locator('.category-btn[data-category-id="Drum"]').click();
  await page.locator("#subcategory-add").click();
  await page.locator("#subcategory-add-input").fill("fills");
  await page.locator("#subcategory-add-confirm").click();

  await expect(page.locator('#subcategory-tabs .subcategory-tab[data-tab-id="subcategory:fills"]')).toBeVisible();
});

test("default view renders sample blocks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sample-block").first()).toBeVisible();
});

test("BPM filter is present and defaults to 140", async ({ page }) => {
  await page.goto("/");
  const bpm = page.locator("#bpm-filter");
  await expect(bpm).toBeVisible();
  await expect(bpm).toHaveValue("140");
});

test("transport bar is present and idle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#transport")).toBeVisible();
  await expect(page.locator("#transport-name")).toHaveText("No sample playing");
});

test("transport bar shows the configured app version", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".transport-version")).toHaveText(expectedTransportVersion);
});

test("search filters the sample grid and clear restores the category view", async ({ page }) => {
  await page.route("**/data/index.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [{ id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 2 }],
        mixLibrary: [],
      }),
    });
  });

  await page.route("**/output/categories.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [{ id: "Bass", name: "Bass", subcategories: ["unsorted"] }],
      }),
    });
  });

  await page.route("**/output/metadata.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        samples: [
          {
            filename: "bass-loop.wav",
            alias: "Bass Loop",
            category: "Bass",
            product: "Rave",
            bpm: 140,
            beats: 4,
            detail: "Drum&Bass",
          },
          {
            filename: "bass-hit.wav",
            alias: "Bass Hit",
            category: "Bass",
            product: "Rave",
            bpm: 140,
            beats: 0,
            detail: "One Shot",
          },
        ],
      }),
    });
  });

  await page.goto("/");

  const searchInput = page.locator("#sample-search");
  const searchClear = page.locator("#sample-search-clear");
  const labels = page.locator(".sample-block-label");

  await expect(labels.filter({ hasText: "Bass Loop" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "Bass Hit" })).toHaveCount(1);
  await expect(searchClear).toHaveClass(/is-hidden/);

  await searchInput.fill("drum&bass rave");
  await expect(searchClear).not.toHaveClass(/is-hidden/);
  await expect(labels.filter({ hasText: "Bass Loop" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "Bass Hit" })).toHaveCount(0);

  await searchInput.fill("hit");
  await expect(labels.filter({ hasText: "Bass Loop" })).toHaveCount(0);
  await expect(labels.filter({ hasText: "Bass Hit" })).toHaveCount(1);

  await searchClear.click();
  await expect(searchInput).toHaveValue("");
  await expect(searchClear).toHaveClass(/is-hidden/);
  await expect(labels.filter({ hasText: "Bass Loop" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "Bass Hit" })).toHaveCount(1);
});

test("search query persists when switching categories", async ({ page }) => {
  await page.route("**/data/index.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          { id: "Voice", name: "Voice", subcategories: ["unsorted"], sampleCount: 1 },
        ],
        mixLibrary: [],
      }),
    });
  });

  await page.route("**/output/categories.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
          { id: "Voice", name: "Voice", subcategories: ["unsorted"] },
        ],
      }),
    });
  });

  await page.route("**/output/metadata.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        samples: [
          {
            filename: "deep-tone.wav",
            alias: "Deep Tone",
            category: "Bass",
            product: "Rave",
            bpm: 140,
            beats: 4,
          },
          {
            filename: "robot-vox.wav",
            alias: "Robot Vox",
            category: "Voice",
            product: "Rave",
            bpm: 140,
            beats: 4,
            detail: "Robot",
          },
        ],
      }),
    });
  });

  await page.goto("/");

  const searchInput = page.locator("#sample-search");
  await searchInput.fill("robot");

  await expect(searchInput).toHaveValue("robot");
  await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");

  await page.locator('.category-btn[data-category-id="Voice"]').click();

  await expect(searchInput).toHaveValue("robot");
  await expect(page.locator('.sample-block-label').filter({ hasText: "Robot Vox" })).toHaveCount(1);
  await expect(page.locator('.sample-block-label').filter({ hasText: "Deep Tone" })).toHaveCount(0);

  await page.locator('.category-btn[data-category-id="Bass"]').click();

  await expect(searchInput).toHaveValue("robot");
  await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");
});