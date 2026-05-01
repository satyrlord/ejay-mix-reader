import { test, expect } from "./baseFixtures.js";
import { browserAppStartupTimeoutMs } from "./playwright-test-helpers.js";

test.describe("main edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("the real app exercises sample move, sort, and watcher refresh flows", async ({ page }) => {
    let metadataVersion = 0;
    let categoryVersion = 0;
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
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
            {
              id: "Drum",
              name: "Drum",
              subcategories: categoryVersion === 0 ? ["kick", "fills"] : ["kick", "fills", "snare"],
            },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: metadataVersion === 0
            ? [
                { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
                { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
                { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
              ]
            : [
                { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
                { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
                { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
              ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();
    await page.locator("#bpm-filter").selectOption("140");

    await page.locator("#sample-search").fill("Kick");
    await expect(page.locator("#sample-search-clear")).toBeVisible();
    await expect(page.locator(".sample-grid")).toContainText("Kick");
    await page.locator("#sample-search-clear").click();

    await page.locator(".sample-block").first().click({ button: "right" });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Move to");
    await page.mouse.click(8, 8);
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.locator(".sample-block").first().click({ button: "right" });
    const bassMoveItem = page.locator("#sample-context-menu .ctx-menu-item.has-submenu").filter({ hasText: "Bass" });
    await bassMoveItem.hover();
    await bassMoveItem.locator(".ctx-submenu .ctx-menu-item").first().click();
    await expect.poll(() => moveCalls).toBe(1);
    await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");

    metadataVersion = 1;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
    });
    await expect(page.locator(".sample-grid")).toContainText("Kick Reloaded");

    categoryVersion = 1;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").first().click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    const result = await page.evaluate(() => {
      const zoomScale = document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "";
      window.dispatchEvent(new Event("beforeunload"));
      return { zoomScale };
    });

    expect(result.zoomScale).toBe("1");
  });

  test("the real app shows a toast when moving a sample fails and supports sort-menu cleanup", async ({ page }) => {
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
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
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "move failed" }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();

    await page.locator(".sample-block").first().click({ button: "right" });
    const bassMoveItem = page.locator("#sample-context-menu .ctx-menu-item.has-submenu").filter({ hasText: "Bass" });
    await bassMoveItem.hover();
    await bassMoveItem.locator(".ctx-submenu .ctx-menu-item").first().click();

    await expect.poll(() => moveCalls).toBe(1);
    await expect(page.locator("#error-toast")).toHaveText("Could not move sample — check the console for details.");

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").first().click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu")).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);
  });

  test("the real app tolerates failing sample metadata refreshes while UI state resets", async ({ page }) => {
    let failRefresh = false;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
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
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      if (failRefresh) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "refresh failed" }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator("#subcategory-add").click();
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toBeVisible();

    await page.locator('.category-btn[data-category-id="Bass"]').click();
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);
    await expect(page.locator(".sample-grid")).toContainText("Bass");

    failRefresh = true;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
    });
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator(".sample-grid")).toContainText("Bass");
  });

  test("the real app handles context-menu edge targets and explicit sort changes", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
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
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4, detail: "tight" },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 8, detail: "busy" },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      const ghost = document.createElement("button");
      ghost.className = "sample-block";
      ghost.dataset.filename = "ghost.wav";
      grid.appendChild(ghost);
      ghost.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 28,
        clientY: 28,
      }));
      grid.removeChild(ghost);
    });
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator("#sample-search").fill("Kick");
    await expect(page.locator(".sample-grid")).toContainText("Kick");

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").filter({ hasText: "Name" }).click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);
  });

  test("the real app sorts multiple visible samples and moves one via contextmenu dispatch", async ({ page }) => {
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
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
            { id: "Drum", name: "Drum", subcategories: ["kick"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "zulu.wav", alias: "Zulu", category: "Drum", subcategory: "kick", bpm: 140, beats: 8 },
            { filename: "alpha.wav", alias: "Alpha", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(2);

    const result = await page.evaluate(async () => {
      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const labels = (): string[] => [...document.querySelectorAll<HTMLElement>(".sample-block-label")]
        .map((entry) => entry.textContent ?? "");

      const search = document.getElementById("sample-search") as HTMLInputElement | null;
      search!.value = "140";
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();

      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
      await flush();
      const sortButton = [...document.querySelectorAll<HTMLButtonElement>("#sample-context-menu button.ctx-menu-item")]
        .find((button) => button.textContent?.includes("Name"));
      sortButton?.click();
      await flush();
      const sortedLabels = labels();

      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!firstBlock) {
        throw new Error("Missing sorted sample block");
      }

      firstBlock.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: window.innerWidth - 12,
        clientY: 40,
      }));
      await flush();
      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      return {
        sortedLabels,
        gridTextAfterMove: document.getElementById("sample-grid")?.textContent ?? "",
      };
    });

    expect(result.sortedLabels.slice(0, 2)).toEqual(["Alpha", "Zulu"]);
    expect(moveCalls).toBe(1);
    expect(result.gridTextAfterMove).not.toContain("Alpha");
  });

  test("main opens sample move and sort menus and refreshes sample metadata on demand", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let metadataVersion = 0;
      let moveCalls = 0;
      let failedMoveCalls = 0;
      const moveTargets: Array<{ category: string; subcategory: string | null }> = [];

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

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const openContextMenu = (target: Element, clientX: number, clientY: number): void => {
        target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX,
          clientY,
        }));
      };

      const firstSubmenuItemFor = (categoryName: string): HTMLButtonElement => {
        const categoryItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
          .find((entry) => entry.querySelector("span")?.textContent === categoryName);
        if (!categoryItem) {
          throw new Error(`Missing category menu item: ${categoryName}`);
        }

        categoryItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const button = categoryItem.querySelector<HTMLButtonElement>(".ctx-submenu .ctx-menu-item");
        if (!button) {
          throw new Error(`Missing submenu button for ${categoryName}`);
        }

        return button;
      };

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return metadataVersion === 0
          ? [
              { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ]
          : [
              { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.moveSample = async function (
        _sample: { filename: string },
        newCategory: string,
        newSubcategory: string | null,
      ) {
        moveCalls += 1;
        moveTargets.push({ category: newCategory, subcategory: newSubcategory });
        if (moveCalls === 2) {
          failedMoveCalls += 1;
          throw new Error("move failed");
        }
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=sample-context-${Date.now()}`);
      await flush();

      const kickTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:kick"]');
      const grid = document.getElementById("sample-grid");
      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!kickTab || !grid || !firstBlock) {
        throw new Error("Missing initial sample-grid state");
      }

      openContextMenu(firstBlock, window.innerWidth - 12, 32);
      await flush();

      const moveMenu = document.getElementById("sample-context-menu");
      const moveHeader = moveMenu?.querySelector(".ctx-menu-header")?.textContent ?? "";
      const moveMenuFlip = moveMenu?.classList.contains("ctx-menu--flip") ?? false;

      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.body.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
      await flush();
      const dismissedByPointer = !document.getElementById("sample-context-menu");

      openContextMenu(firstBlock, window.innerWidth - 12, 32);
      await flush();
      firstSubmenuItemFor("Bass").click();
      await flush();
      const gridAfterMove = grid.textContent ?? "";

      metadataVersion = 1;
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
      await flush();
      await flush();
      const gridAfterRefresh = grid.textContent ?? "";

      openContextMenu(grid, 24, 24);
      await flush();
      const sortHeader = document.querySelector("#sample-context-menu .ctx-menu-header")?.textContent ?? "";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flush();
      const sortDismissedByEscape = !document.getElementById("sample-context-menu");

      openContextMenu(grid, 24, 24);
      await flush();
      const firstSortButton = document.querySelector<HTMLButtonElement>("#sample-context-menu button.ctx-menu-item");
      firstSortButton?.click();
      await flush();
      const sortClosedAfterSelect = !document.getElementById("sample-context-menu");

      const refreshedBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!refreshedBlock) {
        throw new Error("Missing refreshed sample block");
      }

      openContextMenu(refreshedBlock, window.innerWidth - 12, 40);
      await flush();
      firstSubmenuItemFor("Bass").click();
      await flush();

      return {
        moveHeader,
        moveMenuFlip,
        dismissedByPointer,
        gridAfterMove,
        gridAfterRefresh,
        sortHeader,
        sortDismissedByEscape,
        sortClosedAfterSelect,
        moveCalls,
        failedMoveCalls,
        moveTargets,
        toastText: document.getElementById("error-toast")?.textContent ?? "",
      };
    }, LIBRARY_MOD);

    expect(result.moveHeader).toBe("Move to");
    expect(result.moveMenuFlip).toBe(true);
    expect(result.dismissedByPointer).toBe(true);
    expect(result.gridAfterMove).toContain("No samples in this selection.");
    expect(result.gridAfterRefresh).toContain("Kick Reloaded");
    expect(result.sortHeader).toBe("Sort by");
    expect(result.sortDismissedByEscape).toBe(true);
    expect(result.sortClosedAfterSelect).toBe(true);
    expect(result.moveCalls).toBe(2);
    expect(result.failedMoveCalls).toBe(1);
    expect(result.moveTargets).toEqual([
      { category: "Bass", subcategory: null },
      { category: "Bass", subcategory: null },
    ]);
    expect(result.toastText).toBe("Could not move sample — check the console for details.");
  });

  test("the coverage harness imports exact main.ts and exercises menu and refresh branches", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let metadataVersion = 0;
      let categoryVersion = 0;
      let moveCalls = 0;

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

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const openContextMenu = (target: Element, clientX: number, clientY: number): void => {
        target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX,
          clientY,
        }));
      };

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return metadataVersion === 0
          ? [
              { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ]
          : [
              { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            {
              id: "Drum",
              name: "Drum",
              subcategories: categoryVersion === 0 ? ["kick", "fills"] : ["kick", "fills", "snare"],
            },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.moveSample = async function () {
        moveCalls += 1;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await flush();

      const addButton = document.getElementById("subcategory-add") as HTMLButtonElement | null;
      addButton?.click();
      await flush();

      const fillsTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:fills"]');
      fillsTab?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 32,
        clientY: 32,
      }));
      await flush();

      const bassCategory = document.querySelector<HTMLButtonElement>('.category-btn[data-category-id="Bass"]');
      bassCategory?.click();
      await flush();

      const drumCategory = document.querySelector<HTMLButtonElement>('.category-btn[data-category-id="Drum"]');
      drumCategory?.click();
      await flush();

      const fillsTabAfterReset = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:fills"]');
      fillsTabAfterReset?.click();
      await flush();
      const kickTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:kick"]');
      kickTab?.click();
      await flush();

      const searchInput = document.getElementById("sample-search") as HTMLInputElement | null;
      searchInput!.value = "Kick";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();

      const searchClear = document.getElementById("sample-search-clear") as HTMLButtonElement | null;
      searchClear?.click();
      await flush();

      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!firstBlock) {
        throw new Error("Missing sample block");
      }

      openContextMenu(firstBlock, window.innerWidth - 12, 40);
      await flush();
      const moveMenuVisible = Boolean(document.getElementById("sample-context-menu"));
      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.body.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
      await flush();

      openContextMenu(firstBlock, window.innerWidth - 12, 40);
      await flush();
      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      metadataVersion = 1;
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
      await flush();
      await flush();

      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      openContextMenu(grid, 24, 24);
      await flush();
      (document.querySelector("#sample-context-menu button.ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      categoryVersion = 1;
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      await flush();
      await flush();

      const snareTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:snare"]');
      snareTab?.click();
      await flush();

      return {
        moveCalls,
        moveMenuVisible,
        activeTab: document.querySelector<HTMLElement>(".subcategory-tab.is-active")?.dataset.tabId ?? null,
        hasSnareTab: Boolean(snareTab),
        gridText: document.getElementById("sample-grid")?.textContent ?? "",
        searchClearHidden: document.getElementById("sample-search-clear")?.classList.contains("is-hidden") ?? false,
      };
    }, LIBRARY_MOD);

    expect(result.moveCalls).toBe(1);
    expect(result.moveMenuVisible).toBe(true);
    expect(result.hasSnareTab).toBe(true);
    expect(result.activeTab).toBe("subcategory:snare");
    expect(result.gridText).toContain("No samples in this selection.");
    expect(result.searchClearHidden).toBe(true);
  });

  test("the real app switches configured subcategory tabs, BPM filters, categories, and playback state", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () {
        return Promise.resolve();
      };

      HTMLMediaElement.prototype.pause = function () {};
    });

    await page.goto("/");
    await expect.poll(async () => page.locator(".category-btn").count(), {
      timeout: browserAppStartupTimeoutMs,
    }).toBeGreaterThan(0);
    await expect(page.locator('.category-btn[data-category-id="Loop"]')).toBeVisible({
      timeout: browserAppStartupTimeoutMs,
    });
    await expect(page.locator(".sample-block").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });

    await page.locator('.category-btn[data-category-id="Drum"]').evaluate((button: HTMLButtonElement) => {
      button.click();
    });

    await expect(page.locator('.subcategory-tab[data-tab-id^="product:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id^="all:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.locator("#bpm-filter").selectOption("125");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await page.locator("#bpm-filter").selectOption("140");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').evaluate((button: HTMLButtonElement) => {
      button.click();
    });

    await expect(page.locator(".sample-block").first()).toBeVisible();
    await page.locator(".sample-block").first().click();
    await page.locator("#transport-stop").click();
    await expect(page.locator("#transport")).toBeVisible();
  });

  test("the real app applies Product Mode theme and default BPM from the archive dropdown", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".category-btn").first()).toBeVisible({ timeout: browserAppStartupTimeoutMs });
    await page.locator("#archive-tree").click();
    await expect.poll(async () => page.locator(".mix-tree-group").count(), {
      timeout: browserAppStartupTimeoutMs,
    }).toBeGreaterThan(0);

    const productMode = page.locator(".archive-header .product-mode-select");
    await expect.poll(async () => productMode.count(), {
      timeout: browserAppStartupTimeoutMs,
    }).toBeGreaterThan(0);
    await expect(productMode).toBeVisible({ timeout: browserAppStartupTimeoutMs });

    await productMode.selectOption("rave");
    await expect(page.locator("#bpm-filter")).toHaveValue("180");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-product-theme"))).toBe("rave");

    await productMode.selectOption("hiphop1");
    await expect(page.locator('#bpm-filter option[value="96"]')).toHaveCount(1);
    await expect(page.locator("#bpm-filter")).toHaveValue("96");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-product-theme"))).toBe("hiphop1");

    await productMode.selectOption("all");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-product-theme"))).toBeNull();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// sample-grid-context-menu module tests
// ─────────────────────────────────────────────────────────────────────────────



