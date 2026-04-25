import type { CategoryEntry, Sample } from "./data.js";
import { activeSortKeys } from "./data.js";
import type { GridSortDir, GridSortKey } from "./data.js";
import { buildGridSortMenu, buildSampleMoveMenu } from "./render.js";

const noop = (): void => {};

export const SAMPLE_CONTEXT_MENU_ID = "sample-context-menu";

export interface SampleGridContextMenuController {
  close(): void;
  handleContextMenu(event: MouseEvent): void;
}

export interface CreateSampleGridContextMenuOptions {
  getCategories: () => CategoryEntry[];
  getCurrentGridSamples: () => Sample[];
  getSortState: () => { key: GridSortKey; dir: GridSortDir };
  setSortState: (key: GridSortKey, dir: GridSortDir) => void;
  refreshSamples: () => void;
  onMoveSample: (sample: Sample, newCategory: string, newSubcategory: string | null) => void;
  closeOtherMenus?: () => void;
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
}

function attachMenuDismiss(menu: HTMLElement, closeMenu: () => void): () => void {
  const handlePointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || menu.contains(event.target)) return;
    closeMenu();
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeMenu();
  };
  const handleResize = (): void => {
    closeMenu();
  };

  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleResize);

  return () => {
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", handleResize);
  };
}

export function createSampleGridContextMenuController(
  options: CreateSampleGridContextMenuOptions,
): SampleGridContextMenuController {
  let cleanup = noop;

  function close(): void {
    document.getElementById(SAMPLE_CONTEXT_MENU_ID)?.remove();
    const currentCleanup = cleanup;
    cleanup = noop;
    currentCleanup();
  }

  function openMenu(
    menu: HTMLElement,
    clientX: number,
    clientY: number,
    focusSelector: string,
  ): void {
    options.closeOtherMenus?.();
    close();

    menu.id = SAMPLE_CONTEXT_MENU_ID;
    menu.style.position = "fixed";
    document.body.appendChild(menu);

    cleanup = attachMenuDismiss(menu, close);

    window.requestAnimationFrame(() => {
      positionMenu(menu, clientX, clientY);
      menu.querySelector<HTMLElement>(focusSelector)?.focus();
    });
  }

  function openSampleMoveMenu(sample: Sample, clientX: number, clientY: number): void {
    const flipSubmenu = clientX > window.innerWidth * 0.6;
    const menu = buildSampleMoveMenu(
      options.getCategories(),
      sample.category ?? "",
      typeof sample.subcategory === "string" ? sample.subcategory : null,
      (categoryId, subcategoryId) => {
        options.onMoveSample(sample, categoryId, subcategoryId);
      },
      flipSubmenu,
    );

    openMenu(menu, clientX, clientY, ".ctx-menu-item");
  }

  function openGridSortMenu(clientX: number, clientY: number): void {
    const { key, dir } = options.getSortState();
    const menu = buildGridSortMenu(
      activeSortKeys(options.getCurrentGridSamples()),
      key,
      dir,
      (nextKey, nextDir) => {
        options.setSortState(nextKey, nextDir);
        close();
        options.refreshSamples();
      },
    );

    openMenu(menu, clientX, clientY, "button.ctx-menu-item");
  }

  function handleContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const block = target.closest<HTMLElement>(".sample-block");
    if (block) {
      event.preventDefault();
      const filename = block.dataset.filename;
      const sample = options.getCurrentGridSamples().find((entry) => entry.filename === filename);
      if (sample) openSampleMoveMenu(sample, event.clientX, event.clientY);
      return;
    }

    if (target.closest(".sample-grid")) {
      event.preventDefault();
      openGridSortMenu(event.clientX, event.clientY);
    }
  }

  return {
    close,
    handleContextMenu,
  };
}