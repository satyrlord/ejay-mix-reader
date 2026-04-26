// Transport bar, playback state, toast, and context-menu rendering.

import type { CategoryEntry } from "../data.js";
import {
  gridSortKeyLabel,
  UNSORTED_CATEGORY_ID,
  UNSORTED_SUBCATEGORY_ID,
} from "../data.js";
import type { GridSortDir, GridSortKey } from "../data.js";
import type { Player } from "../player.js";

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
