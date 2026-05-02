/**
 * mix-file-browser.ts — In-app .mix file browser for the archive-tree panel.
 *
 * The tree is built from the pre-generated `mixLibrary` entries in
 * `data/index.json`.
 */

import type { MixFileEntry, MixFileMeta, MixLibraryEntry } from "./data.js";
import { mixFormatLabel } from "./data.js";
import { parseMixBrowser } from "./mix-parser.js";
import { LANE_COUNT_BY_FORMAT, maxRecoveredBeat } from "./mix-player.js";
import {
  createProductModeSelect,
  getProductModeEntry,
  isAllEntry,
  PRODUCT_MODE_ALL_ID,
  type ProductModeEntry,
} from "./product-mode.js";

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Reference to a selected .mix file — carries everything the caller needs to
 *  load it regardless of whether it came from the dev server, FSA, or a plain
 *  `<input>` element. */
export interface MixFileRef {
  /** Display filename without any directory prefix. */
  label: string;
  /** The product name / folder group this file belongs to. */
  group: string;
  /** Canonical group id used by `/mix/` URLs and mix parsing hints. */
  productId: string;
  /** How to obtain the raw file bytes. */
  source: MixFileSource;
}

export type MixFileSource = { type: "url"; url: string };

export interface MixFileBrowserOptions {
  /** Pre-built mix library from `data/index.json`. */
  mixLibrary?: MixLibraryEntry[];
  /** Called when the user double-clicks a .mix file in the tree. */
  onSelectFile: (ref: MixFileRef) => void;
  /** Called when the product-mode dropdown changes. */
  onProductModeChange?: (entry: ProductModeEntry) => void;
}

/** Handle returned by {@link initMixFileBrowser} so callers can drive the
 *  product-mode filter from outside the browser pane. */
export interface MixFileBrowserController {
  setProductMode(id: string): void;
  getProductMode(): ProductModeEntry;
}

/* -------------------------------------------------------------------------- */
/* Internal types                                                             */
/* -------------------------------------------------------------------------- */

interface TreeGroup {
  id: string;
  label: string;
  files: TreeFile[];
}

interface TreeFile {
  key: string;
  label: string;
  source: MixFileSource;
  meta?: MixFileMeta;
}

interface FlatTreeFile extends TreeFile {
  groupId: string;
  groupLabel: string;
}

interface BrowserState {
  activeKey: string | null;
  expandedIds: Set<string>;
}

/* -------------------------------------------------------------------------- */
/* SVG helpers                                                                */
/* -------------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function makePath(d: string, extra?: Record<string, string>): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.3");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  /* istanbul ignore next -- extra attributes are not used in current call sites */
  if (extra) {
    for (const [k, v] of Object.entries(extra)) path.setAttribute(k, v);
  }
  return path;
}

function makeSvg(...paths: SVGPathElement[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "mix-tree-icon");
  for (const path of paths) svg.appendChild(path);
  return svg;
}

function folderIcon(open: boolean): SVGSVGElement {
  const body = open
    ? makePath("M2 6.5h12l-1.5 6.5H3.5L2 6.5z")
    : makePath("M2 5v8h12V7H8.5L7.5 5H2z");
  const tab = makePath("M2 6.5l1.5-2H7l1 1.5h6");
  return makeSvg(open ? body : body, ...(open ? [tab] : []));
}

function fileIcon(): SVGSVGElement {
  return makeSvg(
    makePath("M4 2h6l3 3v9H4V2z"),
    makePath("M10 2v3h3"),
  );
}

export function mixMetaFromIr(ir: ReturnType<typeof parseMixBrowser>): MixFileMeta | undefined {
  if (!ir) return undefined;

  const meta: MixFileMeta = {
    format: ir.format,
    appId: ir.appId,
    bpm: ir.bpm,
    trackCount: ir.tracks.length,
    catalogs: ir.catalogs.map((catalog) => catalog.name),
  };

  if (ir.bpmAdjusted !== null && ir.bpmAdjusted !== ir.bpm) {
    meta.bpmAdjusted = ir.bpmAdjusted;
  }
  if (ir.title) meta.title = ir.title;
  if (ir.author) meta.author = ir.author;
  if (ir.tickerText.length > 0) meta.tickerText = ir.tickerText;

  // Diagnostics surfaced by the metadata popup (milestone-3 plan §4.6):
  // canonical lane count for the generation and whether the parser recovered
  // any timeline positions.
  meta.laneCount = LANE_COUNT_BY_FORMAT[ir.format];
  const maxBeat = maxRecoveredBeat(ir.tracks);
  meta.timelineRecovered = maxBeat !== null;
  if (maxBeat !== null) meta.maxBeat = maxBeat;

  return meta;
}

/* -------------------------------------------------------------------------- */
/* Metadata helpers                                                          */
/* -------------------------------------------------------------------------- */

