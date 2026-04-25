// DOM rendering functions for the normalized Sound Browser SPA.

import type { CategoryEntry, Sample } from "./data.js";
import {
  gridSortKeyLabel,
  sampleCategory,
  sampleDisambiguationLine,
  sampleDisplayKey,
  sampleDisplayName,
  sampleMetadataLine,
  UNSORTED_CATEGORY_ID,
  UNSORTED_SUBCATEGORY_ID,
} from "./data.js";
import type { GridSortDir, GridSortKey } from "./data.js";
import type { Library } from "./library.js";
import type { Player } from "./player.js";

export const BPM_VALUES = [90, 125, 135, 140, 160, 180] as const;

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
const SVG_NS = "http://www.w3.org/2000/svg" as const;

let cleanupInlineSubcategoryAdd: (() => void) | null = null;

function createSubcategoryAddIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add("subcategory-add-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  const verticalStroke = document.createElementNS(SVG_NS, "path");
  verticalStroke.setAttribute("d", "M8 3.25v9.5");
  verticalStroke.setAttribute("stroke", "currentColor");
  verticalStroke.setAttribute("stroke-width", "2");
  verticalStroke.setAttribute("stroke-linecap", "round");

  const horizontalStroke = document.createElementNS(SVG_NS, "path");
  horizontalStroke.setAttribute("d", "M3.25 8h9.5");
  horizontalStroke.setAttribute("stroke", "currentColor");
  horizontalStroke.setAttribute("stroke-width", "2");
  horizontalStroke.setAttribute("stroke-linecap", "round");

  icon.append(verticalStroke, horizontalStroke);
  return icon;
}

function createSubcategoryConfirmIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add("subcategory-confirm-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  const checkStroke = document.createElementNS(SVG_NS, "path");
  checkStroke.setAttribute("d", "M3.5 8.25 6.5 11.25 12.5 4.75");
  checkStroke.setAttribute("stroke", "currentColor");
  checkStroke.setAttribute("stroke-width", "2");
  checkStroke.setAttribute("stroke-linecap", "round");
  checkStroke.setAttribute("stroke-linejoin", "round");

  icon.append(checkStroke);
  return icon;
}

function hasSubcategoryDraftValue(value: string): boolean {
  return value.trim().length > 0;
}

function createBpmSelect(selectId: string, ariaLabel: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.id = selectId;
  select.setAttribute("aria-label", ariaLabel);

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All";
  select.appendChild(allOption);

  for (const value of BPM_VALUES) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }

  return select;
}

