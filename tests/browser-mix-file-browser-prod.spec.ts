import { test, expect } from "./baseFixtures.js";

test.describe("mix-file-browser module", () => {
  const MFB_MOD = "/src/mix-file-browser.ts";

  test("DEV mode: mix file with no meta does not show popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "NO_META.MIX", sizeBytes: 10, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-no-meta" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-no-meta")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();

      return isMixMetaPopupVisible();
    }, MFB_MOD);

    expect(result).toBe(false);
  });

  test("DEV mode: .mix-tree-item tooltip uses metadata when present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{
          filename: "T.MIX", sizeBytes: 10, format: "A" as const,
          meta: { bpm: 99, trackCount: 7, catalogs: [] },
        }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-tooltip" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-tooltip")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      return item.title;
    }, MFB_MOD);

    expect(result).toContain("BPM: 99");
    expect(result).toContain("7 tracks");
  });

  test("DEV mode: .mix-tree-item tooltip falls back to filename when no meta", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "FALLBACK.MIX", sizeBytes: 10, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-tooltip-fb" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-tooltip-fb")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      return item.title;
    }, MFB_MOD);

    expect(result).toBe("FALLBACK.MIX");
  });

  test("DEV mode: clicking a group header dismisses popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "A.MIX", sizeBytes: 10, format: "A" as const,
          meta: { bpm: 130, trackCount: 5, catalogs: [] } }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-header-dismiss" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-header-dismiss")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();
      const visibleAfterFileClick = isMixMetaPopupVisible();

      const headerBtn = sidebar.querySelector<HTMLButtonElement>(".mix-tree-group-header")!;
      headerBtn.click(); // collapse the group — should dismiss popup
      const visibleAfterHeaderClick = isMixMetaPopupVisible();

      return { visibleAfterFileClick, visibleAfterHeaderClick };
    }, MFB_MOD);

    expect(result.visibleAfterFileClick).toBe(true);
    expect(result.visibleAfterHeaderClick).toBe(false);
  });

  test("PROD mode: archive-root picker groups product and userdata mixes and parses metadata", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (
            sidebar.querySelector(".mix-tree-group-label") ||
            sidebar.querySelector(".archive-tree-empty")
          ) {
            return;
          }
          await flush();
        }
      };

      const makeFileHandle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        async getFile() {
          return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
        },
      });

      const makeDirHandle = (name: string, children: Record<string, unknown>) => ({
        kind: "directory",
        name,
        async *entries() {
          for (const [childName, handle] of Object.entries(children)) {
            yield [childName, handle];
          }
        },
      });

      const archiveRoot = makeDirHandle("archive", {
        Dance_eJay1: makeDirHandle("Dance_eJay1", {
          MIX: makeDirHandle("MIX", {
            "START.MIX": makeFileHandle("START.MIX", [0x06, 0x0a, 0x00, 0x00]),
          }),
        }),
        _userdata: makeDirHandle("_userdata", {
          sets: makeDirHandle("sets", {
            "USER.MIX": makeFileHandle("USER.MIX", [0x07, 0x0a, 0x00, 0x00]),
          }),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => archiveRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ label: string; group: string; source: { type: string } }> = [];
      const sidebar = host.querySelector<HTMLElement>("#archive-tree")!;
      initMixFileBrowser(sidebar, {
        isDev: false,
        onSelectFile: (ref: unknown) => {
          refs.push(ref as typeof refs[number]);
        },
      });

      sidebar.click();
      await waitForTree(sidebar);

      const groupLabels = [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? "");
      const firstItem = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      const firstTooltip = firstItem.title;
      firstItem.click();
      firstItem.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      return {
        groupLabels,
        firstTooltip,
        popupTextAfterSingleClick: document.getElementById("mix-meta-popup")?.textContent ?? "",
        selected: refs[0],
      };
    }, MFB_MOD);

    expect(result.groupLabels).toEqual(["Dance eJay 1", "User: sets"]);
    expect(result.firstTooltip).toContain("BPM: 140");
    expect(result.firstTooltip).toContain("0 tracks");
    expect(result.selected).toMatchObject({
      label: "START.MIX",
      group: "Dance eJay 1",
      source: { type: "handle" },
    });
  });

  test("PROD mode: selecting a product folder keeps the product group instead of collapsing to MIX", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (
            sidebar.querySelector(".mix-tree-group-label") ||
            sidebar.querySelector(".archive-tree-empty")
          ) {
            return;
          }
          await flush();
        }
      };

      const makeFileHandle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        async getFile() {
          return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
        },
      });

      const makeDirHandle = (name: string, children: Record<string, unknown>) => ({
        kind: "directory",
        name,
        async *entries() {
          for (const [childName, handle] of Object.entries(children)) {
            yield [childName, handle];
          }
        },
      });

      const productRoot = makeDirHandle("Dance_eJay1", {
        MIX: makeDirHandle("MIX", {
          "START.MIX": makeFileHandle("START.MIX", [0x06, 0x0a, 0x00, 0x00]),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => productRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree")!;
      initMixFileBrowser(sidebar, {
        isDev: false,
        onSelectFile: () => {},
      });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        productSelectClass: sidebar.querySelector<HTMLElement>("select.product-mode-select")?.className ?? "",
      };
    }, MFB_MOD);

    expect(result.groupLabels).toEqual(["Dance eJay 1"]);
    expect(result.productSelectClass).toBe("product-mode-select");
  });
});


