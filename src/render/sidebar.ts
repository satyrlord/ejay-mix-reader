// Category sidebar and subcategory tab rendering.

import type { CategoryEntry } from "../data.js";
import { UNSORTED_CATEGORY_ID, UNSORTED_SUBCATEGORY_ID } from "../data.js";
import { createSubcategoryAddIcon, createSubcategoryConfirmIcon } from "./icons.js";

export interface UiTab {
  id: string;
  label: string;
  kind?: string;
  removable?: boolean;
}

export interface SubcategoryAddOptions {
  onAdd?: () => void;
  addDisabled?: boolean;
  addTitle?: string;
  isEditing?: boolean;
  draftValue?: string;
  draftPlaceholder?: string;
  onDraftChange?: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
}

const INLINE_SUBCATEGORY_ADD_ROOT_ID = "subcategory-add-inline";
const INLINE_SUBCATEGORY_ADD_INPUT_ID = "subcategory-add-input";
const INLINE_SUBCATEGORY_ADD_CONFIRM_ID = "subcategory-add-confirm";

let cleanupInlineSubcategoryAdd: (() => void) | null = null;

function hasSubcategoryDraftValue(value: string): boolean {
  return value.trim().length > 0;
}

function normalizeCategoryToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "unsorted";
}

function categoryColorVar(categoryId: string): string {
  const token = normalizeCategoryToken(categoryId);
  return `var(--category-color-${token}, var(--category-color-unsorted, var(--category-palette-13)))`;
}

function createSidebarButton(options: {
  className: string;
  label: string;
  isActive?: boolean;
  categoryId?: string;
  sidebarRole?: string;
  colorVar?: string;
  onClick?: () => void;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.className;
  button.textContent = options.label;

  if (options.categoryId) {
    button.dataset.categoryId = options.categoryId;
  }
  if (options.sidebarRole) {
    button.dataset.sidebarRole = options.sidebarRole;
  }
  if (options.colorVar) {
    button.style.setProperty("--category-chip-color", options.colorVar);
  }
  if (options.isActive) {
    button.classList.add("is-active");
  }
  if (options.onClick) {
    button.addEventListener("click", options.onClick);
  }

  return button;
}

export function renderCategorySidebar(
  container: HTMLElement,
  categories: CategoryEntry[],
  activeId: string | null,
  onSelect: (category: CategoryEntry) => void,
  onLoadJson?: () => void,
): void {
  container.replaceChildren();

  const grid = document.createElement("div");
  grid.className = "category-grid";

  const unsortedCategory = categories.find((category) => category.id === UNSORTED_CATEGORY_ID) ?? {
    id: UNSORTED_CATEGORY_ID,
    name: UNSORTED_CATEGORY_ID,
    subcategories: [UNSORTED_SUBCATEGORY_ID],
    sampleCount: 0,
  };

  for (const category of categories) {
    if (category.id === UNSORTED_CATEGORY_ID) continue;

    grid.appendChild(createSidebarButton({
      className: "category-btn",
      label: category.name,
      categoryId: category.id,
      colorVar: categoryColorVar(category.id),
      isActive: activeId === category.id,
      onClick: () => onSelect(category),
    }));
  }

  grid.appendChild(createSidebarButton({
    className: "category-system-btn",
    label: unsortedCategory.name,
    categoryId: unsortedCategory.id,
    sidebarRole: "system-feature",
    colorVar: categoryColorVar(unsortedCategory.id),
    isActive: activeId === unsortedCategory.id,
    onClick: () => onSelect(unsortedCategory),
  }));

  grid.appendChild(createSidebarButton({
    className: "category-system-btn load-json-btn",
    label: "Load JSON",
    sidebarRole: "system-feature",
    colorVar: "var(--category-color-system-load, var(--category-palette-14))",
    onClick: onLoadJson,
  }));

  container.appendChild(grid);
}

export function renderSubcategoryTabs(
  container: HTMLElement,
  tabs: UiTab[],
  activeId: string | null,
  onSelect: (tabId: string) => void,
  addOptions: SubcategoryAddOptions = {},
): void {
  cleanupInlineSubcategoryAdd?.();
  cleanupInlineSubcategoryAdd = null;
  container.replaceChildren();

  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `subcategory-tab${tab.id === activeId ? " is-active" : ""}`;
    button.dataset.tabId = tab.id;
    if (tab.kind) {
      button.dataset.tabKind = tab.kind;
    }
    if (typeof tab.removable === "boolean") {
      button.dataset.tabRemovable = String(tab.removable);
    }
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", tab.id === activeId ? "true" : "false");
    button.textContent = tab.label;
    button.addEventListener("click", () => onSelect(tab.id));
    container.appendChild(button);
  }

  if (addOptions.isEditing) {
    const form = document.createElement("form");
    form.id = INLINE_SUBCATEGORY_ADD_ROOT_ID;
    form.className = "subcategory-add-inline";

    const input = document.createElement("input");
    input.id = INLINE_SUBCATEGORY_ADD_INPUT_ID;
    input.className = "subcategory-add-input";
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = addOptions.draftPlaceholder ?? "untitled";
    input.value = addOptions.draftValue ?? "";
    input.setAttribute("aria-label", "New subcategory name");

    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.id = INLINE_SUBCATEGORY_ADD_CONFIRM_ID;
    confirmButton.className = "subcategory-add subcategory-add-confirm";
    confirmButton.setAttribute("aria-label", "Create subcategory");
    confirmButton.title = addOptions.addTitle ?? "Create subcategory";
    confirmButton.disabled = !hasSubcategoryDraftValue(input.value);
    confirmButton.appendChild(createSubcategoryConfirmIcon());

    form.append(input, confirmButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (confirmButton.disabled) return;
      addOptions.onSubmit?.();
    });
    input.addEventListener("input", () => {
      confirmButton.disabled = !hasSubcategoryDraftValue(input.value);
      addOptions.onDraftChange?.(input.value);
    });

    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelOnce();
    };

    let didCancel = false;
    const cancelOnce = (): void => {
      if (didCancel) return;
      didCancel = true;
      addOptions.onCancel?.();
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || form.contains(event.target)) return;
      cancelOnce();
    };

    const handleClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || form.contains(event.target)) return;
      cancelOnce();
    };

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    cleanupInlineSubcategoryAdd = () => {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };

    container.appendChild(form);
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return;
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.id = "subcategory-add";
  addButton.className = "subcategory-add";
  addButton.setAttribute("aria-label", "Add subcategory");
  addButton.title = addOptions.addTitle ?? "Add subcategory";
  addButton.disabled = addOptions.addDisabled ?? false;
  if (addOptions.onAdd && !addButton.disabled) {
    addButton.addEventListener("click", addOptions.onAdd);
  }
  addButton.appendChild(createSubcategoryAddIcon());
  container.appendChild(addButton);
}
