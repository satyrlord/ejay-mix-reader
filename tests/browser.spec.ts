import { test, expect } from "./baseFixtures.js";

/** Navigate past the home page by clicking the dev library button. */
async function enterDevLibrary(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  // Explicit visibility check gives a clear error if the button is missing
  // (e.g. due to a DEV flag misconfiguration) rather than a generic timeout.
  await expect(page.locator("#dev-library-btn")).toBeVisible();
  await page.locator("#dev-library-btn").click();
  await expect(page.locator("[data-product-id]").first()).toBeVisible();
}

async function sampleColumnValues(
  page: import("@playwright/test").Page,
  columnIndex: number,
): Promise<string[]> {
  return page.locator(`#sample-tbody tr td:nth-child(${columnIndex})`).allTextContents();
}

test.describe("product browsing", () => {
  test("clicking a product shows sample list", async ({ page }) => {
    await enterDevLibrary(page);
    const card = page.locator("[data-product-id]").first();
    const productId = await card.getAttribute("data-product-id");
    const productName = (await card.locator("h2").textContent())?.trim();
    expect(productId).toBeTruthy();
    await card.click();

    // Should show the back button and sample table
    await expect(page.locator("#back-btn")).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("header h1")).toHaveText(productName!);
  });

  test("Techno eJay 3 exposes Sphere and not Scratch in category filters", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id='Techno_eJay3']").click();

    const filterGroup = page.locator("[role='group'][aria-label='Category filters']");
    await expect(filterGroup.getByText("sphere", { exact: true })).toBeVisible();
    await expect(filterGroup.getByText("scratch", { exact: true })).toHaveCount(0);
  });

  test("back button returns to product list", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    // Wait for the sample table — proves selectProduct() finished and
    // replaced the "← Back to Home" button with the "← Products" button.
    await expect(page.locator("table")).toBeVisible();
    await page.locator("#back-btn").click();
    await expect(page.locator("[data-product-id]").first()).toBeVisible();
  });

  test("switching between products releases the previous one", async ({ page }) => {
    await enterDevLibrary(page);
    const cards = page.locator("[data-product-id]");
    const count = await cards.count();
    if (count < 2) return; // need at least 2 products

    // Select first product
    await cards.nth(0).click();
    await expect(page.locator("table")).toBeVisible();

    // Go back and select a different product
    await page.locator("#back-btn").click();
    await expect(cards.first()).toBeVisible();
    await cards.nth(1).click();
    await expect(page.locator("table")).toBeVisible();
  });

  test("channel filter buttons are shown", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    const filterGroup = page.locator("[role='group'][aria-label='Category filters']");
    await expect(filterGroup).toBeVisible();
    // "All" button should be present
    await expect(filterGroup.getByText("All")).toBeVisible();
  });

  test("channel filter narrows sample list", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    const allRows = await page.locator("#sample-tbody tr").count();
    expect(allRows).toBeGreaterThan(0);

    // Click a specific channel filter (not "All")
    const filterGroup = page.locator("[role='group'][aria-label='Category filters']");
    const channelBtn = filterGroup.locator("button").nth(1); // first after "All"
    await channelBtn.click();

    const filteredRows = await page.locator("#sample-tbody tr").count();
    expect(filteredRows).toBeLessThanOrEqual(allRows);
    expect(filteredRows).toBeGreaterThan(0);
  });

  test("clicking All restores full sample list", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();
    const allRows = await page.locator("#sample-tbody tr").count();

    const filt = page.locator("[role='group'][aria-label='Category filters']");
    await filt.locator("button").nth(1).click();
    const filtered = await page.locator("#sample-tbody tr").count();
    expect(filtered).toBeLessThan(allRows);

    await filt.getByText("All").click();
    const restored = await page.locator("#sample-tbody tr").count();
    expect(restored).toEqual(allRows);
  });

  test("search with no results shows empty message", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();
    await page.locator("#search-input").fill("xyznonexistent99999");
    await expect(page.locator("text=No samples match your filter.")).toBeVisible();
  });

  test("search filters samples by name", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    const allRows = await page.locator("#sample-tbody tr").count();

    // Type a search term that should match some but not all samples
    await page.locator("#search-input").fill("bass");
    // Wait for the DOM to reflect the filter result
    await expect(page.locator("#sample-tbody tr")).not.toHaveCount(allRows);

    const filteredRows = await page.locator("#sample-tbody tr").count();
    expect(filteredRows).toBeLessThanOrEqual(allRows);
  });

  test("search on product list page filters products", async ({ page }) => {
    await enterDevLibrary(page);
    await expect(page.locator("[data-product-id]").first()).toBeVisible();
    const allCards = await page.locator("[data-product-id]").count();

    // Type a query that matches some but not all products
    await page.locator("#search-input").fill("Dance");
    await expect(page.locator("[data-product-id]")).not.toHaveCount(allCards);
    const filtered = await page.locator("[data-product-id]").count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(allCards);

    // Clear search restores all products
    await page.locator("#search-input").fill("");
    await expect(page.locator("[data-product-id]")).toHaveCount(allCards);
    const restored = await page.locator("[data-product-id]").count();
    expect(restored).toBe(allCards);
  });

  test("play button toggles playing state", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    // Click the first sample row
    const firstRow = page.locator("#sample-tbody tr").first();
    await firstRow.click();

    // Transport should update from "No sample playing"
    await expect(page.locator("#transport-name")).not.toHaveText("No sample playing");
  });

  test("toggling same sample stops playback", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    const firstRow = page.locator("#sample-tbody tr").first();
    await firstRow.click();
    await expect(page.locator("#transport-name")).not.toHaveText("No sample playing");
    await firstRow.click(); // toggle off
    await expect(page.locator("#transport-name")).toHaveText("No sample playing");
  });

  test("switching samples updates transport", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    await page.locator("#sample-tbody tr").first().click();
    await expect(page.locator("#transport-name")).not.toHaveText("No sample playing");
    const name1 = await page.locator("#transport-name").textContent();

    await page.locator("#sample-tbody tr").nth(1).click();
    // Wait for transport name to change from the first sample's name
    await expect(page.locator("#transport-name")).not.toHaveText(name1!);
    const name2 = await page.locator("#transport-name").textContent();
    expect(name1).not.toEqual(name2);
  });

  test("progress bar updates while playing", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    await page.locator("#sample-tbody tr").first().click();
    await expect(page.locator("#transport-name")).not.toHaveText("No sample playing");
    // Poll until the progress bar reflects actual playback (value > 0)
    await expect.poll(() =>
      page.evaluate(() => (document.getElementById("transport-progress") as HTMLProgressElement | null)?.value ?? 0)
    ).toBeGreaterThan(0);
    await expect(page.locator("#transport-progress")).toBeVisible();
  });

  test("stop button resets transport", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    // Play a sample
    await page.locator("#sample-tbody tr").first().click();
    await expect(page.locator("#transport-name")).not.toHaveText("No sample playing");

    // Click stop
    await page.locator("#transport-stop").click();
    await expect(page.locator("#transport-name")).toHaveText("No sample playing");
  });

  test("sample row shows play/stop icons", async ({ page }) => {
    await enterDevLibrary(page);
    await page.locator("[data-product-id]").first().click();
    await expect(page.locator("table")).toBeVisible();

    const firstRow = page.locator("#sample-tbody tr").first();
    // Play icon should be visible, stop icon hidden
    await expect(firstRow.locator(".play-icon")).toBeVisible();
    await expect(firstRow.locator(".stop-icon")).toBeHidden();
  });
});

