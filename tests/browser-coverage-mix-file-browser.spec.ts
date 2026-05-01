import { test, expect } from "./baseFixtures.js";
import { openCoverageHarnessAndWaitForNetworkIdle } from "./playwright-test-helpers.js";

test.describe("browser coverage gap", () => {
  const MIX_FILE_BROWSER_MOD = "/src/mix-file-browser.ts";

  test("mix-file-browser covers GenerationPack and userdata label branches", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (sidebar.querySelector(".mix-tree-group-label") || sidebar.querySelector(".archive-tree-empty")) {
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
        Dance_SuperPack: makeDirHandle("Dance_SuperPack", {
          MIX: makeDirHandle("MIX", {
            "start.mix": makeFileHandle("start.mix", [0x06, 0x0a, 0x00, 0x00]),
          }),
        }),
        GenerationPack1: makeDirHandle("GenerationPack1", {
          Dance: makeDirHandle("Dance", {
            MIX: makeDirHandle("MIX", {
              "gp1.mix": makeFileHandle("gp1.mix", [0x06, 0x0a, 0x00, 0x00]),
            }),
          }),
        }),
        _userdata: makeDirHandle("_userdata", {
          _DMKIT2: makeDirHandle("_DMKIT2", {
            "user.mix": makeFileHandle("user.mix", [0x07, 0x0a, 0x00, 0x00]),
          }),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => archiveRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-coverage" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-coverage")!;
      initMixFileBrowser(sidebar, { isDev: false, onSelectFile: () => {} });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        secondGroupHidden: sidebar.querySelectorAll<HTMLElement>(".mix-tree-items")[1]?.hidden ?? null,
      };
    }, MIX_FILE_BROWSER_MOD);

    expect(result.groupLabels).toEqual([
      "Dance SuperPack",
      "GenerationPack1 Dance",
      "User: DMKIT2",
    ]);
    expect(result.secondGroupHidden).toBe(true);
  });

  test("mix-file-browser covers unprefixed root grouping and repeated group accumulation", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (sidebar.querySelector(".mix-tree-group-label") || sidebar.querySelector(".archive-tree-empty")) {
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

      const customRoot = makeDirHandle("custom-root", {
        alpha: makeDirHandle("alpha", {
          "one.mix": makeFileHandle("one.mix", [0x06, 0x0a, 0x00, 0x00]),
          "two.mix": makeFileHandle("two.mix", [0x07, 0x0a, 0x00, 0x00]),
        }),
        beta: makeDirHandle("beta", {
          "three.mix": makeFileHandle("three.mix", [0x08, 0x0a, 0x00, 0x00]),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => customRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-custom" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-custom")!;
      initMixFileBrowser(sidebar, { isDev: false, onSelectFile: () => {} });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        counts: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-count")].map((node) => node.textContent ?? ""),
      };
    }, MIX_FILE_BROWSER_MOD);

    expect(result.groupLabels).toEqual(["alpha", "beta"]);
    expect(result.counts).toEqual(["2", "1"]);
  });
});