function createSidebarButton(options: {
  className: string;
  label: string;
  isActive?: boolean;
  categoryId?: string;
  sidebarRole?: string;
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
  if (options.isActive) {
    button.classList.add("is-active");
  }
  if (options.onClick) {
    button.addEventListener("click", options.onClick);
  }

  return button;
}

export interface SpaShellSlots {
  shell: HTMLElement;
  sidebar: HTMLElement;
  tabs: HTMLElement;
  grid: HTMLElement;
  searchInput: HTMLInputElement;
  searchClear: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  bpm: HTMLSelectElement;
  transport: HTMLElement;
  archiveTree: HTMLElement;
  sequencer: HTMLElement;
  contextStrip: HTMLElement;
}

function createZoomIcon(kind: "in" | "out"): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add("spa-zoom-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  const lens = document.createElementNS(SVG_NS, "circle");
  lens.setAttribute("cx", "6.75");
  lens.setAttribute("cy", "6.75");
  lens.setAttribute("r", "3.75");
  lens.setAttribute("stroke", "currentColor");
  lens.setAttribute("stroke-width", "1.5");

  const handle = document.createElementNS(SVG_NS, "path");
  handle.setAttribute("d", "M9.5 9.5 13 13");
  handle.setAttribute("stroke", "currentColor");
  handle.setAttribute("stroke-width", "1.5");
  handle.setAttribute("stroke-linecap", "round");

  const horizontal = document.createElementNS(SVG_NS, "path");
  horizontal.setAttribute("d", "M5 6.75h3.5");
  horizontal.setAttribute("stroke", "currentColor");
  horizontal.setAttribute("stroke-width", "1.5");
  horizontal.setAttribute("stroke-linecap", "round");

  icon.append(lens, handle, horizontal);

  if (kind === "in") {
    const vertical = document.createElementNS(SVG_NS, "path");
    vertical.setAttribute("d", "M6.75 5v3.5");
    vertical.setAttribute("stroke", "currentColor");
    vertical.setAttribute("stroke-width", "1.5");
    vertical.setAttribute("stroke-linecap", "round");
    icon.append(vertical);
  }

  return icon;
}

export function renderHomePage(
  container: HTMLElement,
  onPickFolder: () => void,
  onUseDev: (() => void) | null,
): void {
  container.replaceChildren();

  const wrapper = document.createElement("div");
  wrapper.id = "home-page";
  wrapper.className = "home-page";

  const card = document.createElement("div");
  card.className = "home-card";

  const logo = document.createElement("div");
  logo.className = "home-logo";
  logo.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 6; index++) {
    logo.appendChild(document.createElement("span"));
  }

  const title = document.createElement("h1");
  title.className = "home-title";
  const titleBrand = document.createElement("span");
  titleBrand.textContent = "eJay";
  title.append(titleBrand, document.createTextNode(" Sound Browser"));

  const copy = document.createElement("p");
  copy.className = "home-copy";
  copy.textContent = "Browse, search, and preview extracted audio samples from your eJay library.";

  const actions = document.createElement("div");
  actions.className = "home-actions";

  const footer = document.createElement("footer");
  footer.className = "home-footer";
  const repoLink = document.createElement("a");
  repoLink.href = "https://github.com/satyrlord/ejay-mix-reader";
  repoLink.target = "_blank";
  repoLink.rel = "noopener noreferrer";
  repoLink.textContent = "satyrlord/ejay-mix-reader";
  footer.appendChild(repoLink);

  card.append(logo, title, copy, actions, footer);

  const bpmCorner = document.createElement("div");
  bpmCorner.className = "home-bpm-corner";
  const bpmLabel = document.createElement("span");
  bpmLabel.textContent = "BPM filter";
  bpmCorner.append(bpmLabel, createBpmSelect("home-bpm", "BPM filter"));

  wrapper.append(card, bpmCorner);

  const pickBtn = document.createElement("button");
  pickBtn.id = "pick-folder-btn";
  pickBtn.className = "home-primary-btn";
  pickBtn.type = "button";
  pickBtn.textContent = "Choose output folder";
  pickBtn.addEventListener("click", onPickFolder);
  actions.appendChild(pickBtn);

  if (onUseDev) {
    const devBtn = document.createElement("button");
    devBtn.id = "dev-library-btn";
    devBtn.className = "home-dev-btn";
    devBtn.type = "button";
    devBtn.textContent = "Use development library";
    devBtn.addEventListener("click", onUseDev);
    actions.appendChild(devBtn);
  }

  container.appendChild(wrapper);
}