const HIPHOP1_GEN1_APP_ID = 0x00000a08;
const HIPHOP1_GEN1_DEFAULT_BPM = 96;

function effectiveMetaBpm(meta: MixFileMeta): number {
  if (meta.appId === HIPHOP1_GEN1_APP_ID && (meta.format === "A" || meta.format === undefined)) {
    return HIPHOP1_GEN1_DEFAULT_BPM;
  }
  return meta.bpm;
}

/**
 * Build a short tooltip string from `MixFileMeta` suitable for the
 * native `title` attribute.
 */
export function formatMetaTooltip(meta: MixFileMeta | undefined): string {
  if (!meta) return "";
  const bpm = effectiveMetaBpm(meta);
  const parts: string[] = [`BPM: ${bpm}`];
  if (meta.bpmAdjusted && meta.bpmAdjusted !== bpm) {
    parts.push(`(${meta.bpmAdjusted} adjusted)`);
  }
  parts.push(`${meta.trackCount} tracks`);
  if (meta.title) parts.push(`"${meta.title}"`);
  if (meta.author) parts.push(`by ${meta.author}`);
  return parts.join(" · ");
}

/**
 * Build the HTML rows for the metadata popup panel.
 */
export function buildMetaRows(
  filename: string,
  group: string,
  meta: MixFileMeta | undefined,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["File", filename],
    ["Product", group],
  ];
  if (meta) {
    if (typeof meta.appId === "number") {
      rows.push(["App ID", `0x${meta.appId.toString(16).padStart(8, "0")}`]);
    }
    rows.push(["Format", meta.format ? mixFormatLabel(meta.format) : "—"]);
    const bpm = effectiveMetaBpm(meta);
    const bpmStr =
      meta.bpmAdjusted && meta.bpmAdjusted !== bpm
        ? `${bpm} (adjusted: ${meta.bpmAdjusted})`
        : String(bpm);
    rows.push(["BPM", bpmStr]);
    rows.push(["Tracks", String(meta.trackCount)]);
    if (typeof meta.laneCount === "number") {
      rows.push(["Lanes", String(meta.laneCount)]);
    }
    if (typeof meta.timelineRecovered === "boolean") {
      const status = meta.timelineRecovered
        ? (typeof meta.maxBeat === "number"
            ? `recovered (${meta.maxBeat + 1} beats)`
            : "recovered")
        : "list view (timeline unrecovered)";
      rows.push(["Timeline", status]);
    }
    if (meta.title) rows.push(["Title", meta.title]);
    if (meta.author) rows.push(["Author", meta.author]);
    if (meta.tickerText && meta.tickerText.length > 0) {
      rows.push(["Ticker", meta.tickerText.join(" / ")]);
    }
    if (meta.catalogs.length > 1) {
      rows.push(["Sample packs", meta.catalogs.slice(1).join(", ")]);
    }
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Metadata popup                                                             */
/* -------------------------------------------------------------------------- */

const POPUP_ID = "mix-meta-popup";

/**
 * Render (or update) the floating metadata popup anchored to `anchorEl`.
 * The popup is appended to `document.body` so it overlaps the sequencer area
 * without disturbing the editor-area grid.
 *
 * Clicking anywhere outside the popup or on a different mix-tree-item
 * dismisses it.
 */
export function showMixMetaPopup(
  filename: string,
  group: string,
  meta: MixFileMeta | undefined,
  anchorEl: HTMLElement,
): void {
  dismissMixMetaPopup();
  if (!meta) return;

  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.className = "mix-meta-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", `Metadata for ${filename}`);

  const rows = buildMetaRows(filename, group, meta);

  const table = document.createElement("table");
  table.className = "mix-meta-table";
  for (const [key, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = key;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    table.appendChild(tr);
  }
  popup.appendChild(table);

  document.body.appendChild(popup);
  positionPopup(popup, anchorEl);

  // Dismiss on any outside click (deferred so current click doesn't dismiss)
  requestAnimationFrame(() => {
    document.addEventListener("click", outsideClickHandler, { capture: true, once: true });
  });
}

/** Remove the popup if it exists. */
export function dismissMixMetaPopup(): void {
  const existing = document.getElementById(POPUP_ID);
  if (existing) existing.remove();
  document.removeEventListener("click", outsideClickHandler, { capture: true });
}

/** Checks whether the metadata popup is currently visible. */
export function isMixMetaPopupVisible(): boolean {
  return document.getElementById(POPUP_ID) !== null;
}

function outsideClickHandler(e: Event): void {
  const popup = document.getElementById(POPUP_ID);
  if (!popup) return;
  if (e.target instanceof Node && popup.contains(e.target)) {
    // Click was inside the popup — re-attach listener
    document.addEventListener("click", outsideClickHandler, { capture: true, once: true });
    return;
  }
  popup.remove();
}

/* istanbul ignore next -- viewport-relative geometry is not exercised in jsdom */
function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const sidebarEl = anchor.closest<HTMLElement>(".archive-sidebar");
  const sidebarRect = sidebarEl?.getBoundingClientRect();

  // Prefer placing to the right of the sidebar; fall back to right of anchor
  const left = sidebarRect ? sidebarRect.right + 6 : anchorRect.right + 6;
  const top = anchorRect.top;

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  // Clamp so it doesn't overflow the viewport bottom
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    const overflow = popupRect.bottom - window.innerHeight + 8;
    if (overflow > 0) {
      popup.style.top = `${Math.max(8, top - overflow)}px`;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Tree rendering                                                             */
/* -------------------------------------------------------------------------- */

function renderTreeGroups(
  content: HTMLElement,
  groups: TreeGroup[],
  state: BrowserState,
  onSelect: (ref: MixFileRef) => void,
): void {
  content.replaceChildren();

  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "archive-placeholder";
    empty.textContent = "No .mix files found";
    content.appendChild(empty);
    return;
  }

  const root = document.createElement("div");
  root.className = "mix-tree-root";

  for (const group of groups) {
    const isExpanded = state.expandedIds.has(group.id);

    const groupEl = document.createElement("div");
    groupEl.className = "mix-tree-group";

    const headerBtn = document.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = `mix-tree-group-header${isExpanded ? " is-expanded" : ""}`;
    headerBtn.setAttribute("aria-expanded", String(isExpanded));
    headerBtn.appendChild(folderIcon(isExpanded));

    const labelSpan = document.createElement("span");
    labelSpan.className = "mix-tree-group-label";
    labelSpan.textContent = group.label;
    // Native tooltip for truncated folder names.
    labelSpan.title = group.label;
    headerBtn.appendChild(labelSpan);

    const countBadge = document.createElement("span");
    countBadge.className = "mix-tree-count";
    countBadge.textContent = String(group.files.length);
    headerBtn.appendChild(countBadge);

    const itemsEl = document.createElement("div");
    itemsEl.className = "mix-tree-items";
    if (!isExpanded) itemsEl.hidden = true;

    headerBtn.addEventListener("click", () => {
      dismissMixMetaPopup();
      if (state.expandedIds.has(group.id)) {
        state.expandedIds.delete(group.id);
      } else {
        state.expandedIds.add(group.id);
      }
      renderTreeGroups(content, groups, state, onSelect);
    });

    for (const file of group.files) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `mix-tree-item${state.activeKey === file.key ? " is-active" : ""}`;

      // Native tooltip — shows on hover without extra JS
      const tooltip = formatMetaTooltip(file.meta);
      btn.title = tooltip || file.label;

      btn.appendChild(fileIcon());

      const nameSpan = document.createElement("span");
      nameSpan.className = "mix-tree-item-label";
      nameSpan.textContent = file.label;
      btn.appendChild(nameSpan);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        activateTreeFile(content, state, file.key, btn);
        showMixMetaPopup(file.label, group.label, file.meta, btn);
      });

      btn.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        activateTreeFile(content, state, file.key, btn);
        dismissMixMetaPopup();
        onSelect({ label: file.label, group: group.label, productId: group.id, source: file.source });
      });

      itemsEl.appendChild(btn);
    }

    groupEl.append(headerBtn, itemsEl);
    root.appendChild(groupEl);
  }

  content.appendChild(root);
}

