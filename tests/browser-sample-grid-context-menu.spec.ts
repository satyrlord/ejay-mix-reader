import { test, expect } from "./baseFixtures.js";
import { openHomeAndWaitForNetworkIdle } from "./playwright-test-helpers.js";

test.describe("sample-grid-context-menu module", () => {
  const SGCM_MOD = "/src/sample-grid-context-menu.ts";

  test("controller handles edge branches without opening or dismissing the wrong menu", async ({ page }) => {
    await openHomeAndWaitForNetworkIdle(page);
    const result = await page.evaluate(async (modPath) => {
      const { createSampleGridContextMenuController, SAMPLE_CONTEXT_MENU_ID } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const dispatchContextMenu = (
        controller: { handleContextMenu: (event: MouseEvent) => void },
        target: HTMLElement,
        init: MouseEventInit,
      ): void => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          ...init,
        });
        target.dispatchEvent(event);
        controller.handleContextMenu(event);
      };

      const grid = document.createElement("div");
      grid.className = "sample-grid";
      document.body.appendChild(grid);

      const outside = document.createElement("div");
      document.body.appendChild(outside);

      const ghostBlock = document.createElement("button");
      ghostBlock.className = "sample-block";
      ghostBlock.dataset.filename = "ghost.wav";
      grid.appendChild(ghostBlock);

      const realBlock = document.createElement("button");
      realBlock.className = "sample-block";
      realBlock.dataset.filename = "real.wav";
      grid.appendChild(realBlock);

      let refreshCalls = 0;
      const sortCalls: Array<[string, string]> = [];
      const moveCalls: Array<{ categoryId: string; subcategoryId: string | null }> = [];

      const controller = createSampleGridContextMenuController({
        getCategories: () => [{ id: "Bass", name: "Bass", sampleCount: 1, subcategories: [] }],
        getCurrentGridSamples: () => [{ filename: "real.wav" }],
        getSortState: () => ({ key: "name", dir: "asc" }),
        setSortState: (key: string, dir: string) => {
          sortCalls.push([key, dir]);
        },
        refreshSamples: () => {
          refreshCalls += 1;
        },
        onMoveSample: (_sample: { filename: string }, categoryId: string, subcategoryId: string | null) => {
          moveCalls.push({ categoryId, subcategoryId });
        },
      });

      controller.close();

      dispatchContextMenu(controller, outside, {
        clientX: 10,
        clientY: 10,
      });
      const openedOutsideGrid = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      dispatchContextMenu(controller, ghostBlock, {
        clientX: 12,
        clientY: 12,
      });
      const openedForMissingSample = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      dispatchContextMenu(controller, grid, {
        clientX: 20,
        clientY: 20,
      });
      await flush();

      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.querySelector("#sample-context-menu .ctx-menu-item")?.dispatchEvent(new PointerCtor("pointerdown", {
        bubbles: true,
      }));
      const stayedOpenAfterInsidePointer = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
      const stayedOpenAfterNonEscapeKey = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      window.dispatchEvent(new Event("resize"));
      const closedAfterResize = !document.getElementById(SAMPLE_CONTEXT_MENU_ID);

      dispatchContextMenu(controller, realBlock, {
        clientX: window.innerWidth - 12,
        clientY: 28,
      });
      await flush();

      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      dispatchContextMenu(controller, grid, {
        clientX: 24,
        clientY: 24,
      });
      await flush();
      (document.querySelector("#sample-context-menu button.ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      return {
        openedOutsideGrid,
        openedForMissingSample,
        stayedOpenAfterInsidePointer,
        stayedOpenAfterNonEscapeKey,
        closedAfterResize,
        moveCalls,
        sortCalls,
        refreshCalls,
      };
    }, SGCM_MOD);

    expect(result.openedOutsideGrid).toBe(false);
    expect(result.openedForMissingSample).toBe(false);
    expect(result.stayedOpenAfterInsidePointer).toBe(true);
    expect(result.stayedOpenAfterNonEscapeKey).toBe(true);
    expect(result.closedAfterResize).toBe(true);
    expect(result.moveCalls).toEqual([{ categoryId: "Bass", subcategoryId: null }]);
    expect(result.sortCalls).toEqual([["name", "desc"]]);
    expect(result.refreshCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mix-file-browser module tests
// ─────────────────────────────────────────────────────────────────────────────