export function renderSpaShell(container: HTMLElement): SpaShellSlots {
  container.replaceChildren();

  const shell = document.createElement("div");
  shell.id = "spa-shell";
  shell.className = "spa-shell";

  // ── Editor area (top): archive tree + sequencer ──────────

  const editorArea = document.createElement("div");
  editorArea.className = "editor-area";

  const archiveTree = document.createElement("aside");
  archiveTree.id = "archive-tree";
  archiveTree.className = "archive-sidebar";
  archiveTree.setAttribute("role", "navigation");
  archiveTree.setAttribute("aria-label", "Mix archive");
  renderArchivePlaceholder(archiveTree);

  const sequencer = document.createElement("div");
  sequencer.id = "sequencer";
  sequencer.className = "sequencer-area";
  renderSequencerPlaceholder(sequencer);

  editorArea.append(archiveTree, sequencer);

  // ── Context strip (middle) ───────────────────────────────

  const contextStrip = document.createElement("div");
  contextStrip.id = "context-strip";
  contextStrip.className = "context-strip";

  const contextStatus = document.createElement("div");
  contextStatus.className = "context-status";
  renderContextStripContent(contextStatus);

  const contextControls = document.createElement("div");
  contextControls.className = "context-browser-controls";

  const tabs = document.createElement("div");
  tabs.id = "subcategory-tabs";
  tabs.className = "subcategory-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Subcategories");

  const searchWrap = document.createElement("div");
  searchWrap.className = "spa-search";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.id = "sample-search";
  searchInput.className = "spa-search-input";
  searchInput.placeholder = "Search\u2026";
  searchInput.setAttribute("aria-label", "Search samples in category");
  searchInput.autocomplete = "off";

  const searchClear = document.createElement("button");
  searchClear.type = "button";
  searchClear.id = "sample-search-clear";
  searchClear.className = "spa-search-clear is-hidden";
  searchClear.setAttribute("aria-label", "Clear search");
  searchClear.title = "Clear search";

  const clearIcon = document.createElementNS(SVG_NS, "svg");
  clearIcon.setAttribute("viewBox", "0 0 16 16");
  clearIcon.setAttribute("fill", "none");
  clearIcon.setAttribute("aria-hidden", "true");
  clearIcon.setAttribute("focusable", "false");
  clearIcon.style.cssText = "width:0.8rem;height:0.8rem;flex:0 0 auto;pointer-events:none;";
  const clearLine1 = document.createElementNS(SVG_NS, "path");
  clearLine1.setAttribute("d", "M4 4 L12 12");
  clearLine1.setAttribute("stroke", "currentColor");
  clearLine1.setAttribute("stroke-width", "2");
  clearLine1.setAttribute("stroke-linecap", "round");
  const clearLine2 = document.createElementNS(SVG_NS, "path");
  clearLine2.setAttribute("d", "M12 4 L4 12");
  clearLine2.setAttribute("stroke", "currentColor");
  clearLine2.setAttribute("stroke-width", "2");
  clearLine2.setAttribute("stroke-linecap", "round");
  clearIcon.append(clearLine1, clearLine2);
  searchClear.appendChild(clearIcon);

  searchWrap.append(searchInput, searchClear);

  const zoomWrap = document.createElement("div");
  zoomWrap.className = "spa-zoom-controls";
  zoomWrap.setAttribute("aria-label", "Sample zoom controls");

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.id = "sample-zoom-out";
  zoomOut.className = "spa-zoom-btn";
  zoomOut.setAttribute("aria-label", "Zoom out sample bubbles");
  zoomOut.title = "Zoom out sample bubbles";
  zoomOut.appendChild(createZoomIcon("out"));

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.id = "sample-zoom-in";
  zoomIn.className = "spa-zoom-btn";
  zoomIn.setAttribute("aria-label", "Zoom in sample bubbles");
  zoomIn.title = "Zoom in sample bubbles";
  zoomIn.appendChild(createZoomIcon("in"));

  zoomWrap.append(zoomOut, zoomIn);

  const bpmWrap = document.createElement("label");
  bpmWrap.className = "spa-bpm";
  const bpmLabel = document.createElement("span");
  bpmLabel.className = "spa-bpm-label";
  bpmLabel.textContent = "BPM";
  const bpm = createBpmSelect("bpm-filter", "BPM filter");
  bpmWrap.append(bpmLabel, bpm);

  contextControls.append(tabs, searchWrap, zoomWrap, bpmWrap);
  contextStrip.append(contextStatus, contextControls);

  // ── Browser area (bottom): category sidebar + sample grid ─

  const browserArea = document.createElement("div");
  browserArea.className = "browser-area";

  const sidebar = document.createElement("aside");
  sidebar.id = "category-sidebar";
  sidebar.className = "category-sidebar";
  sidebar.setAttribute("role", "navigation");
  sidebar.setAttribute("aria-label", "Categories");

  const main = document.createElement("section");
  main.className = "spa-main";

  const grid = document.createElement("div");
  grid.id = "sample-grid";
  grid.className = "sample-grid";
  grid.setAttribute("role", "grid");

  main.append(grid);
  browserArea.append(sidebar, main);
  shell.append(editorArea, contextStrip, browserArea);

  const transportHost = document.createElement("div");
  transportHost.id = "transport-host";
  container.append(shell, transportHost);
  renderTransportBar(transportHost);

  return {
    shell,
    sidebar,
    tabs,
    grid,
    searchInput,
    searchClear,
    zoomOut,
    zoomIn,
    bpm,
    transport: transportHost.querySelector("#transport") as HTMLElement,
    archiveTree,
    sequencer,
    contextStrip,
  };
}

