import { test, expect } from "./baseFixtures.js";
import type { MixLibraryEntry } from "../src/data.js";

test.describe("mix-file-browser module", () => {
  const MFB_MOD = "/src/mix-file-browser.ts";

  const SAMPLE_LIBRARY: MixLibraryEntry[] = [
    {
      id: "Dance_eJay1",
      name: "Dance eJay 1",
      mixes: [
        { filename: "START.MIX", sizeBytes: 11234, format: "A" },
        { filename: "LOVE.MIX", sizeBytes: 11234, format: "A" },
      ],
    },
    {
      id: "Dance_eJay2",
      name: "Dance eJay 2",
      mixes: [
        { filename: "HAPPY.MIX", sizeBytes: 8219, format: "B" },
      ],
    },
  ];

  test("initMixFileBrowser adds is-awaiting-click and keyboard role to placeholder", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-test" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-test")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: [],
        onSelectFile: () => {},
      });

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content");
      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder");
      return {
        awaiting: content?.classList.contains("is-awaiting-click"),
        phRole: ph?.getAttribute("role"),
        phTabindex: ph?.getAttribute("tabindex"),
      };
    }, MFB_MOD);

    expect(result.awaiting).toBe(true);
    expect(result.phRole).toBe("button");
    expect(result.phTabindex).toBe("0");
  });

  test("initMixFileBrowser DEV mode: click renders product tree and sets header root", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-dev" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-dev")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: () => {},
      });

      // Trigger by clicking the sidebar
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const groups = content.querySelectorAll(".mix-tree-group-header");
      const header = sidebar.querySelector<HTMLElement>(".archive-header");

      return {
        awaiting: content.classList.contains("is-awaiting-click"),
        groupCount: groups.length,
        firstGroupLabel: groups[0]?.querySelector(".mix-tree-group-label")?.textContent,
        productSelectClass: header?.querySelector("select.product-mode-select")?.className,
        productSelectValue: (header?.querySelector("select.product-mode-select") as HTMLSelectElement | null)?.value,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.awaiting).toBe(false);
    expect(result.groupCount).toBe(2);
    expect(result.firstGroupLabel).toBe("Dance eJay 1");
    expect(result.productSelectClass).toBe("product-mode-select");
    expect(result.productSelectValue).toBe("all");
  });

  test("DEV mode: first group is auto-expanded, others are collapsed", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-expand" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-expand")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: () => {},
      });

      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const items = content.querySelectorAll<HTMLElement>(".mix-tree-items");
      return {
        firstHidden: items[0]?.hidden,
        secondHidden: items[1]?.hidden,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.firstHidden).toBe(false);
    expect(result.secondHidden).toBe(true);
  });

  test("DEV mode: clicking a group header toggles expand / collapse", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-toggle" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-toggle")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const firstHeader = content.querySelector<HTMLButtonElement>(".mix-tree-group-header")!;
      const firstItems = content.querySelector<HTMLElement>(".mix-tree-items")!;

      const beforeHidden = firstItems.hidden;
      firstHeader.click(); // collapse — tree is re-rendered; re-query
      const afterCollapseHidden = content.querySelector<HTMLElement>(".mix-tree-items")!.hidden;
      content.querySelector<HTMLButtonElement>(".mix-tree-group-header")!.click(); // expand again
      const afterExpandHidden = content.querySelector<HTMLElement>(".mix-tree-items")!.hidden;

      return { beforeHidden, afterCollapseHidden, afterExpandHidden };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.beforeHidden).toBe(false);
    expect(result.afterCollapseHidden).toBe(true);
    expect(result.afterExpandHidden).toBe(false);
  });

  test("DEV mode: single click shows metadata and double click calls onSelectFile", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const libraryWithMeta = structuredClone(library);
      libraryWithMeta[0].mixes[0].meta = { bpm: 140, trackCount: 12, catalogs: ["Dance eJay 1"] };

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-select" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const selectedRefs: Array<{ label: string; group: string; source: unknown }> = [];

      const sidebar = host.querySelector<HTMLElement>("#at-select")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: libraryWithMeta,
        onSelectFile: (ref: { label: string; group: string; source: unknown }) => { selectedRefs.push(ref); },
      });

      sidebar.click(); // load tree

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const firstFile = content.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      firstFile.click();
      const refCountAfterSingleClick = selectedRefs.length;
      const popupVisibleAfterSingleClick = isMixMetaPopupVisible();
      firstFile.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      const active = content.querySelector(".mix-tree-item.is-active");
      return {
        refCountAfterSingleClick,
        popupVisibleAfterSingleClick,
        refCount: selectedRefs.length,
        label: selectedRefs[0]?.label,
        group: selectedRefs[0]?.group,
        sourceType: (selectedRefs[0]?.source as { type: string })?.type,
        activeLabel: active?.querySelector(".mix-tree-item-label")?.textContent,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.refCountAfterSingleClick).toBe(0);
    expect(result.popupVisibleAfterSingleClick).toBe(true);
    expect(result.refCount).toBe(1);
    expect(result.label).toBe("START.MIX");
    expect(result.group).toBe("Dance eJay 1");
    expect(result.sourceType).toBe("url");
    expect(result.activeLabel).toBe("START.MIX");
  });

  test("DEV mode: second click on loaded sidebar is a no-op", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-noop" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-noop")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();
      const groupsAfterFirst = sidebar.querySelectorAll(".mix-tree-group").length;
      sidebar.click();
      const groupsAfterSecond = sidebar.querySelectorAll(".mix-tree-group").length;

      return { groupsAfterFirst, groupsAfterSecond };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groupsAfterFirst).toBe(2);
    expect(result.groupsAfterSecond).toBe(2); // unchanged
  });

  test("DEV mode: keyboard Enter on placeholder triggers tree load", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(2);
  });

  test("DEV mode: keyboard Space on placeholder triggers tree load", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd-space" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd-space")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(2);
  });

  test("DEV mode: other keyboard keys on placeholder are ignored", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd-other" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd-other")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
        stillAwaiting: sidebar.querySelector(".archive-tree-content")?.classList.contains("is-awaiting-click"),
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(0);
    expect(result.stillAwaiting).toBe(true);
  });

  test("DEV mode: empty mixLibrary renders no-files empty state", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-empty" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-empty")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: [], onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      return {
        emptyText: content.querySelector(".archive-placeholder")?.textContent,
        groups: content.querySelectorAll(".mix-tree-group").length,
      };
    }, MFB_MOD);

    expect(result.emptyText).toBe("No .mix files found");
    expect(result.groups).toBe(0);
  });

  test("DEV mode: group item count badge shows correct number", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-badge" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-badge")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const badges = [...content.querySelectorAll(".mix-tree-count")].map((el) => el.textContent);
      return badges;
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result).toEqual(["2", "1"]);
  });

  test("DEV mode: folder label hover tooltip shows full folder name", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "custom_user_group",
        name: "USER: SORTED - DANCE AND HOUSE FULL NAME",
        mixes: [{ filename: "LONGNAME.MIX", sizeBytes: 10, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-folder-tooltip" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-folder-tooltip")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const folderLabel = sidebar.querySelector<HTMLElement>(".mix-tree-group-label")!;
      return {
        folderName: folderLabel.textContent,
        tooltip: folderLabel.title,
      };
    }, MFB_MOD);

    expect(result.folderName).toBe("USER: SORTED - DANCE AND HOUSE FULL NAME");
    expect(result.tooltip).toBe("USER: SORTED - DANCE AND HOUSE FULL NAME");
  });

  test("initMixFileBrowser is a no-op when archive-tree-content is missing", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);
      const sidebar = document.createElement("aside");
      sidebar.className = "archive-sidebar";
      // Note: no .archive-tree-content child
      document.body.appendChild(sidebar);

      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: [], onSelectFile: () => {} });
      sidebar.click();
      return { groups: sidebar.querySelectorAll(".mix-tree-group").length };
    }, MFB_MOD);

    expect(result.groups).toBe(0);
  });

  test("DEV mode: URL source encodes product ID and filename", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "my mix.MIX", sizeBytes: 100, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-encode" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ source: { type: string; url?: string } }> = [];
      const sidebar = host.querySelector<HTMLElement>("#at-encode")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: lib,
        onSelectFile: (ref: unknown) => { refs.push(ref as typeof refs[0]); },
      });

      sidebar.click();
      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      return refs[0]?.source;
    }, MFB_MOD);

    expect(result?.type).toBe("url");
    expect(result?.url).toBe("/mix/Dance_eJay1/my%20mix.MIX");
  });

  test("DEV mode: controller setProductMode renders flat product list and preserves selection behavior", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-controller-mode" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ label: string; productId: string }> = [];
      const sidebar = host.querySelector<HTMLElement>("#at-controller-mode")!;
      const controller = initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: (ref: { label: string; productId: string }) => refs.push(ref),
      });

      sidebar.click();
      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;

      const beforeMode = controller.getProductMode().id;
      controller.setProductMode("dance1");
      const afterMode = controller.getProductMode().id;

      const flatRoot = content.querySelector(".mix-tree-root--flat") !== null;
      const labels = [...content.querySelectorAll<HTMLElement>(".mix-tree-item-label")].map((el) => el.textContent ?? "");

      const firstFlatItem = content.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      firstFlatItem.click();
      const activeAfterClick = content.querySelector<HTMLElement>(".mix-tree-item.is-active .mix-tree-item-label")?.textContent ?? "";
      firstFlatItem.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      controller.setProductMode("all");
      const restoredGroupCount = content.querySelectorAll(".mix-tree-group").length;

      return {
        beforeMode,
        afterMode,
        flatRoot,
        labels,
        activeAfterClick,
        selected: refs[0],
        restoredGroupCount,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.beforeMode).toBe("all");
    expect(result.afterMode).toBe("dance1");
    expect(result.flatRoot).toBe(true);
    expect(result.labels).toEqual(["LOVE.MIX", "START.MIX"]);
    expect(result.activeAfterClick).toBe("LOVE.MIX");
    expect(result.selected).toMatchObject({
      label: "LOVE.MIX",
      productId: "Dance_eJay1",
    });
    expect(result.restoredGroupCount).toBe(2);
  });

  test("DEV mode: product-mode dropdown change emits callback and empty flat-state message", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-mode-change" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const changedModeIds: string[] = [];
      const sidebar = host.querySelector<HTMLElement>("#at-mode-change")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: () => {},
        onProductModeChange: (entry: { id: string }) => changedModeIds.push(entry.id),
      });

      sidebar.click();
      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const select = sidebar.querySelector<HTMLSelectElement>(".product-mode-select")!;
      select.value = "house";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      return {
        changedModeIds,
        flatCount: content.querySelectorAll(".mix-tree-root--flat").length,
        emptyText: content.querySelector<HTMLElement>(".archive-placeholder")?.textContent ?? "",
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.changedModeIds).toEqual(["house"]);
    expect(result.flatCount).toBe(0);
    expect(result.emptyText).toBe("No .mix files found for House");
  });

  test("DEV mode: flat product list keeps source group mapping for Dance 3 multi-group mode", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-dance3-mode" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ label: string; group: string; productId: string }> = [];
      const sidebar = host.querySelector<HTMLElement>("#at-dance3-mode")!;
      const controller = initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: [
          {
            id: "Dance_eJay3",
            name: "Dance eJay 3",
            mixes: [{ filename: "D3-ONLY.MIX", sizeBytes: 100, format: "C" }],
          },
          {
            id: "Dance_SuperPack",
            name: "Dance SuperPack",
            mixes: [{ filename: "SP-ONLY.MIX", sizeBytes: 100, format: "C" }],
          },
        ],
        onSelectFile: (ref: { label: string; group: string; productId: string }) => refs.push(ref),
      });

      sidebar.click();
      controller.setProductMode("dance3");

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const d3 = [...content.querySelectorAll<HTMLButtonElement>(".mix-tree-item")]
        .find((btn) => btn.textContent?.includes("D3-ONLY.MIX"));
      const sp = [...content.querySelectorAll<HTMLButtonElement>(".mix-tree-item")]
        .find((btn) => btn.textContent?.includes("SP-ONLY.MIX"));

      d3?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      sp?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      return refs;
    }, MFB_MOD);

    expect(result).toMatchObject([
      {
        label: "D3-ONLY.MIX",
        group: "Dance eJay 3",
        productId: "Dance_eJay3",
      },
      {
        label: "SP-ONLY.MIX",
        group: "Dance SuperPack",
        productId: "Dance_SuperPack",
      },
    ]);
  });

  // ── formatMetaTooltip ──────────────────────────────────────────────────────

  test("formatMetaTooltip: returns empty string when meta is undefined", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip(undefined);
    }, MFB_MOD);
    expect(result).toBe("");
  });

  test("formatMetaTooltip: returns tooltip with BPM and track count", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({ bpm: 140, trackCount: 20, catalogs: [] });
    }, MFB_MOD);
    expect(result).toContain("BPM: 140");
    expect(result).toContain("20 tracks");
  });

});


