import { test, expect } from "./baseFixtures.js";
import { browserAppStartupTimeoutMs } from "./playwright-test-helpers.js";

test.describe("main edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("the real app sample zoom controls adjust sample bubble sizing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });
    await expect(page.locator(".sample-block").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });

    const readFontSize = async (): Promise<number> => page.locator(".sample-block").first().evaluate((element) => {
      return Number.parseFloat(window.getComputedStyle(element).fontSize);
    });

    const baseSize = await readFontSize();
    await page.locator("#sample-zoom-in").click();
    const zoomedInSize = await readFontSize();
    await page.locator("#sample-zoom-out").click();
    const resetSize = await readFontSize();

    expect(zoomedInSize).toBeGreaterThan(baseSize * 1.09);
    expect(zoomedInSize).toBeLessThan(baseSize * 1.11);
    expect(resetSize).toBeGreaterThanOrEqual(baseSize * 0.99);
    expect(resetSize).toBeLessThanOrEqual(baseSize * 1.01);
  });

  test("the real app zoom-in is clamped at the maximum zoom level", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });
    await expect(page.locator(".sample-block").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });

    const readZoomScale = (): Promise<number> =>
      page.evaluate(() =>
        Number.parseFloat(
          document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "1",
        ),
      );

    // Click zoom-in many more times than the allowed range to hit the ceiling
    for (let i = 0; i < 20; i++) {
      await page.locator("#sample-zoom-in").click();
    }

    const clampedScale = await readZoomScale();
    expect(clampedScale).toBeLessThanOrEqual(2);
  });

  test("the real app zoom-out is clamped at the minimum zoom level", async ({ page }) => {
    const zoomStartupTimeoutMs = process.env.VITE_COVERAGE === "true" ? 30_000 : browserAppStartupTimeoutMs;

    await page.goto("/");
    await expect.poll(async () => page.locator(".category-btn").count(), {
      timeout: zoomStartupTimeoutMs,
    }).toBeGreaterThan(0);
    await expect.poll(async () => page.locator(".sample-block").count(), {
      timeout: zoomStartupTimeoutMs,
    }).toBeGreaterThan(0);
    await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: zoomStartupTimeoutMs });
    await expect(page.locator(".sample-block").first()).toBeVisible({ timeout: zoomStartupTimeoutMs });

    const readZoomScale = (): Promise<number> =>
      page.evaluate(() =>
        Number.parseFloat(
          document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "1",
        ),
      );

    // Click zoom-out many more times than the allowed range to hit the floor
    for (let i = 0; i < 20; i++) {
      await page.locator("#sample-zoom-out").click();
    }

    const clampedScale = await readZoomScale();
    expect(clampedScale).toBeGreaterThanOrEqual(0.5);
  });

  test("the real app shows only the add button when a category has no configured subcategories and the sample catalog fails", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 1 }],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Bass", name: "Bass", subcategories: [] }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "catalog unavailable" }),
      });
    });

    await page.goto("/");
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
    await expect(page.locator("#subcategory-add")).toBeVisible();
    await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");
  });

  test("the real app renders the no-categories empty state when the index is empty", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: [], mixLibrary: [] }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: [] }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ samples: [] }),
      });
    });

    await page.goto("/");
    await expect(page.locator(".sample-grid-empty")).toHaveText("No categories found in this library.", {
      timeout: browserAppStartupTimeoutMs,
    });
  });

  test("main bootstraps the normalized browser flow, filters tabs, and updates transport", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 2;
        paused = true;
        ended = false;
        private readonly listeners = new Map<string, Set<() => void>>();

        addEventListener(type: string, listener: () => void): void {
          const listeners = this.listeners.get(type) ?? new Set<() => void>();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(type: string, listener: () => void): void {
          this.listeners.get(type)?.delete(listener);
        }

        play(): Promise<void> {
          this.paused = false;
          return Promise.resolve();
        }

        pause(): void {
          this.paused = true;
          for (const listener of this.listeners.get("pause") ?? []) {
            listener();
          }
        }
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Bass", name: "Bass", subcategories: [], sampleCount: 2 },
            { id: "Drum", name: "Drum", subcategories: ["kick", "misc"], sampleCount: 3 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
            { id: "Drum", name: "Drum", subcategories: ["kick", "misc"] },
          ],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass-140.wav", alias: "Bass 140", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 8 },
          { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", product: "Rave", bpm: 140, beats: 4 },
          { filename: "loose-fx.wav", alias: "Loose FX", category: "Unsorted", product: "Rave", bpm: 140, beats: 4 },
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", product: "Dance_eJay1", bpm: 140, beats: 4 },
          { filename: "drum-misc.wav", alias: "Drum Misc", category: "Drum", subcategory: "misc", product: "Rave", bpm: 140, beats: 4 },
          { filename: "drum-untagged.wav", alias: "Drum Untagged", category: "Drum", product: "Rave", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=browser-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
    }, LIBRARY_MOD);

    await expect(page.locator(".category-btn")).toHaveCount(2);
    await expect(page.locator(".category-system-btn")).toHaveCount(2);
    await expect(page.locator('.category-system-btn[data-category-id="Unsorted"]')).toBeVisible();
    await expect(page.locator(".subcategory-tab")).toHaveCount(2);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toContainText("unsorted");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toContainText("riff");
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass 140");
    await expect(page.locator(".sample-grid")).not.toContainText("Bass Riff");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");

    await page.locator('.category-system-btn[data-category-id="Unsorted"]').click();
    await expect(page.locator('.category-system-btn[data-category-id="Unsorted"]')).toHaveClass(/is-active/);
    await expect(page.locator(".subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toContainText("unsorted");
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Loose FX");

    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await expect(page.locator('.subcategory-tab[data-tab-id^="product:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id^="all:"]')).toHaveCount(0);
    await expect(page.locator(".subcategory-tab")).toHaveCount(2);
    await page.locator("#bpm-filter").selectOption("140");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toContainText("kick");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toContainText("misc");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(2);
    await expect(page.locator(".sample-grid")).toContainText("Drum Misc");
    await expect(page.locator(".sample-grid")).toContainText("Drum Untagged");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();

    await page.locator(".sample-block").first().click();
    await expect(page.locator("#transport-name")).toHaveText("kick");
    await page.locator("#transport-stop").click();
    await expect(page.locator("#transport-name")).toHaveText("No sample playing");
  });

  test("main shows the hardcoded unsorted tab alongside discovered sample subcategories when config is empty", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 2 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [{ id: "Bass", name: "Bass", subcategories: [] }],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass-plain.wav", alias: "Bass Plain", category: "Bass", bpm: 140, beats: 8 },
          { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return false;
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=no-sub-tabs-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
    }, LIBRARY_MOD);

    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(2);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toBeVisible();
    await expect(page.locator("#subcategory-add")).toBeVisible();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Plain");
    await expect(page.locator(".sample-grid")).not.toContainText("Bass Riff");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");
  });

  test("main renders the empty-library message when no categories are available", async ({ page }) => {
    await page.goto("/");

    const warnings = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      const captured: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return { categories: [], mixLibrary: [] };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [] };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        throw new Error("catalog unavailable");
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://noop.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=empty-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
      console.warn = originalWarn;
      return captured;
    }, LIBRARY_MOD);

    await expect(page.locator(".sample-grid-empty")).toHaveText("No categories found in this library.");
    expect(warnings.some((message) => message.includes("Failed to load sample catalog"))).toBe(true);
  });

  test("main warns on category refresh failures and shows a toast when saving categories fails", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      const warnings: string[] = [];
      const originalWarn = console.warn;
      let loadCategoryConfigCalls = 0;

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", product: "Dance_eJay1", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        loadCategoryConfigCalls += 1;
        if (loadCategoryConfigCalls === 1) {
          return {
            categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
          };
        }
        throw new Error("refresh failed");
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {
        throw new Error("write failed");
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://kick.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';

      try {
        await import(`/src/main.ts?scenario=refresh-failure-${Date.now()}`);
        await Promise.resolve();
        await Promise.resolve();
        window.dispatchEvent(new CustomEvent("category-config-updated"));
        await Promise.resolve();
        await Promise.resolve();
        (document.querySelector("#subcategory-add") as HTMLButtonElement).click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).value = "fills";
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).dispatchEvent(
          new Event("input", { bubbles: true }),
        );
        (document.querySelector("#subcategory-add-confirm") as HTMLButtonElement).click();
        await Promise.resolve();
        await Promise.resolve();

        return {
          warnings,
          toastText: document.getElementById("error-toast")?.textContent ?? null,
        };
      } finally {
        console.warn = originalWarn;
      }
    }, LIBRARY_MOD);

    expect(result.warnings.some((message) => message.includes("Failed to refresh category config."))).toBe(true);
    expect(result.toastText).toBe("Could not save categories.json.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sample-grid-context-menu module tests
// ─────────────────────────────────────────────────────────────────────────────



