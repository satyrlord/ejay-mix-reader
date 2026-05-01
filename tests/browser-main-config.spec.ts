import { test, expect } from "./baseFixtures.js";

test.describe("main edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("beforeunload handler runs without crashing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".category-btn").first()).toBeVisible();

    const result = await page.evaluate(() => {
      try {
        window.dispatchEvent(new Event("beforeunload"));
        return "ok";
      } catch {
        return "error";
      }
    });

    expect(result).toBe("ok");
    await expect(page.locator("#transport")).toBeVisible();
  });

  test("main falls back to default categories when config loading is unavailable and disables subcategory writes", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
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
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 1 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass.wav", alias: "Bass", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = undefined;
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return false;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://bass.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=no-config-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();

      return {
        categoryCount: document.querySelectorAll(".category-btn").length,
        addDisabled: Boolean((document.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
      };
    }, LIBRARY_MOD);

    expect(result.categoryCount).toBeGreaterThan(1);
    expect(result.addDisabled).toBe(true);
  });

  test("main closes the inline subcategory editor when a config refresh disables writes", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let loadCategoryConfigCalls = 0;
      let canWriteCategoryConfig = true;

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

        canWriteCategoryConfig = false;
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return canWriteCategoryConfig;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://kick.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=write-toggle-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();

      (document.querySelector("#subcategory-add") as HTMLButtonElement).click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      await Promise.resolve();
      await Promise.resolve();

      return {
        inlineEditorOpen: Boolean(document.querySelector("#subcategory-add-input")),
        addDisabled: Boolean((document.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
        hasSnareTab: Boolean(document.querySelector('.subcategory-tab[data-tab-id="subcategory:snare"]')),
      };
    }, LIBRARY_MOD);

    expect(result.inlineEditorOpen).toBe(false);
    expect(result.addDisabled).toBe(true);
    expect(result.hasSnareTab).toBe(true);
  });

  test("the real app falls back to the default config when categories.json fails to load initially", async ({ page }) => {
    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "broken config" }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
  });

  test("the real app applies category config refreshes when categories.json changes", async ({ page }) => {
    let categoryFetches = 0;

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{
            id: "Drum",
            name: "Drum",
            subcategories: categoryFetches === 1 ? ["kick"] : ["kick", "snare"],
          }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toHaveCount(0);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBeGreaterThan(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);
  });

  test("the real app coalesces config refreshes and falls back when the active category disappears", async ({ page }) => {
    let categoryFetches = 0;
    let releaseRefresh = (): void => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        resolve();
      };
    });

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;

      if (categoryFetches === 2) {
        await refreshGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            categories: [{ id: "Bass", name: "Bass", subcategories: ["riff"] }],
          }),
        });
        return;
      }

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
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Drum");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBe(2);
    releaseRefresh();

    await page.waitForLoadState("networkidle");
    await expect(page.locator('.category-btn[data-category-id="Bass"]')).toBeVisible();
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:unsorted");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");
    await expect.poll(() => categoryFetches).toBe(2);
  });

  test("the real app ignores unchanged category config refreshes and does not save cancelled, blank, or duplicate inline subcategory edits", async ({ page }) => {
    let categoryFetches = 0;
    let saveCalls = 0;
    const categoryConfig = {
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
    };

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(categoryConfig),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() === "PUT") {
        saveCalls += 1;
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.continue();
    });

    await page.goto("/");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBeGreaterThan(1);
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);

    await page.locator("#subcategory-add").click();
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await expect(page.locator("#subcategory-add-confirm")).toBeDisabled();
    await expect(page.locator("#subcategory-add-confirm svg")).toHaveCount(1);
    await page.locator("#subcategory-add-input").press("Escape");
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill("   ");
    await expect(page.locator("#subcategory-add-confirm")).toBeDisabled();
    await page.locator("#subcategory-add-input").press("Enter");
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await page.locator("#subcategory-add-input").press("Escape");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]').click();
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:snare");

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill(" kick ");
    await expect(page.locator("#subcategory-add-confirm")).toBeEnabled();
    await page.locator("#subcategory-add-input").press("Enter");
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:kick");

    expect(categoryFetches).toBeGreaterThan(1);
    expect(saveCalls).toBe(0);
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);
  });

  test("the real app hardcodes special tabs and removes only configured user subcategories through the context menu", async ({ page }) => {
    let saveCalls = 0;
    let categoryConfig = {
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "fills"] }],
    };

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(categoryConfig),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      saveCalls += 1;
      categoryConfig = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toHaveAttribute("data-tab-kind", "system");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toHaveAttribute("data-tab-kind", "special");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toHaveAttribute("data-tab-kind", "user");

    await page.evaluate(() => {
      document.getElementById("subcategory-tabs")?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.evaluate(() => {
      const tabs = document.getElementById("subcategory-tabs");
      if (!tabs) return;

      const orphanTextNode = document.createTextNode("orphan text target");
      tabs.appendChild(orphanTextNode);
      orphanTextNode.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 28,
        clientY: 28,
      }));
      tabs.removeChild(orphanTextNode);
    });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Fill");

    const saveResponse = page.waitForResponse((response) => (
      response.url().endsWith("/__category-config") && response.request().method() === "PUT"
    ));
    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveCount(1);
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveText("remove");
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveCount(1);
    await page.locator("#subcategory-context-menu .subcategory-context-menu-item").click();
    await saveResponse;

    expect(saveCalls).toBe(1);
    expect(categoryConfig).toEqual({
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
    });

    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click();
    await expect(page.locator(".sample-grid")).not.toContainText("Fill");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Fill");
  });

  test("the real app shows a toast when saving an inline subcategory fails", async ({ page }) => {
    let saveCalls = 0;

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() === "PUT") {
        saveCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "write failed" }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill("fills");
    await page.locator("#subcategory-add-confirm").click();

    expect(saveCalls).toBe(1);
    await expect(page.locator("#error-toast")).toHaveText("Could not save categories.json.");
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// sample-grid-context-menu module tests
// ─────────────────────────────────────────────────────────────────────────────



