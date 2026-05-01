// Home page and SPA shell rendering.

import {
  SVG_NS,
  createSequencerHomeIcon,
  createSequencerPlayIcon,
  createSequencerStopIcon,
  createZoomIcon,
} from "./icons.js";
import { renderTransportBar } from "./transport.js";

export const BPM_VALUES = [90, 96, 125, 140, 160, 180] as const;

export interface SpaShellSlots {
  shell: HTMLElement;
  splitter: HTMLElement;
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

export function createBpmSelect(selectId: string, ariaLabel: string): HTMLSelectElement {
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
    <button type="button" class="seq-home-btn" aria-label="Move playhead to start" title="Move playhead to start"></button>
    <button type="button" class="seq-play-btn" aria-label="Play mix" title="Play mix" disabled></button>
    <button type="button" class="seq-stop-btn" aria-label="Stop mix" disabled></button>
    <span class="seq-position">0:00 / 0:00</span>
  `;

  const homeBtn = controls.querySelector<HTMLButtonElement>(".seq-home-btn");
  homeBtn?.appendChild(createSequencerHomeIcon());
  const playBtn = controls.querySelector<HTMLButtonElement>(".seq-play-btn");
  playBtn?.appendChild(createSequencerPlayIcon());
  const stopBtn = controls.querySelector<HTMLButtonElement>(".seq-stop-btn");
  stopBtn?.appendChild(createSequencerStopIcon());

  container.append(scrollArea, controls);
}

function renderContextStripContent(container: HTMLElement): void {
  container.innerHTML = `
    <span class="context-mix-name">No mix loaded</span>
    <span class="context-separator"></span>
    <span class="context-bpm-display">&mdash; BPM</span>
  `;
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

  const splitter = document.createElement("div");
  splitter.id = "shell-splitter";
  splitter.className = "shell-splitter";
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "horizontal");
  splitter.setAttribute("aria-label", "Resize sequencer and sample browser");
  splitter.setAttribute("aria-valuemin", "0");
  splitter.setAttribute("aria-valuemax", "100");
  splitter.setAttribute("aria-valuenow", "58");
  splitter.tabIndex = 0;

  // ── Context strip (middle) ───────────────────────────────

  const contextStrip = document.createElement("div");
  contextStrip.id = "context-strip";
  contextStrip.className = "context-strip";

  const contextStatus = document.createElement("div");
  contextStatus.className = "context-status";
  renderContextStripContent(contextStatus);

  const contextStripSeparator = document.createElement("span");
  contextStripSeparator.className = "context-separator";
  contextStripSeparator.setAttribute("aria-hidden", "true");

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
  contextStrip.append(contextStatus, contextStripSeparator, contextControls);

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

  const transportHost = document.createElement("div");
  transportHost.id = "transport-host";
  shell.append(editorArea, splitter, contextStrip, browserArea);
  container.append(shell, transportHost);
  renderTransportBar(transportHost);

  return {
    shell,
    splitter,
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
