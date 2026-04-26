import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "./baseFixtures.js";
import { buildDisplayVersion } from "../scripts/version.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version?: string;
};

const expectedTransportVersion = buildDisplayVersion(packageJson.version, {
  cwd: new URL("..", import.meta.url),
  deploymentCount: process.env.EJAY_GITHUB_DEPLOYMENT_COUNT,
});
const appStartupTimeoutMs = process.env.VITE_COVERAGE === "true" ? 15_000 : 5_000;

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
  await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: appStartupTimeoutMs });
  await expect(page.locator(".category-btn.is-active").first()).toBeVisible({ timeout: appStartupTimeoutMs });
});

test("tab bar shows at least one tab and the add button", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: appStartupTimeoutMs });
  await expect.poll(async () => page.locator("#subcategory-tabs .subcategory-tab").count(), {
    timeout: appStartupTimeoutMs,
  }).toBeGreaterThan(0);
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

test("BPM filter is present and defaults to All", async ({ page }) => {
  await page.goto("/");
  const bpm = page.locator("#bpm-filter");
  await expect(bpm).toBeVisible();
  await expect(page.locator('#bpm-filter option[value=""]')).toHaveText("All");
  await expect(bpm).toHaveValue("");
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

test("duplicate sample names surface provenance in the grid", async ({ page }) => {
  await page.route("**/data/index.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 2 }],
        mixLibrary: [],
      }),
    });
  });

  await page.route("**/output/categories.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
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
            filename: "kick-1.wav",
            alias: "Kick 3",
            category: "Drum",
            subcategory: "kick",
            product: "Dance_eJay2",
            bpm: 140,
            beats: 4,
            detail: "euro",
            internal_name: "D5MA060",
            sample_id: 1512,
          },
          {
            filename: "kick-2.wav",
            alias: "Kick 3",
            category: "Drum",
            subcategory: "kick",
            product: "Dance_eJay2",
            bpm: 140,
            beats: 4,
            detail: "trance",
            internal_name: "D5MA061",
            sample_id: 1513,
          },
        ],
      }),
    });
  });

  await page.goto("/");

  const blocks = page.locator(".sample-block");
  const labels = page.locator(".sample-block-label");
  const metas = page.locator(".sample-block-meta");

  await expect(labels.filter({ hasText: "Kick 3 - euro" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "Kick 3 - trance" })).toHaveCount(1);
  await expect(metas.nth(0)).toContainText("Dance eJay2");
  await expect(metas.nth(0)).toContainText("D5MA060");
  await expect(metas.nth(0)).toContainText("#1512");
  await expect(metas.nth(0)).not.toContainText("euro");
  await expect(metas.nth(1)).toContainText("D5MA061");
  await expect(metas.nth(1)).toContainText("#1513");
  await expect(metas.nth(1)).not.toContainText("trance");
  await expect(blocks.nth(0)).toHaveAttribute("title", /^Kick 3 - euro/);
  await expect(blocks.nth(1)).toHaveAttribute("title", /^Kick 3 - trance/);
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

// ---------------------------------------------------------------------------
// DEV-only persistence tests
// These tests rely on user-created data in output/ (gitignored). They are
// skipped automatically when the output directory or the required subcategory
// is not present (e.g. in CI or fresh checkouts).
// ---------------------------------------------------------------------------

const outputCategoriesPath = join(process.cwd(), "output", "categories.json");

function devCategoryHasSubcategory(categoryId: string, subcategoryId: string): boolean {
  if (!existsSync(outputCategoriesPath)) return false;
  try {
    const raw: unknown = JSON.parse(readFileSync(outputCategoriesPath, "utf-8"));
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { categories?: unknown }).categories)) {
      return false;
    }
    const categories = (raw as { categories: Array<{ id?: unknown; subcategories?: unknown }> }).categories;
    const entry = categories.find((c) => c.id === categoryId);
    return Array.isArray(entry?.subcategories) && (entry.subcategories as unknown[]).includes(subcategoryId);
  } catch {
    return false;
  }
}

test("DEV — Loop/fills subcategory is persistent and contains samples", async ({ page }) => {
  test.skip(!devCategoryHasSubcategory("Loop", "fills"), "output/categories.json does not have Loop/fills — skipping DEV-only persistence test");

  await page.goto("/");
  await page.locator('.category-btn[data-category-id="Loop"]').click();
  await expect(page.locator('#subcategory-tabs .subcategory-tab[data-tab-id="subcategory:fills"]')).toBeVisible();

  await page.locator('#subcategory-tabs .subcategory-tab[data-tab-id="subcategory:fills"]').click();
  await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toHaveClass(/is-active/);

  await expect.poll(() => page.locator(".sample-block").count(), { timeout: 10_000 }).toBeGreaterThan(1);
});

// Regression test: filenames containing ".." (e.g. "VXB010..wav") must not
// be rejected by the path-traversal guard in /__sample-move. The file won't
// exist on disk, so no actual data is modified; the endpoint should still
// return 204 rather than 400.
test("DEV — /__sample-move accepts filenames that contain double-dot", async ({ page }) => {
  await page.goto("/");
  const response = await page.evaluate(async () => {
    const res = await fetch("/__sample-move", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "fake..test.wav",
        oldCategory: "Voice",
        oldSubcategory: "misc",
        newCategory: "Voice",
        newSubcategory: "misc",
      }),
    });
    return { status: res.status };
  });
  expect(response.status).toBe(204);
});