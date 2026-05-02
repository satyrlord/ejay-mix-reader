/**
 * mix-file-browser.ts — In-app .mix file browser for the archive-tree panel.
 *
 * DEV mode:  immediately shows a product tree from the pre-built mixLibrary
 *            index; no OS dialog needed.
 * PROD mode: opens a "Select folder" OS dialog via the File System Access API
 *            (`showDirectoryPicker`), with a `<input webkitdirectory>` fallback
 *            for browsers that do not support FSA.
 */

import type { MixFileEntry, MixFileMeta, MixLibraryEntry } from "./data.js";
import { humanizeIdentifier, mixFormatLabel } from "./data.js";
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

export type MixFileSource =
  | { type: "url"; url: string }
  | { type: "handle"; handle: FileSystemFileHandle }
  | { type: "file"; file: File };

export interface MixFileBrowserOptions {
  /** `true` when running under the Vite dev server. */
  isDev: boolean;
  /**
   * Pre-built mix library from `data/index.json`.
   * Required (and only used) when `isDev` is `true`.
   */
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

interface RelativeMixFile {
  relativeParts: string[];
  label: string;
  source: MixFileSource;
}

interface GroupDescriptor {
  id: string;
  label: string;
  productHint?: string;
  sortBucket: number;
}

interface BrowserState {
  activeKey: string | null;
  expandedIds: Set<string>;
}

const MIX_SCAN_MAX_FILES = 1024;
const MIX_META_READ_CONCURRENCY = 8;

/* -------------------------------------------------------------------------- */
/* SVG helpers                                                                */
/* -------------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

const USERDATA_GROUP_ID = "_userdata";

const PRODUCT_LABELS: Record<string, string> = {
  Dance_eJay1: "Dance eJay 1",
  Dance_eJay2: "Dance eJay 2",
  Dance_eJay3: "Dance eJay 3",
  Dance_eJay4: "Dance eJay 4",
  Dance_SuperPack: "Dance SuperPack",
  "HipHop 1": "HipHop eJay 1",
  "HipHop eJay 1": "HipHop eJay 1",
  "HipHop 2": "HipHop eJay 2",
  "HipHop eJay 2": "HipHop eJay 2",
  "HipHop 3": "HipHop eJay 3",
  "HipHop eJay 3": "HipHop eJay 3",
  "HipHop 4": "HipHop eJay 4",
  "HipHop eJay 4": "HipHop eJay 4",
  House_eJay: "House eJay",
  Rave: "Rave",
  "Techno 3": "Techno eJay 3",
  TECHNO_EJAY: "Techno eJay",
  Xtreme_eJay: "Xtreme eJay",
};

const PRODUCT_HINTS: Record<string, string> = {
  Dance_eJay1: "Dance_eJay1",
  Dance_eJay2: "Dance_eJay2",
  Dance_eJay3: "Dance_eJay3",
  Dance_eJay4: "Dance_eJay4",
  Dance_SuperPack: "Dance_SuperPack",
  "HipHop 1": "HipHop_eJay1",
  "HipHop eJay 1": "HipHop_eJay1",
  "HipHop 2": "HipHop_eJay2",
  "HipHop eJay 2": "HipHop_eJay2",
  "HipHop 3": "HipHop_eJay3",
  "HipHop eJay 3": "HipHop_eJay3",
  "HipHop 4": "HipHop_eJay4",
  "HipHop eJay 4": "HipHop_eJay4",
  House_eJay: "House_eJay",
  Rave: "Rave",
  "Techno 3": "Techno_eJay3",
  TECHNO_EJAY: "Techno_eJay",
  Xtreme_eJay: "Xtreme_eJay",
};

const GENERATION_PACK_HINTS: Record<string, string> = {
  Dance: "GenerationPack1_Dance",
  HipHop: "GenerationPack1_HipHop",
  Rave: "GenerationPack1_Rave",
};

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

function humanizeUserdataSegment(value: string): string {
  const normalized = value.startsWith("_") ? value.slice(1) : value;
  return humanizeIdentifier(normalized, { compactDmkit: true });
}

function userdataGroupLabel(relParts: string[]): string {
  return `User: ${relParts.map(humanizeUserdataSegment).join(" \u2013 ")}`;
}

function productLabelForDir(dirName: string): string {
  return PRODUCT_LABELS[dirName] ?? humanizeIdentifier(dirName, { compactDmkit: true });
}

function generationPackLabel(segment: string): string {
  return `GenerationPack1 ${humanizeIdentifier(segment, { compactDmkit: true })}`;
}

function rootNeedsPrefix(rootName: string): boolean {
  return rootName === USERDATA_GROUP_ID || rootName === "GenerationPack1" || rootName in PRODUCT_HINTS;
}

function normaliseRelativeParts(rootName: string, relativeParts: string[]): string[] {
  return rootNeedsPrefix(rootName) ? [rootName, ...relativeParts] : relativeParts;
}

function describeGroup(relativeParts: string[]): GroupDescriptor {
  const parts = relativeParts.filter(Boolean);
  if (parts.length === 0) {
    return {
      id: "Selected files",
      label: "Selected files",
      sortBucket: 0,
    };
  }

  const [head, second] = parts;
  if (head === USERDATA_GROUP_ID) {
    const relParts = parts.slice(1, -1);
    const groupParts = relParts.length > 0 ? relParts : [USERDATA_GROUP_ID];
    return {
      id: `${USERDATA_GROUP_ID}/${groupParts.join("/")}`,
      label: relParts.length > 0 ? userdataGroupLabel(relParts) : "User files",
      sortBucket: 1,
    };
  }

  if (head === "GenerationPack1" && second) {
    return {
      id: `GenerationPack1/${second}`,
      label: generationPackLabel(second),
      productHint: GENERATION_PACK_HINTS[second],
      sortBucket: 0,
    };
  }

  return {
    id: head,
    label: productLabelForDir(head),
    productHint: PRODUCT_HINTS[head],
    sortBucket: 0,
  };
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



async function readMixFileMeta(source: MixFileSource, productHint?: string): Promise<MixFileMeta | undefined> {
  try {
    const file = source.type === "handle"
      ? await source.handle.getFile()
      : source.type === "file"
        ? source.file
        : null;
    if (!file) return undefined;
    const buffer = await file.arrayBuffer();
    return mixMetaFromIr(parseMixBrowser(buffer, productHint));
  } catch {
    return undefined;
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];

  const results = new Array<R>(values.length);
  const concurrency = Math.max(1, Math.min(limit, values.length));
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= values.length) {
        return;
      }
      results[currentIndex] = await mapper(values[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function limitScannedMixFiles(files: RelativeMixFile[]): RelativeMixFile[] {
  if (files.length <= MIX_SCAN_MAX_FILES) return files;
  console.warn(`Mix browser scan truncated to ${MIX_SCAN_MAX_FILES} files.`);
  return files.slice(0, MIX_SCAN_MAX_FILES);
}

async function buildGroupsFromRelativeFiles(
  rootName: string,
  files: RelativeMixFile[],
): Promise<TreeGroup[]> {
  const grouped = new Map<string, { descriptor: GroupDescriptor; files: RelativeMixFile[] }>();

  for (const file of files) {
    const normalizedParts = normaliseRelativeParts(rootName, file.relativeParts);
    const descriptor = describeGroup(normalizedParts);
    const existing = grouped.get(descriptor.id);
    if (existing) {
      existing.files.push(file);
    } else {
      grouped.set(descriptor.id, { descriptor, files: [file] });
    }
  }

  const groups = await Promise.all([...grouped.values()].map(async ({ descriptor, files: groupFiles }) => {
    const sortedFiles = groupFiles
      .slice()
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));

    const filesWithMeta = await mapWithConcurrency(
      sortedFiles,
      MIX_META_READ_CONCURRENCY,
      async (file) => ({
        key: `${descriptor.id}/${file.relativeParts.join("/")}`,
        label: file.label,
        source: file.source,
        meta: await readMixFileMeta(file.source, descriptor.productHint),
      }),
    );

    return {
      id: descriptor.id,
      label: descriptor.label,
      sortBucket: descriptor.sortBucket,
      files: filesWithMeta,
    };
  }));

  return groups
    .sort((left, right) => {
      if (left.sortBucket !== right.sortBucket) {
        return left.sortBucket - right.sortBucket;
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    })
    .map(({ sortBucket: _sortBucket, ...group }) => group);
}

/* istanbul ignore next -- only rendered from the PROD-mode choose-folder button */
function chooseFolderIcon(): SVGSVGElement {
  return makeSvg(makePath("M2 4.5h5L8.5 6H14v7H2V4.5z"));
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

/* -------------------------------------------------------------------------- */
/* DEV mode — build tree groups from the pre-built index                     */
/* -------------------------------------------------------------------------- */

function buildDevGroups(mixLibrary: MixLibraryEntry[]): TreeGroup[] {
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
/* PROD mode — File System Access API directory scan                         */
/* -------------------------------------------------------------------------- */

/* istanbul ignore next -- OS-dialog path is not exercised by the coverage harness */
async function scanDirectory(
  dir: FileSystemDirectoryHandle,
  depth: number,
  relativeParts: string[],
  files: RelativeMixFile[],
): Promise<void> {
  if (depth > 4) return;

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      await scanDirectory(
        handle as FileSystemDirectoryHandle,
        depth + 1,
        [...relativeParts, name],
        files,
      );
    } else if (handle.kind === "file" && /\.mix$/i.test(name)) {
      files.push({
        relativeParts: [...relativeParts, name],
        label: name,
        source: { type: "handle", handle: handle as FileSystemFileHandle },
      });
    }
  }
}

/* istanbul ignore next -- OS-dialog path is not exercised by the coverage harness */
async function buildFsaGroups(
  root: FileSystemDirectoryHandle,
): Promise<TreeGroup[]> {
  const files: RelativeMixFile[] = [];
  await scanDirectory(root, 0, [], files);
  return buildGroupsFromRelativeFiles(root.name, limitScannedMixFiles(files));
}

/* -------------------------------------------------------------------------- */
/* PROD mode — <input webkitdirectory> fallback                              */
/* -------------------------------------------------------------------------- */

/* istanbul ignore next -- file-input path is not exercised by the coverage harness */
async function buildFileInputGroups(rootName: string, files: File[]): Promise<TreeGroup[]> {
  const relativeFiles: RelativeMixFile[] = files
    .filter((file) => /\.mix$/i.test(file.name))
    .map((file) => {
      const parts = file.webkitRelativePath.split("/").filter(Boolean);
      const relativeParts = parts.length > 1 ? parts.slice(1) : [file.name];
      return {
        relativeParts,
        label: file.name,
        source: { type: "file" as const, file },
      };
    });

  return buildGroupsFromRelativeFiles(rootName, limitScannedMixFiles(relativeFiles));
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

  function setHeaderRoot(_rootName: string, onChoose?: () => void): void {
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

    /* istanbul ignore next -- "choose different folder" button only rendered in PROD mode */
    if (onChoose) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "archive-choose-btn";
      btn.title = "Choose different folder";
      btn.setAttribute("aria-label", "Choose different folder");
      btn.appendChild(chooseFolderIcon());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onChoose();
      });
      headerEl.appendChild(btn);
    }
  }

  /* istanbul ignore next -- only called from PROD-mode triggerFsa, not exercised by the coverage harness */
  function showLoadingState(): void {
    content.replaceChildren();
    const p = document.createElement("p");
    p.className = "archive-placeholder";
    p.textContent = "Scanning for .mix files\u2026";
    content.appendChild(p);
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

  // ── DEV flow ───────────────────────────────────────────────────────────────

  function triggerDev(): void {
    const groups = buildDevGroups(options.mixLibrary ?? []);
    defaultExpand(groups);
    setHeaderRoot("archive");
    applyTree(groups);
  }

  // ── PROD flow ──────────────────────────────────────────────────────────────

  /* istanbul ignore next -- OS-dialog paths are not exercised by the coverage harness */
  async function triggerFsa(): Promise<void> {
    let root: FileSystemDirectoryHandle;
    try {
      root = await window.showDirectoryPicker({ mode: "read" });
    } catch (err) {
      // User cancelled — leave the placeholder in place
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }

    showLoadingState();
    const groups = await buildFsaGroups(root);
    defaultExpand(groups);
    setHeaderRoot(root.name, () => void triggerFsa());
    applyTree(groups);
  }

  /* istanbul ignore next -- file input path is not exercised by the coverage harness */
  function triggerFileInput(onChoose: () => void): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mix";
    input.multiple = true;
    // Request directory mode so the OS shows a folder picker where supported.
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        if (files.length === 0) return;

        const folderName =
          files[0]?.webkitRelativePath.split("/")[0] ?? "Selected files";

        void (async () => {
          showLoadingState();
          const groups = await buildFileInputGroups(folderName, files);
          defaultExpand(groups);
          setHeaderRoot(folderName, onChoose);
          applyTree(groups);
        })();
      },
      { once: true },
    );

    input.click();
  }

  /* istanbul ignore next -- OS-dialog path is not exercised by the coverage harness */
  function triggerProd(): void {
    if (typeof window.showDirectoryPicker === "function") {
      void triggerFsa();
    } else {
      triggerFileInput(() => triggerProd());
    }
  }

  // ── Main trigger ───────────────────────────────────────────────────────────

  function handleTrigger(): void {
    if (treeLoaded) return;
    if (options.isDev) {
      triggerDev();
    } else {
      /* istanbul ignore next -- production-only path */
      triggerProd();
    }
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