function renderArchivePlaceholder(container: HTMLElement): void {
  const header = document.createElement("div");
  header.className = "archive-header";
  header.innerHTML = `<span class="archive-title">Mix Archive</span>`;

  const content = document.createElement("div");
  content.className = "archive-tree-content";
  content.innerHTML = `<p class="archive-placeholder">Load a .mix file to begin</p>`;

  container.append(header, content);
}

function renderSequencerPlaceholder(container: HTMLElement): void {
  const scrollArea = document.createElement("div");
  scrollArea.className = "sequencer-scroll";

  const header = document.createElement("div");
  header.className = "sequencer-header";
  for (let beat = 1; beat <= 32; beat++) {
    const cell = document.createElement("span");
    cell.className = "sequencer-beat-number";
    cell.textContent = String(beat);
    header.appendChild(cell);
  }

  const canvas = document.createElement("div");
  canvas.className = "sequencer-canvas";
  canvas.innerHTML = `<p class="sequencer-placeholder">Select a mix file to view its timeline</p>`;

  scrollArea.append(header, canvas);

  const controls = document.createElement("div");
  controls.className = "sequencer-controls";
  controls.innerHTML = `
    <button type="button" class="seq-play-btn" aria-label="Play mix" disabled>&#9654;</button>
    <button type="button" class="seq-stop-btn" aria-label="Stop mix" disabled>&#9632;</button>
    <span class="seq-position">0:00 / 0:00</span>
  `;

  container.append(scrollArea, controls);
}

