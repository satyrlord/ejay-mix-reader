// DOM rendering functions for the normalized Sound Browser SPA.

import type { CategoryEntry, Sample } from "./data.js";
import { sampleCategory, sampleDisplayName } from "./data.js";
import type { Library } from "./library.js";
import type { Player } from "./player.js";

export const BPM_VALUES = [90, 125, 140, 160] as const;

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

export interface SpaShellSlots {
  shell: HTMLElement;
  sidebar: HTMLElement;
  tabs: HTMLElement;
  grid: HTMLElement;
  bpm: HTMLSelectElement;
  transport: HTMLElement;
  archiveTree: HTMLElement;
  sequencer: HTMLElement;
  contextStrip: HTMLElement;
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

  wrapper.innerHTML = `
    <div class="home-card">
      <div class="home-logo" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <h1 class="home-title"><span>eJay</span> Sound Browser</h1>
      <p class="home-copy">Browse, search, and preview extracted audio samples from your eJay library.</p>
      <div class="home-actions"></div>
      <footer class="home-footer">
        <a href="https://github.com/satyrlord/ejay-mix-reader" target="_blank" rel="noopener noreferrer">
          satyrlord/ejay-mix-reader
        </a>
      </footer>
    </div>
    <div class="home-bpm-corner">
      <span>BPM filter</span>
      <select id="home-bpm" aria-label="BPM filter">
        ${BPM_VALUES.map((value) => `<option value="${value}"${value === 140 ? " selected" : ""}>${value}</option>`).join("")}
      </select>
    </div>
  `;

  const actions = wrapper.querySelector(".home-actions");
  if (!actions) {
    container.appendChild(wrapper);
    return;
  }

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

  const bpmWrap = document.createElement("label");
  bpmWrap.className = "spa-bpm";
  bpmWrap.innerHTML = `
    <span class="spa-bpm-label">BPM</span>
    <select id="bpm-filter" aria-label="BPM filter">
      ${BPM_VALUES.map((value) => `<option value="${value}"${value === 140 ? " selected" : ""}>${value}</option>`).join("")}
    </select>
  `;
  const bpm = bpmWrap.querySelector("select") as HTMLSelectElement;

  contextControls.append(tabs, bpmWrap);
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

  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-btn";
    button.dataset.categoryId = category.id;
    button.textContent = category.name;
    if (activeId === category.id) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", () => onSelect(category));
    grid.appendChild(button);
  }

  const loadJsonBtn = document.createElement("button");
  loadJsonBtn.type = "button";
  loadJsonBtn.className = "load-json-btn";
  loadJsonBtn.textContent = "Load JSON";
  if (onLoadJson) {
    loadJsonBtn.addEventListener("click", onLoadJson);
  }
  grid.appendChild(loadJsonBtn);

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

      const label = document.createElement("span");
      label.className = "sample-block-label";
      label.textContent = sampleDisplayName(sample);
      block.appendChild(label);

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

function buildLanes(samples: Sample[]): Sample[][] {
  const lanes: Sample[][] = [];
  let currentLane: Sample[] = [];
  let currentSpan = 0;

  for (const sample of samples) {
    const span = blockSpanFromBeats(sample.beats);
    if (currentLane.length > 0 && currentSpan + span > 12) {
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

function blockSpanFromBeats(beats: number | undefined): number {
  if (typeof beats !== "number" || !Number.isFinite(beats) || beats <= 0) return 2;
  if (beats >= 32) return 6;
  if (beats >= 16) return 4;
  if (beats >= 8) return 3;
  if (beats >= 4) return 2;
  return 1;
}

function categoryColor(category: string): string {
  const token = category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `var(--channel-${token || "unknown"}, #4a90d9)`;
}

function showErrorToast(message: string): void {
  const existing = document.getElementById("error-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "error-toast";
  toast.className = "error-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

const APP_VERSION = "v1.14";
const BUILD_LABEL = import.meta.env.DEV
  ? "eJay mix reader \u2014 full version"
  : "eJay mix reader demo \u2014 clone this repo for full functionality";

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
      <span class="transport-build-label">${BUILD_LABEL}</span>
    </div>
    <div class="transport-right">
      <span class="transport-version">${APP_VERSION}</span>
      <a class="transport-github" href="https://github.com/satyrlord/ejay-mix-reader" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">GitHub</a>
    </div>
  `;
  container.appendChild(bar);
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