test.describe("data module edge cases", () => {
  // Dynamic imports via variables prevent TS2307 — these are Vite-served URLs, not Node modules.
  const DATA_MOD = "/src/data.ts";
  const RENDER_MOD = "/src/render.ts";
  const PLAYER_MOD = "/src/player.ts";

  test("sampleChannel fallback paths", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      return {
        fromSlash: mod.sampleChannel({ filename: "bass/test.wav" }),
        noInfo: mod.sampleChannel({ filename: "test.wav" }),
        fromCategory: mod.sampleChannel({ filename: "test.wav", category: "Drums" }),
        fromChannel: mod.sampleChannel({ filename: "test.wav", channel: "Bass" }),
      };
    }, DATA_MOD);
    expect(results.fromSlash).toBe("bass");
    expect(results.noInfo).toBe("unknown");
    expect(results.fromCategory).toBe("drums");
    expect(results.fromChannel).toBe("bass");
  });

  test("deriveChannels returns sorted unique channels", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      return {
        mixed: mod.deriveChannels([
          { filename: "a.wav", channel: "Drum" },
          { filename: "b.wav", channel: "Bass" },
          { filename: "c.wav", channel: "Drum" },
          { filename: "d.wav", category: "Effect" },
        ]),
        empty: mod.deriveChannels([]),
      };
    }, DATA_MOD);
    expect(results.mixed).toEqual(["bass", "drum", "effect"]);
    expect(results.empty).toEqual([]);
  });

  test("sampleAudioPath fallback paths", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      return {
        gen1: mod.sampleAudioPath("prod", { filename: "rap/test.wav" }),
        withChannel: mod.sampleAudioPath("prod", { filename: "test.wav", channel: "Bass" }),
        withCategory: mod.sampleAudioPath("prod", { filename: "test.wav", category: "Drums" }),
        fallback: mod.sampleAudioPath("prod", { filename: "test.wav" }),
      };
    }, DATA_MOD);
    expect(results.gen1).toBe("output/prod/rap/test.wav");
    expect(results.withChannel).toBe("output/prod/Bass/test.wav");
    expect(results.withCategory).toBe("output/prod/Drums/test.wav");
    expect(results.fallback).toBe("output/prod/unknown/test.wav");
  });

  test("filterSamples with detail and category match", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const samples = [
        { filename: "a.wav", alias: "kick", detail: "punchy kick" },
        { filename: "b.wav", alias: "snare", category: "percussion" },
        { filename: "c.wav", alias: "hat" },
      ];
      return {
        byDetail: mod.filterSamples(samples, null, "punchy").length,
        byCategory: mod.filterSamples(samples, null, "percussion").length,
        noMatch: mod.filterSamples(samples, null, "zzz").length,
        noFilter: mod.filterSamples(samples, null, "").length,
      };
    }, DATA_MOD);
    expect(results.byDetail).toBe(1);
    expect(results.byCategory).toBe(1);
    expect(results.noMatch).toBe(0);
    expect(results.noFilter).toBe(3);
  });

  test("sortSamples applies alphabetical and numeric asc/desc ordering", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const samples = [
        { filename: "z.wav", alias: "Zulu", category: "Acid", channel: "bass", beats: 4, duration_sec: 3.5 },
        { filename: "a.wav", alias: "Alpha", category: "Acid", channel: "bass", beats: 4, duration_sec: 3.5 },
        { filename: "c.wav", alias: "Charlie", category: "Break", channel: "drum", beats: 4, duration_sec: 3.5 },
        { filename: "b.wav", alias: "Bravo", category: "Break", channel: "drum", beats: 8, duration_sec: 1.2 },
        { filename: "d.wav", alias: "Delta", category: "Break", channel: "drum", beats: 8, duration_sec: 1.2 },
      ];

      return {
        nameAsc: mod.sortSamples(samples, { key: "name", direction: "asc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        nameDesc: mod.sortSamples(samples, { key: "name", direction: "desc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        categoryAsc: mod.sortSamples(samples, { key: "category", direction: "asc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        categoryDesc: mod.sortSamples(samples, { key: "category", direction: "desc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        beatsAsc: mod.sortSamples(samples, { key: "beats", direction: "asc" }).map((sample: { beats?: number }) => sample.beats),
        beatsDesc: mod.sortSamples(samples, { key: "beats", direction: "desc" }).map((sample: { beats?: number }) => sample.beats),
        beatsAscNames: mod.sortSamples(samples, { key: "beats", direction: "asc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        beatsDescNames: mod.sortSamples(samples, { key: "beats", direction: "desc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        durationAsc: mod.sortSamples(samples, { key: "duration", direction: "asc" }).map((sample: { duration_sec?: number }) => sample.duration_sec),
        durationDesc: mod.sortSamples(samples, { key: "duration", direction: "desc" }).map((sample: { duration_sec?: number }) => sample.duration_sec),
        durationAscNames: mod.sortSamples(samples, { key: "duration", direction: "asc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
        durationDescNames: mod.sortSamples(samples, { key: "duration", direction: "desc" }).map((sample: { alias?: string; category?: string; filename: string }) => mod.sampleMergedName(sample)),
      };
    }, DATA_MOD);

    expect(results.nameAsc).toEqual(["Acid - Alpha", "Acid - Zulu", "Break - Bravo", "Break - Charlie", "Break - Delta"]);
    expect(results.nameDesc).toEqual(["Break - Delta", "Break - Charlie", "Break - Bravo", "Acid - Zulu", "Acid - Alpha"]);
    expect(results.categoryAsc).toEqual(["Acid - Alpha", "Acid - Zulu", "Break - Bravo", "Break - Charlie", "Break - Delta"]);
    expect(results.categoryDesc).toEqual(["Break - Bravo", "Break - Charlie", "Break - Delta", "Acid - Alpha", "Acid - Zulu"]);
    expect(results.beatsAsc).toEqual([4, 4, 4, 8, 8]);
    expect(results.beatsDesc).toEqual([8, 8, 4, 4, 4]);
    expect(results.beatsAscNames).toEqual(["Acid - Alpha", "Acid - Zulu", "Break - Charlie", "Break - Bravo", "Break - Delta"]);
    expect(results.beatsDescNames).toEqual(["Break - Bravo", "Break - Delta", "Acid - Alpha", "Acid - Zulu", "Break - Charlie"]);
    expect(results.durationAsc).toEqual([1.2, 1.2, 3.5, 3.5, 3.5]);
    expect(results.durationDesc).toEqual([3.5, 3.5, 3.5, 1.2, 1.2]);
    expect(results.durationAscNames).toEqual(["Break - Bravo", "Break - Delta", "Acid - Alpha", "Acid - Zulu", "Break - Charlie"]);
    expect(results.durationDescNames).toEqual(["Acid - Alpha", "Acid - Zulu", "Break - Charlie", "Break - Bravo", "Break - Delta"]);
  });
});

test.describe("library edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("FetchLibrary error branches on failed requests", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const lib = new FetchLibrary();
      const originalFetch = globalThis.fetch;

      // Mock fetch to return 404
      globalThis.fetch = async () => new Response("", { status: 404, statusText: "Not Found" });

      let indexError = "";
      try { await lib.loadIndex(); } catch (e) { indexError = (e as Error).message; }

      // loadProductSamples returns [] on 404
      const samples = await lib.loadProductSamples("nonexistent");

      // Mock fetch to return 500 — should throw
      globalThis.fetch = async () => new Response("", { status: 500, statusText: "Server Error" });
      let metaError = "";
      try { await lib.loadProductSamples("broken"); } catch (e) { metaError = (e as Error).message; }

      // Mock fetch to return invalid JSON shape — should throw
      globalThis.fetch = async () => new Response(JSON.stringify({ notsamples: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      let shapeError = "";
      try { await lib.loadProductSamples("bad_shape"); } catch (e) { shapeError = (e as Error).message; }

      globalThis.fetch = originalFetch;
      return { indexError, samplesLength: samples.length, metaError, shapeError };
    }, LIBRARY_MOD);

    expect(result.indexError).toContain("404");
    expect(result.samplesLength).toBe(0);
    expect(result.metaError).toContain("500");
    expect(result.shapeError).toContain("Invalid metadata");
  });

  test("FetchLibrary resolveAudioUrl returns correct paths", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const lib = new FetchLibrary();
      return {
        gen1: await lib.resolveAudioUrl("prod", { filename: "rap/test.wav" }),
        withChannel: await lib.resolveAudioUrl("prod", { filename: "test.wav", channel: "Bass" }),
      };
    }, LIBRARY_MOD);

    expect(results.gen1).toBe("output/prod/rap/test.wav");
    expect(results.withChannel).toBe("output/prod/Bass/test.wav");
  });
});