function renderContextStripContent(container: HTMLElement): void {
  container.innerHTML = `
    <span class="context-mix-name">No mix loaded</span>
    <span class="context-separator"></span>
    <span class="context-bpm-display">&mdash; BPM</span>
  `;
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
      isActive: activeId === category.id,
      onClick: () => onSelect(category),
    }));
  }

  grid.appendChild(createSidebarButton({
    className: "category-system-btn",
    label: unsortedCategory.name,
    categoryId: unsortedCategory.id,
    sidebarRole: "system-feature",
    isActive: activeId === unsortedCategory.id,
    onClick: () => onSelect(unsortedCategory),
  }));

  grid.appendChild(createSidebarButton({
    className: "category-system-btn load-json-btn",
    label: "Load JSON",
    sidebarRole: "system-feature",
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
      addOptions.onCancel?.();
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || form.contains(event.target)) return;
      addOptions.onCancel?.();
    };

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    cleanupInlineSubcategoryAdd = () => {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
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

export function renderSampleGrid(
  container: HTMLElement,
  samples: Sample[],
  player: Player,
  library: Library,
): void {
  container.classList.add("sample-grid");
  container.setAttribute("role", "grid");
  container.replaceChildren();

  if (samples.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sample-grid-empty";
    empty.textContent = "No samples in this selection.";
    container.appendChild(empty);
    return;
  }

  const duplicatePresentations = buildDuplicatePresentations(samples);

  for (const lane of buildLanes(samples)) {
    const laneEl = document.createElement("div");
    laneEl.className = "sample-lane";

    for (const sample of lane) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "sample-block";
      block.dataset.filename = sample.filename;
      block.style.setProperty("--block-color", categoryColor(sampleCategory(sample)));
      block.style.setProperty("--block-span", String(blockSpanFromBeats(sample.beats)));

      const presentation = duplicatePresentations.get(sample) ?? defaultDuplicatePresentation(sample);
      const visibleMeta = buildVisibleMeta(sample, presentation);

      const label = document.createElement("span");
      label.className = "sample-block-label";
      label.textContent = presentation.visibleName;
      block.appendChild(label);

      if (visibleMeta) {
        const metaEl = document.createElement("span");
        metaEl.className = "sample-block-meta";
        metaEl.textContent = visibleMeta;
        block.appendChild(metaEl);
      }

      block.title = buildBlockTitle(sample, presentation);

      block.addEventListener("click", () => {
        library.resolveAudioUrl(sample)
          .then((url) => {
            block.dataset.path = url;
            player.toggle(url);
          })
          .catch((error: unknown) => {
            console.error("Failed to resolve audio URL:", error);
            showErrorToast("Could not play this sample - audio file not found.");
          });
      });

      laneEl.appendChild(block);
    }

    container.appendChild(laneEl);
  }
}

interface DuplicatePresentation {
  visibleName: string;
  includesDetail: boolean;
  includesProduct: boolean;
  includesInternalName: boolean;
  includesSampleId: boolean;
}

interface DuplicatePresentationState {
  sample: Sample;
  tokens: string[];
  includesDetail: boolean;
  includesProduct: boolean;
  includesInternalName: boolean;
  includesSampleId: boolean;
}

function trimLabelToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function productLabel(product: unknown): string {
  return trimLabelToken(product).replace(/_/g, " ");
}

function sampleIdLabel(sampleId: unknown): string {
  return typeof sampleId === "number" && Number.isFinite(sampleId) ? `#${sampleId}` : "";
}

function composeVisibleName(baseName: string, tokens: readonly string[]): string {
  return tokens.length > 0 ? `${baseName} - ${tokens.join(" - ")}` : baseName;
}

function defaultDuplicatePresentation(sample: Sample): DuplicatePresentation {
  return {
    visibleName: sampleDisplayName(sample),
    includesDetail: false,
    includesProduct: false,
    includesInternalName: false,
    includesSampleId: false,
  };
}

function arePresentationLabelsUnique(states: readonly DuplicatePresentationState[]): boolean {
  const seen = new Set<string>();

  for (const state of states) {
    const label = composeVisibleName(sampleDisplayName(state.sample), state.tokens).toLowerCase();
    if (seen.has(label)) {
      return false;
    }
    seen.add(label);
  }

  return true;
}

function stageAddsUsefulVariance(values: readonly string[]): boolean {
  const nonEmptyValues = values.filter((value) => value.length > 0);
  const distinct = new Set(nonEmptyValues);
  return distinct.size > 1 || (distinct.size === 1 && nonEmptyValues.length < values.length);
}

function buildDuplicatePresentations(samples: readonly Sample[]): Map<Sample, DuplicatePresentation> {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const displayKey = sampleDisplayKey(sample);
    const group = groups.get(displayKey) ?? [];
    group.push(sample);
    groups.set(displayKey, group);
  }

  const presentations = new Map<Sample, DuplicatePresentation>();

  for (const group of groups.values()) {
    if (group.length <= 1) {
      const [sample] = group;
      if (sample) {
        presentations.set(sample, defaultDuplicatePresentation(sample));
      }
      continue;
    }

    const states: DuplicatePresentationState[] = group.map((sample) => ({
      sample,
      tokens: [],
      includesDetail: false,
      includesProduct: false,
      includesInternalName: false,
      includesSampleId: false,
    }));

    const stages: Array<{
      values: (state: DuplicatePresentationState) => string;
      apply: (state: DuplicatePresentationState, value: string) => void;
    }> = [
      {
        values: (state) => trimLabelToken(state.sample.detail),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesDetail = true;
        },
      },
      {
        values: (state) => productLabel(state.sample.product),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesProduct = true;
        },
      },
      {
        values: (state) => trimLabelToken(state.sample.internal_name),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesInternalName = true;
        },
      },
      {
        values: (state) => sampleIdLabel(state.sample.sample_id),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesSampleId = true;
        },
      },
      {
        values: (state) => trimLabelToken(state.sample.source),
        apply: (state, value) => {
          state.tokens.push(value);
        },
      },
      {
        values: (state) => state.sample.filename.replace(/^.*[\\/]/, "").replace(/\.wav$/i, ""),
        apply: (state, value) => {
          state.tokens.push(value);
        },
      },
    ];

    for (const stage of stages) {
      if (arePresentationLabelsUnique(states)) {
        break;
      }

      const values = states.map((state) => stage.values(state));
      if (!stageAddsUsefulVariance(values)) {
        continue;
      }

      for (let index = 0; index < states.length; index += 1) {
        const value = values[index];
        if (!value) {
          continue;
        }
        stage.apply(states[index], value);
      }
    }

    for (const state of states) {
      presentations.set(state.sample, {
        visibleName: composeVisibleName(sampleDisplayName(state.sample), state.tokens),
        includesDetail: state.includesDetail,
        includesProduct: state.includesProduct,
        includesInternalName: state.includesInternalName,
        includesSampleId: state.includesSampleId,
      });
    }
  }

  return presentations;
}