function activateTreeFile(
  content: HTMLElement,
  state: BrowserState,
  key: string,
  button: HTMLButtonElement,
): void {
  state.activeKey = key;
  for (const active of content.querySelectorAll<HTMLButtonElement>(".mix-tree-item.is-active")) {
    active.classList.remove("is-active");
  }
  button.classList.add("is-active");
}

/* -------------------------------------------------------------------------- */
/* Build tree groups from the pre-built index                                 */
/* -------------------------------------------------------------------------- */

function buildGroupsFromLibrary(mixLibrary: MixLibraryEntry[]): TreeGroup[] {
  return mixLibrary.map((entry) => ({
    id: entry.id,
    label: entry.name,
    files: entry.mixes.map((mix: MixFileEntry) => ({
      key: `${entry.id}/${mix.filename}`,
      label: mix.filename,
      meta: mix.meta,
      source: {
        type: "url" as const,
        url: `/mix/${encodeURIComponent(entry.id)}/${encodeURIComponent(mix.filename)}`,
      },
    })),
  }));
}

/* -------------------------------------------------------------------------- */
/* Exported entry point                                                       */
/* -------------------------------------------------------------------------- */

export function initMixFileBrowser(
  archiveTree: HTMLElement,
  options: MixFileBrowserOptions,
): MixFileBrowserController {
  const contentOrNull = archiveTree.querySelector<HTMLElement>(".archive-tree-content");
  const headerEl = archiveTree.querySelector<HTMLElement>(".archive-header");
  if (!contentOrNull) {
    return {
      setProductMode: () => {},
      getProductMode: () => getProductModeEntry(PRODUCT_MODE_ALL_ID),
    };
  }
  // Capture as a non-null reference so closures below can use it safely.
  const content: HTMLElement = contentOrNull;

  const state: BrowserState = {
    activeKey: null,
    expandedIds: new Set(),
  };

  let treeLoaded = false;
  let allGroups: TreeGroup[] = [];
  let productMode: ProductModeEntry = getProductModeEntry(PRODUCT_MODE_ALL_ID);
  let productSelect: HTMLSelectElement | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function defaultExpand(groups: TreeGroup[]): void {
    if (groups.length > 0) {
      state.expandedIds.add(groups[0].id);
    }
  }

  function setHeader(): void {
    if (!headerEl) return;
    headerEl.replaceChildren();

    productSelect = createProductModeSelect(productMode.id);
    productSelect.addEventListener("change", () => {
      const next = getProductModeEntry(productSelect?.value);
      productMode = next;
      rerenderTree();
      options.onProductModeChange?.(next);
    });
    headerEl.appendChild(productSelect);
  }

  function applyTree(groups: TreeGroup[]): void {
    treeLoaded = true;
    allGroups = groups;
    content.classList.remove("is-awaiting-click");
    rerenderTree();
  }

  function rerenderTree(): void {
    if (!treeLoaded) return;
    dismissMixMetaPopup();
    if (isAllEntry(productMode)) {
      renderTreeGroups(content, allGroups, state, options.onSelectFile);
      return;
    }
    const allowed = new Set(productMode.mixGroupIds);
    const matching = allGroups.filter((group) => allowed.has(group.id));
    const flatFiles: FlatTreeFile[] = matching.flatMap((group) =>
      group.files.map((file) => ({ ...file, groupId: group.id, groupLabel: group.label })),
    );
    renderFlatProductList(content, flatFiles, state, productMode, options.onSelectFile);
  }

  function loadTree(): void {
    const groups = buildGroupsFromLibrary(options.mixLibrary ?? []);
    defaultExpand(groups);
    setHeader();
    applyTree(groups);
  }

  function handleTrigger(): void {
    if (treeLoaded) return;
    loadTree();
  }

  // ── Attach click listener to the archive sidebar ───────────────────────────

  content.classList.add("is-awaiting-click");
  archiveTree.addEventListener("click", () => handleTrigger());

  // Also make the placeholder keyboard-accessible
  const placeholder = content.querySelector<HTMLElement>(".archive-placeholder");
  if (placeholder) {
    placeholder.setAttribute("role", "button");
    placeholder.setAttribute("tabindex", "0");
    placeholder.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleTrigger();
      }
    });
  }

  return {
    setProductMode(id: string): void {
      const next = getProductModeEntry(id);
      productMode = next;
      if (productSelect) productSelect.value = next.id;
      rerenderTree();
    },
    getProductMode(): ProductModeEntry {
      return productMode;
    },
  };
}