test.describe("render edge cases", () => {
  const RENDER_MOD = "/src/render.ts";
  const PLAYER_MOD = "/src/player.ts";
  const LIBRARY_MOD = "/src/library.ts";

  test("sample table headers sort asc and desc in the app", async ({ page }) => {
    const mockSamples = {
      samples: [
        { filename: "z.wav", alias: "Zulu", category: "Acid", channel: "bass", beats: 4, duration_sec: 3.5 },
        { filename: "a.wav", alias: "Alpha", category: "Acid", channel: "bass", beats: 4, duration_sec: 3.5 },
        { filename: "c.wav", alias: "Charlie", category: "Break", channel: "drum", beats: 4, duration_sec: 3.5 },
        { filename: "b.wav", alias: "Bravo", category: "Break", channel: "drum", beats: 8, duration_sec: 1.2 },
        { filename: "d.wav", alias: "Delta", category: "Break", channel: "drum", beats: 8, duration_sec: 1.2 },
      ],
    };

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          products: [{ id: "test_product", name: "Test Product", channels: ["bass", "drum", "groove"], sampleCount: 3 }],
        }),
      });
    });

    await page.route("**/output/test_product/metadata.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(mockSamples),
      });
    });

    await enterDevLibrary(page);
    await page.locator("[data-product-id='test_product']").click();
    await expect(page.locator("table")).toBeVisible();

    await expect(page.locator("thead th").nth(2)).toHaveText(/Category/);

    await page.locator("button[data-sort-key='name']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Bravo",
      "Break - Charlie",
      "Break - Delta",
    ]);
    await page.locator("button[data-sort-key='name']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Break - Delta",
      "Break - Charlie",
      "Break - Bravo",
      "Acid - Zulu",
      "Acid - Alpha",
    ]);

    await page.locator("button[data-sort-key='category']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Bravo",
      "Break - Charlie",
      "Break - Delta",
    ]);
    await page.locator("button[data-sort-key='category']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Break - Bravo",
      "Break - Charlie",
      "Break - Delta",
      "Acid - Alpha",
      "Acid - Zulu",
    ]);

    await page.locator("button[data-sort-key='beats']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Charlie",
      "Break - Bravo",
      "Break - Delta",
    ]);
    await page.locator("button[data-sort-key='beats']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Break - Bravo",
      "Break - Delta",
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Charlie",
    ]);

    await page.locator("button[data-sort-key='duration']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Break - Bravo",
      "Break - Delta",
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Charlie",
    ]);
    await page.locator("button[data-sort-key='duration']").click();
    await expect.poll(() => sampleColumnValues(page, 2)).toEqual([
      "Acid - Alpha",
      "Acid - Zulu",
      "Break - Charlie",
      "Break - Bravo",
      "Break - Delta",
    ]);
  });

  test("renderSampleList merges category into the Name column", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([rPath, pPath, lPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const { FetchLibrary } = await import(/* @vite-ignore */ lPath);

      const container = document.createElement("div");
      document.body.appendChild(container);

      const player = new Player();
      const library = new FetchLibrary();
      render.renderSampleList(
        container,
        [
          {
            filename: "full.wav",
            alias: "Loop 1",
            duration_sec: 1.5,
            category: "Disco Lady",
            channel: "groove",
            beats: 4,
          },
        ],
        "test_product",
        player,
        library,
        { key: null, direction: "asc" },
        () => {},
      );

      return {
        headers: Array.from(container.querySelectorAll("thead th")).map(el => el.textContent?.trim() ?? ""),
        rowCellCount: container.querySelectorAll("tbody tr td").length,
        nameText: container.querySelector("tbody tr td:nth-child(2)")?.textContent?.trim() ?? "",
      };
    }, [RENDER_MOD, PLAYER_MOD, LIBRARY_MOD] as const);

    expect(result.headers).toEqual(["", "Name↕", "Category↕", "Beats↕", "Duration↕"]);
    expect(result.rowCellCount).toBe(5);
    expect(result.nameText).toBe("Disco Lady - Loop 1");
  });

  test("renderSampleList with sparse metadata covers fallback branches", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async ([rPath, pPath, lPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const { FetchLibrary } = await import(/* @vite-ignore */ lPath);

      const container = document.createElement("div");
      document.body.appendChild(container);

      const samples = [
        { filename: "bare.wav" },
        { filename: "full.wav", alias: "Full", duration_sec: 1.5, category: "drums", beats: 4 },
      ];

      const player = new Player();
      const library = new FetchLibrary();
      render.renderSampleList(container, samples, "test_product", player, library, { key: null, direction: "asc" }, () => {});
    }, [RENDER_MOD, PLAYER_MOD, LIBRARY_MOD] as const);
  });

  test("updateTransport and updatePlayingRow with null path", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const player = new Player();
      render.updateTransport(null, player);
      render.updatePlayingRow(null);
    }, [RENDER_MOD, PLAYER_MOD] as const);
  });

  test("updateTransport with active path", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const player = new Player();
      render.updateTransport("output/test/Bass/kick.wav", player);
    }, [RENDER_MOD, PLAYER_MOD] as const);
  });

  test("renderHeader with onBack=null hides back button", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const container = document.createElement("div");
      document.body.appendChild(container);
      render.renderHeader(container, () => {}, null);
    }, RENDER_MOD);
  });

  test("channelButton active styles applied", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const container = document.createElement("div");
      document.body.appendChild(container);
      render.renderChannelFilters(container, ["bass", "drum"], "bass", () => {});
    }, RENDER_MOD);
  });

  test("error toast appears when resolveAudioUrl fails", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const player = new Player();
      const failLibrary = {
        resolveAudioUrl: () => Promise.reject(new Error("not found")),
        releaseProduct: () => {},
        dispose: () => {},
        loadIndex: () => Promise.resolve({ products: [] }),
        loadProductSamples: () => Promise.resolve([]),
      };
      render.renderSampleList(
        container,
        [{ filename: "test.wav", alias: "Test" }],
        "prod",
        player,
        failLibrary as Parameters<typeof render.renderSampleList>[4],
        { key: null, direction: "asc" },
        () => {},
      );
    }, [RENDER_MOD, PLAYER_MOD] as const);
    await page.locator("#sample-tbody tr").first().click();
    await expect(page.locator("#error-toast")).toBeVisible();
  });
});