function buildVisibleMeta(sample: Sample, presentation: DuplicatePresentation): string {
  const meta = sampleMetadataLine({
    product: presentation.includesProduct ? "" : sample.product,
    bpm: sample.bpm,
    beats: sample.beats,
    detail: presentation.includesDetail ? "" : sample.detail,
  });
  const disambiguation = sampleDisambiguationLine({
    internal_name: presentation.includesInternalName ? "" : sample.internal_name,
    sample_id: presentation.includesSampleId ? undefined : sample.sample_id,
  });
  return [meta, disambiguation].filter((part) => part.length > 0).join(" \u00B7 ");
}

function buildBlockTitle(sample: Sample, presentation: DuplicatePresentation): string {
  const lines = [presentation.visibleName];
  const meta = buildVisibleMeta(sample, presentation);
  if (meta) {
    lines.push(meta);
  }

  const source = trimLabelToken(sample.source);
  if (source) {
    lines.push(`Source: ${source}`);
  }

  return lines.join("\n");
}

/** Maximum number of CSS grid columns per sample lane (matches the 24-column layout). */
const MAX_LANE_SPAN = 24;

function buildLanes(samples: Sample[]): Sample[][] {
  const lanes: Sample[][] = [];
  let currentLane: Sample[] = [];
  let currentSpan = 0;

  for (const sample of samples) {
    const span = blockSpanFromBeats(sample.beats);
    if (currentLane.length > 0 && currentSpan + span > MAX_LANE_SPAN) {
      lanes.push(currentLane);
      currentLane = [];
      currentSpan = 0;
    }

    currentLane.push(sample);
    currentSpan += span;
  }

  if (currentLane.length > 0) {
    lanes.push(currentLane);
  }

  return lanes;
}

/**
 * Map a sample's beat count to a CSS grid column span within a MAX_LANE_SPAN (24) column grid.
 *
 * Thresholds follow the native eJay beat sizes (4, 8, 16, 32) and the span
 * values are proportional powers-of-2 so that relative durations are visually
 * apparent at a glance:
 *   invalid / ≤4  beats →  1 column   (shortest, single block)
 *          ≤8  beats →  2 columns
 *          ≤16 beats →  4 columns
 *          ≤32 beats →  8 columns
 *         >32  beats → 12 columns  (half the lane, longest loops)
 */
function blockSpanFromBeats(beats: number | undefined): number {
  if (typeof beats !== "number" || !Number.isFinite(beats) || beats <= 0) return 1;
  if (beats <= 4) return 1;
  if (beats <= 8) return 2;
  if (beats <= 16) return 4;
  if (beats <= 32) return 8;
  return 12;
}

function categoryColor(category: string): string {
  const token = category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `var(--channel-${token || "unknown"}, #4a90d9)`;
}

export function showErrorToast(message: string): void {
  const existing = document.getElementById("error-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "error-toast";
  toast.className = "error-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "v0.0.0";
const BUILD_LABEL = import.meta.env.DEV
  ? "eJay mix reader \u2014 full version"
  : "eJay mix reader demo \u2014 clone this repo for full functionality";

const GLOBAL_UI_1000MS_EFFECT_CSS_VAR = "--ui-deliberate-1000ms-effect-duration";

// 1000 ms is deliberate UX pacing so these fades read as intentional, not as layout or rendering bugs.
export const GLOBAL_UI_1000MS_EFFECT_MS = 1000;
export const TRANSPORT_BUILD_LABEL_REVEAL_DELAY_MS = GLOBAL_UI_1000MS_EFFECT_MS;

function applyGlobalUiTimingConstants(): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    GLOBAL_UI_1000MS_EFFECT_CSS_VAR,
    `${GLOBAL_UI_1000MS_EFFECT_MS}ms`,
  );
}

applyGlobalUiTimingConstants();

const transportBuildLabelAudioSources = new Set<string>();
let transportBuildLabelRevealTimeoutId: number | null = null;

function getTransportBuildLabel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".transport-build-label");
}

