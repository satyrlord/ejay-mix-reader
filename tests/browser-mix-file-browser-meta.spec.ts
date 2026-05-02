import { test, expect } from "./baseFixtures.js";

test.describe("mix-file-browser module", () => {
  const MFB_MOD = "/src/mix-file-browser.ts";

  test("formatMetaTooltip: includes adjusted BPM when different from bpm", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({ bpm: 140, bpmAdjusted: 120, trackCount: 5, catalogs: [] });
    }, MFB_MOD);
    expect(result).toContain("120 adjusted");
  });

  test("formatMetaTooltip: includes title and author when present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({
        bpm: 130, trackCount: 10, catalogs: [],
        title: "My Mix", author: "DJ Test",
      });
    }, MFB_MOD);
    expect(result).toContain('"My Mix"');
    expect(result).toContain("by DJ Test");
  });

  test("formatMetaTooltip: normalizes HipHop 1 Gen1 appId metadata to 96 BPM", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({
        appId: 0x00000a08,
        format: "A",
        bpm: 90,
        trackCount: 8,
        catalogs: [],
      });
    }, MFB_MOD);
    expect(result).toContain("BPM: 96");
  });

  // ── buildMetaRows ──────────────────────────────────────────────────────────

  test("buildMetaRows: returns file and product rows when meta is undefined", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("test.MIX", "Dance eJay 1", undefined);
    }, MFB_MOD);
    expect(result).toEqual([["File", "test.MIX"], ["Product", "Dance eJay 1"]]);
  });

  test("buildMetaRows: returns all fields when meta has full data", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("test.MIX", "Rave", {
        appId: 0x000015dc,
        bpm: 155, bpmAdjusted: 140, trackCount: 30,
        catalogs: ["Rave", "Techno"],
        title: "Hard Rain", author: "DJ X",
        tickerText: ["Line one", "Line two"],
      });
    }, MFB_MOD);
    const keys = result.map(([k]: [string, string]) => k);
    expect(keys).toContain("BPM");
    expect(keys).toContain("Tracks");
    expect(keys).toContain("App ID");
    expect(keys).toContain("Title");
    expect(keys).toContain("Author");
    expect(keys).toContain("Ticker");
    expect(keys).toContain("Sample packs");
    // BPM row should show both values when adjusted differs
    const bpmRow = result.find(([k]: [string, string]) => k === "BPM");
    expect(bpmRow?.[1]).toContain("155");
    expect(bpmRow?.[1]).toContain("140");
  });

  test("buildMetaRows: normalizes HipHop 1 Gen1 appId BPM row to 96", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("SUMMER.MIX", "HipHop 1", {
        appId: 0x00000a08,
        format: "A" as const,
        bpm: 90,
        trackCount: 252,
        catalogs: ["HipHop eJay 1.01"],
      });
    }, MFB_MOD);
    const bpmRow = result.find(([k]: [string, string]) => k === "BPM");
    expect(bpmRow?.[1]).toBe("96");
  });

  test("buildMetaRows: format row shows em-dash when catalogs is empty", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("x.MIX", "Rave", { bpm: 170, trackCount: 8, catalogs: [] });
    }, MFB_MOD);
    const formatRow = result.find(([k]: [string, string]) => k === "Format");
    expect(formatRow?.[1]).toBe("—");
  });

  test("buildMetaRows: includes Lanes and Timeline rows when diagnostics present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      const recovered = buildMetaRows("a.MIX", "Rave", {
        bpm: 170, trackCount: 4, catalogs: [],
        laneCount: 17, timelineRecovered: true, maxBeat: 31,
      });
      const recoveredNoMaxBeat = buildMetaRows("b.MIX", "Rave", {
        bpm: 170, trackCount: 4, catalogs: [],
        laneCount: 17, timelineRecovered: true,
      });
      const listView = buildMetaRows("c.MIX", "Techno eJay 3", {
        bpm: 130, trackCount: 9, catalogs: [],
        laneCount: 32, timelineRecovered: false,
      });
      return { recovered, recoveredNoMaxBeat, listView };
    }, MFB_MOD);

    const lanesRow = result.recovered.find(([k]: [string, string]) => k === "Lanes");
    expect(lanesRow?.[1]).toBe("17");
    const tlRow = result.recovered.find(([k]: [string, string]) => k === "Timeline");
    expect(tlRow?.[1]).toBe("recovered (32 beats)");

    const tlRowNoMax = result.recoveredNoMaxBeat.find(([k]: [string, string]) => k === "Timeline");
    expect(tlRowNoMax?.[1]).toBe("recovered");

    const listRow = result.listView.find(([k]: [string, string]) => k === "Timeline");
    expect(listRow?.[1]).toBe("list view (timeline unrecovered)");
    const listLanes = result.listView.find(([k]: [string, string]) => k === "Lanes");
    expect(listLanes?.[1]).toBe("32");
  });

  test("mixMetaFromIr: populates laneCount and timeline diagnostics", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { mixMetaFromIr } = await import(/* @vite-ignore */ modPath);
      const baseIr = {
        appId: 0, format: "B" as const, bpm: 140, bpmAdjusted: null,
        title: "", author: "", tickerText: [],
        catalogs: [{ name: "x" }],
      };
      const noBeats = mixMetaFromIr({
        ...baseIr,
        tracks: [{ beat: null, channel: 0 }, { beat: undefined, channel: 1 }],
      });
      const withBeats = mixMetaFromIr({
        ...baseIr,
        format: "C" as const,
        tracks: [
          { beat: 5, channel: 0 },
          { beat: 12, channel: 2 },
          { beat: Number.NaN, channel: 3 },
          { beat: null, channel: 4 },
        ],
      });
      const formatA = mixMetaFromIr({ ...baseIr, format: "A" as const, tracks: [] });
      const nullIr = mixMetaFromIr(null);
      return { noBeats, withBeats, formatA, nullIr };
    }, MFB_MOD);

    expect(result.nullIr).toBeUndefined();
    expect(result.noBeats?.laneCount).toBe(17);
    expect(result.noBeats?.timelineRecovered).toBe(false);
    expect(result.noBeats?.maxBeat).toBeUndefined();
    expect(result.withBeats?.laneCount).toBe(32);
    expect(result.withBeats?.timelineRecovered).toBe(true);
    expect(result.withBeats?.maxBeat).toBe(12);
    expect(result.formatA?.laneCount).toBe(8);
    expect(result.formatA?.timelineRecovered).toBe(false);
  });

  // ── popup lifecycle ────────────────────────────────────────────────────────

  test("DEV mode: clicking a .mix file with meta shows .mix-meta-popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{
          filename: "START.MIX", sizeBytes: 100, format: "A" as const,
          meta: { bpm: 140, trackCount: 20, catalogs: ["Dance eJay 1"] },
        }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-popup-open" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load</p>
          </div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-popup-open")!;
      initMixFileBrowser(sidebar, { mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();

      return {
        popupVisible: isMixMetaPopupVisible(),
        popupInBody: document.getElementById("mix-meta-popup") !== null,
      };
    }, MFB_MOD);

    expect(result.popupVisible).toBe(true);
    expect(result.popupInBody).toBe(true);
  });

  test("DEV mode: clicking a second .mix file replaces the popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [
          { filename: "A.MIX", sizeBytes: 10, format: "A" as const, meta: { bpm: 130, trackCount: 15, catalogs: [] } },
          { filename: "B.MIX", sizeBytes: 10, format: "A" as const, meta: { bpm: 140, trackCount: 22, catalogs: [] } },
        ],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-popup-replace" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-popup-replace")!;
      initMixFileBrowser(sidebar, { mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const [btnA, btnB] = Array.from(sidebar.querySelectorAll<HTMLButtonElement>(".mix-tree-item"));
      btnA.click();
      const firstId = document.getElementById("mix-meta-popup")?.id;
      btnB.click();
      const popupCount = document.querySelectorAll("#mix-meta-popup").length;
      const tableText = document.getElementById("mix-meta-popup")?.textContent ?? "";

      return { firstId, popupCount, tableText };
    }, MFB_MOD);

    expect(result.firstId).toBe("mix-meta-popup");
    expect(result.popupCount).toBe(1);
    expect(result.tableText).toContain("22"); // B.MIX track count
  });

  test("dismissMixMetaPopup: removes popup when called directly", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { showMixMetaPopup, dismissMixMetaPopup, isMixMetaPopupVisible } =
        await import(/* @vite-ignore */ modPath);

      const anchor = document.createElement("button");
      document.body.appendChild(anchor);
      showMixMetaPopup("test.MIX", "Rave", { bpm: 170, trackCount: 5, catalogs: [] }, anchor);
      const before = isMixMetaPopupVisible();
      dismissMixMetaPopup();
      const after = isMixMetaPopupVisible();
      return { before, after };
    }, MFB_MOD);

    expect(result.before).toBe(true);
    expect(result.after).toBe(false);
  });

  test("dismissMixMetaPopup: is safe when no popup exists", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { dismissMixMetaPopup, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);
      dismissMixMetaPopup(); // should not throw
      return isMixMetaPopupVisible();
    }, MFB_MOD);
    expect(result).toBe(false);
  });

});