test.describe("player edge cases", () => {
  const PLAYER_MOD = "/src/player.ts";

  test("Player initial state getters", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      return {
        state: p.state,
        activePath: p.activePath,
        currentTime: p.currentTime,
        duration: p.duration,
      };
    }, PLAYER_MOD);
    expect(results.state).toBe("stopped");
    expect(results.activePath).toBeNull();
    expect(results.currentTime).toBe(0);
    expect(results.duration).toBe(0);
  });

  test("Player stop when not playing", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      const states: string[] = [];
      p.onStateChange((s: string) => states.push(s));
      p.stop();
    }, PLAYER_MOD);
  });

  test("Player play same path reuses src", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      const header = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x20, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20,
        0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x40, 0x1F, 0x00, 0x00, 0x40, 0x1F, 0x00, 0x00,
        0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61,
        0x00, 0x20, 0x00, 0x00,
      ]);
      const data = new Uint8Array(header.length + 8192);
      data.set(header);
      data.fill(128, header.length);
      const blob = new Blob([data], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      try { p.play(url); } catch { /* ignore play rejection */ }
      try { p.play(url); } catch { /* ignore play rejection */ }
      p.stop();
    }, PLAYER_MOD);
  });

  test("calcProgressInterval clamps and scales correctly", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const { calcProgressInterval } = await import(/* @vite-ignore */ modPath);
      return {
        zero: calcProgressInterval(0),      // unknown duration → 250 ms fallback
        negative: calcProgressInterval(-1), // negative → 250 ms fallback
        short: calcProgressInterval(1),     // 1s → 1000/20 = 50 ms (min clamp)
        medium: calcProgressInterval(3),    // 3s → 3000/20 = 150 ms
        long: calcProgressInterval(10),     // 10s → 10000/20 = 500 ms → clamped to 250
        boundary: calcProgressInterval(2.5), // 2.5s → 2500/20 = 125 ms
      };
    }, PLAYER_MOD);
    expect(results.zero).toBe(250);
    expect(results.negative).toBe(250);
    expect(results.short).toBe(50);
    expect(results.medium).toBe(150);
    expect(results.long).toBe(250);
    expect(results.boundary).toBe(125);
  });
});