function clearTransportBuildLabelRevealTimeout(): void {
  if (transportBuildLabelRevealTimeoutId === null) return;
  window.clearTimeout(transportBuildLabelRevealTimeoutId);
  transportBuildLabelRevealTimeoutId = null;
}

function getTransportBuildLabelSoundState(): "idle" | "playing" | "cooldown" {
  if (transportBuildLabelAudioSources.size > 0) return "playing";
  if (transportBuildLabelRevealTimeoutId !== null) return "cooldown";
  return "idle";
}

function syncTransportBuildLabelVisibility(): void {
  const label = getTransportBuildLabel();
  if (!label) return;

  const soundState = getTransportBuildLabelSoundState();
  label.dataset.soundState = soundState;
  label.classList.toggle("is-hidden", soundState !== "idle");
}

export function setTransportBuildLabelAudioPlaying(sourceId: string, isPlaying: boolean): void {
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return;

  if (isPlaying) {
    clearTransportBuildLabelRevealTimeout();
    transportBuildLabelAudioSources.add(normalizedSourceId);
    syncTransportBuildLabelVisibility();
    return;
  }

  const hadActiveSource = transportBuildLabelAudioSources.delete(normalizedSourceId);
  if (transportBuildLabelAudioSources.size > 0) {
    syncTransportBuildLabelVisibility();
    return;
  }
  if (!hadActiveSource) {
    syncTransportBuildLabelVisibility();
    return;
  }

  clearTransportBuildLabelRevealTimeout();
  transportBuildLabelRevealTimeoutId = window.setTimeout(() => {
    transportBuildLabelRevealTimeoutId = null;
    syncTransportBuildLabelVisibility();
  }, TRANSPORT_BUILD_LABEL_REVEAL_DELAY_MS);
  syncTransportBuildLabelVisibility();
}

export function renderTransportBar(container: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  bar.id = "transport";
  bar.className = "transport-bar";
  bar.innerHTML = `
    <div class="transport-left">
      <button id="transport-stop" class="transport-stop" type="button" aria-label="Stop">
        <span></span>
      </button>
      <span id="transport-name" class="transport-name is-idle">No sample playing</span>
      <progress id="transport-progress" class="transport-progress" value="0" max="100"></progress>
    </div>
    <div class="transport-center">
      <span class="transport-build-label"></span>
    </div>
    <div class="transport-right">
      <span class="transport-version"></span>
      <a class="transport-github" href="https://github.com/satyrlord/ejay-mix-reader" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">GitHub</a>
    </div>
  `;
  bar.querySelector<HTMLElement>(".transport-build-label")!.textContent = BUILD_LABEL;
  bar.querySelector<HTMLElement>(".transport-version")!.textContent = APP_VERSION;
  container.appendChild(bar);
  syncTransportBuildLabelVisibility();
  return bar;
}

export function updateTransport(activePath: string | null, player: Player): void {
  const nameEl = document.getElementById("transport-name");
  const progressEl = document.getElementById("transport-progress") as HTMLProgressElement | null;
  if (!nameEl || !progressEl) return;

  if (activePath) {
    const parts = activePath.split("/");
    nameEl.textContent = decodeURIComponent(parts[parts.length - 1]).replace(/\.wav$/i, "");
    nameEl.classList.remove("is-idle");
    const pct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
    progressEl.value = pct;
  } else {
    nameEl.textContent = "No sample playing";
    nameEl.classList.add("is-idle");
    progressEl.value = 0;
  }
}

export function updatePlayingBlock(activePath: string | null): void {
  for (const block of document.querySelectorAll<HTMLElement>(".sample-block")) {
    block.classList.toggle("is-playing", block.dataset.path === activePath);
  }
}

/**
 * Builds a cascading "Move to" context menu for a sample block right-click.
 * Categories appear as top-level items, each expanding to a subcategory submenu on hover.
 *
 * @param categories - Full category list (Unsorted excluded — it is appended last).
 * @param currentCategory - The sample's current category id (used to mark the current position).
 * @param currentSubcategory - The sample's current subcategory (used to mark the current position).
 * @param onMoveTo - Called with (categoryId, subcategoryId | null) when a destination is clicked.
 * @param flipSubmenu - When true, submenus open to the left instead of the right.
 */