/**
 * Render the filtered tree as a flat list (no folder headers) when
 * Product Mode targets a single product.
 */
function renderFlatProductList(
  content: HTMLElement,
  files: FlatTreeFile[],
  state: BrowserState,
  productMode: ProductModeEntry,
  onSelect: (ref: MixFileRef) => void,
): void {
  content.replaceChildren();

  if (files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "archive-placeholder";
    empty.textContent = `No .mix files found for ${productMode.label}`;
    content.appendChild(empty);
    return;
  }

  const root = document.createElement("div");
  root.className = "mix-tree-root mix-tree-root--flat";

  const items = document.createElement("div");
  items.className = "mix-tree-items";

  const sorted = files
    .slice()
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));

  for (const file of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `mix-tree-item${state.activeKey === file.key ? " is-active" : ""}`;
    btn.title = formatMetaTooltip(file.meta) || file.label;
    btn.appendChild(fileIcon());

    const nameSpan = document.createElement("span");
    nameSpan.className = "mix-tree-item-label";
    nameSpan.textContent = file.label;
    btn.appendChild(nameSpan);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.activeKey = file.key;
      for (const active of content.querySelectorAll<HTMLButtonElement>(".mix-tree-item.is-active")) {
        active.classList.remove("is-active");
      }
      btn.classList.add("is-active");
      showMixMetaPopup(file.label, file.groupLabel, file.meta, btn);
    });

    btn.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      state.activeKey = file.key;
      dismissMixMetaPopup();
      onSelect({
        label: file.label,
        group: file.groupLabel,
        productId: file.groupId,
        source: file.source,
      });
    });

    items.appendChild(btn);
  }

  root.appendChild(items);
  content.appendChild(root);
}