export function buildSampleMoveMenu(
  categories: CategoryEntry[],
  currentCategory: string,
  currentSubcategory: string | null,
  onMoveTo: (categoryId: string, subcategoryId: string | null) => void,
  flipSubmenu: boolean,
): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  if (flipSubmenu) menu.classList.add("ctx-menu--flip");
  menu.setAttribute("role", "menu");

  const header = document.createElement("div");
  header.className = "ctx-menu-header";
  header.textContent = "Move to";
  menu.appendChild(header);

  for (const category of categories) {
    if (category.sampleCount === 0 && category.id !== UNSORTED_CATEGORY_ID) continue;

    const isCurrent = category.id === currentCategory;

    const item = document.createElement("div");
    item.className = "ctx-menu-item has-submenu";
    if (isCurrent) item.classList.add("is-current-category");
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-haspopup", "true");
    item.tabIndex = 0;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = category.name;
    const arrowSpan = document.createElement("span");
    arrowSpan.className = "ctx-menu-arrow";
    arrowSpan.setAttribute("aria-hidden", "true");
    arrowSpan.textContent = "›";
    item.append(labelSpan, arrowSpan);

    const submenu = document.createElement("div");
    submenu.className = "ctx-submenu";
    submenu.setAttribute("role", "menu");

    const subcategories = category.subcategories.length > 0
      ? category.subcategories
      : [UNSORTED_SUBCATEGORY_ID];

    for (const sub of subcategories) {
      const isCurrentSub = isCurrent && (sub === currentSubcategory || (sub === UNSORTED_SUBCATEGORY_ID && !currentSubcategory));
      const storedSub = sub === UNSORTED_SUBCATEGORY_ID ? null : sub;

      const subBtn = document.createElement("button");
      subBtn.type = "button";
      subBtn.className = "ctx-menu-item";
      if (isCurrentSub) subBtn.classList.add("is-current");
      subBtn.setAttribute("role", "menuitem");
      subBtn.tabIndex = -1;
      subBtn.textContent = sub;
      subBtn.addEventListener("click", () => onMoveTo(category.id, storedSub));
      submenu.appendChild(subBtn);
    }

    item.appendChild(submenu);
    menu.appendChild(item);

    item.addEventListener("mouseenter", () => {
      for (const sibling of menu.querySelectorAll<HTMLElement>(".ctx-menu-item.has-submenu")) {
        sibling.classList.remove("is-open");
      }
      item.classList.add("is-open");
    });
  }

  menu.addEventListener("mouseleave", () => {
    for (const sibling of menu.querySelectorAll<HTMLElement>(".ctx-menu-item.has-submenu")) {
      sibling.classList.remove("is-open");
    }
  });

  return menu;
}

/**
 * Builds a flat "Sort by" context menu for an empty-grid-space right-click.
 * The active sort key is highlighted; clicking an active key flips the direction.
 *
 * @param sortKeys - Sort keys available for the current sample set.
 * @param currentKey - The currently active sort key.
 * @param currentDir - The currently active sort direction.
 * @param onSort - Called with (key, dir) when an item is clicked.
 */
export function buildGridSortMenu(
  sortKeys: GridSortKey[],
  currentKey: GridSortKey,
  currentDir: GridSortDir,
  onSort: (key: GridSortKey, dir: GridSortDir) => void,
): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");

  const header = document.createElement("div");
  header.className = "ctx-menu-header";
  header.textContent = "Sort by";
  menu.appendChild(header);

  for (const key of sortKeys) {
    const isActive = key === currentKey;
    const nextDir: GridSortDir = isActive && currentDir === "asc" ? "desc" : "asc";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-menu-item";
    if (isActive) btn.classList.add("is-active");
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = 0;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = gridSortKeyLabel(key);

    const dirSpan = document.createElement("span");
    dirSpan.className = "ctx-menu-sort-dir";
    dirSpan.setAttribute("aria-hidden", "true");
    if (isActive) {
      dirSpan.textContent = currentDir === "asc" ? "↑" : "↓";
    }

    btn.append(labelSpan, dirSpan);
    btn.addEventListener("click", () => onSort(key, nextDir));
    menu.appendChild(btn);
  }

  return menu;
}

