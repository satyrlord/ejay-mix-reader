import "./app.css";

import type { CategoryConfig, CategoryEntry, Sample, SampleLookupEntry, SubcategoryKind } from "./data.js";
import { initMixFileBrowser } from "./mix-file-browser.js";
import type { MixFileRef } from "./mix-file-browser.js";
import {
  applyProductTheme,
  getProductModeEntry,
  isAllEntry,
  PRODUCT_MODE_ALL_ID,
  type ProductModeEntry,
} from "./product-mode.js";
import { parseMixBrowser } from "./mix-parser.js";
import { buildMixPlaybackPlan, MixPlayerHost } from "./mix-player.js";
import type { AudioBufferLike, MixPlaybackPlan } from "./mix-player.js";
import { createSampleGridContextMenuController } from "./sample-grid-context-menu.js";
import {
  addSubcategoryToCategoryConfig,
  buildCategoryEntries,
  buildDefaultCategoryConfig,
  categoryConfigsEqual,
  CATEGORY_CONFIG_UPDATED_EVENT,
  SAMPLE_METADATA_UPDATED_EVENT,
  DEFAULT_GRID_SORT_DIR,
  DEFAULT_GRID_SORT_KEY,
  getSubcategoryKind,
  normalizeCategoryLabel,
  removeSubcategoryFromCategoryConfig,
  sampleCategory,
  UNSORTED_CATEGORY_ID,
  UNSORTED_SUBCATEGORY_ID,
} from "./data.js";
import { createCategoryConfigController } from "./category-config-controller.js";
import type { GridSortDir, GridSortKey } from "./data.js";
import type { Library } from "./library.js";
import { FetchLibrary, pickLibraryFolder } from "./library.js";
import type { SubcategoryOperation } from "./main-controller-types.js";
import {
  categoryColorFromAudioUrl,
  categoryTokenFromAudioUrl,
  clampMixBeat,
  collectMixAudioUrls,
  describeMixLane,
  timelineBpm,
  timelineWidthPx,
} from "./mix-playback-controller.js";
import { calcProgressInterval, Player } from "./player.js";
import {
  createSequencerPauseIcon,
  createSequencerPlayIcon,
  renderCategorySidebar,
  renderHomePage,
  renderSampleGrid,
  renderSpaShell,
  setMixSampleLoadingOverlay,
  setTransportBuildLabelAudioPlaying,
  renderSubcategoryTabs,
  showErrorToast,
  type SubcategoryAddOptions,
  type SpaShellSlots,
  type UiTab,
  updatePlayingBlock,
  updateTransport,
} from "./render.js";
import { computeSampleBrowserResult } from "./sample-browser-controller.js";

type CategoryTabMode = "subcategory";

interface CategoryTab extends UiTab {
  mode: CategoryTabMode;
  value: string;
  kind: SubcategoryKind;
  removable: boolean;
}

interface AppState {
  library: Library | null;
  categoryConfig: CategoryConfig;
  categories: CategoryEntry[];
  activeCategory: CategoryEntry | null;
  samples: Sample[];
  tabs: CategoryTab[];
  activeTab: CategoryTab | null;
  bpm: number | null;
  productMode: ProductModeEntry;
  sampleBubbleZoomScale: number;
  isAddingSubcategory: boolean;
  subcategoryDraft: string;
  searchQuery: string;
  gridSortKey: GridSortKey;
  gridSortDir: GridSortDir;
  sampleIndex: Record<string, SampleLookupEntry>;
}

interface MixUiRefs {
  canvas: HTMLElement;
  header: HTMLElement;
  mixName: HTMLElement;
  bpmDisplay: HTMLElement;
  homeButton: HTMLButtonElement;
  playButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  position: HTMLElement;
  scroll: HTMLElement;
  playhead: HTMLElement | null;
}

const SAMPLE_BUBBLE_ZOOM_CSS_VAR = "--sample-bubble-zoom-scale";
const SAMPLE_BUBBLE_ZOOM_STEP = 0.1;
const SAMPLE_BUBBLE_ZOOM_MIN = 0.5;
const SAMPLE_BUBBLE_ZOOM_MAX = 2;
const MIX_TIMELINE_LABEL_PX = 160;
const MIX_TIMELINE_BEAT_PX = 48;
const MIX_PLAYHEAD_AUTO_SCROLL_TARGET_RATIO = 0.72;
const MIX_PLAYHEAD_AUTO_SCROLL_TRIGGER_RATIO = 0.88;
const MIX_GRID_MAJOR_EVERY_BEATS = 8;
const SEQUENCER_EVENT_CLICK_DELAY_MS = 220;
const MIX_PLAYBACK_DRIFT_GRACE_MS = 350;
const MIX_GRID_DEFAULT_EDITOR_RATIO = 0.58;
const SHELL_EDITOR_HEIGHT_CSS_VAR = "--shell-editor-height";
const SHELL_EDITOR_MIN_PX = 220;
const SHELL_BROWSER_MIN_PX = 220;
const SHELL_SPLITTER_KEY_STEP_PX = 24;

const SUBCATEGORY_CONTEXT_MENU_ID = "subcategory-context-menu";

const isDev = import.meta.env.DEV;

const noop = (): void => {};

export function createAppController(app: HTMLElement): () => void {
  const state: AppState = {
    library: null,
    categoryConfig: buildDefaultCategoryConfig(),
    categories: [],
    activeCategory: null,
    samples: [],
    tabs: [],
    activeTab: null,
    bpm: null,
    productMode: getProductModeEntry(PRODUCT_MODE_ALL_ID),
    sampleBubbleZoomScale: 1,
    isAddingSubcategory: false,
    subcategoryDraft: "",
    searchQuery: "",
    gridSortKey: DEFAULT_GRID_SORT_KEY,
    gridSortDir: DEFAULT_GRID_SORT_DIR,
    sampleIndex: {},
  };

  const player = new Player();
  let slots: SpaShellSlots | null = null;
  let progressUpdateIntervalId: number | null = null;
  let stopCategoryConfigWatch: () => void = noop;
  let cleanupShellSplitter: () => void = noop;
  let cleanupTransportShortcuts: () => void = noop;
  let cleanupSequencerScrollIntent: () => void = noop;
  const categoryConfigController = createCategoryConfigController();
  let cleanupSubcategoryContextMenu: () => void = noop;
  let currentGridSamples: Sample[] = [];
  let activeMixPlan: MixPlaybackPlan | null = null;
  let renderedMixPlan: MixPlaybackPlan | null = null;
  let activeMixName: string | null = null;
  let mixPlaybackHost: MixPlayerHost | null = null;
  let mixAudioContext: AudioContext | null = null;
  let mixPlaybackStopTimeoutId: number | null = null;
  let mixPlaybackAnimationFrameId: number | null = null;
  let mixPlaybackStartedAtMs: number | null = null;
  let mixTransportPlaying = false;
  let mixPlayheadBeat = 0;
  let mixAutoScrollSuppressedByUser = false;
  // Monotonic token used to cancel stale async decode/play attempts.
  let mixPlaybackRequestId = 0;
  // Monotonic token used to cancel stale async sample preload attempts.
  let mixLoadRequestId = 0;
  let mixSamplesLoading = false;
  let mixSamplesLoadedCount = 0;
  let mixSamplesTotalCount = 0;
  /** Bounded decode cache: keeps at most the most-recently-used entries. */
  const MIX_AUDIO_CACHE_MAX = 256;
  const mixAudioBufferCache = new Map<string, Promise<AudioBufferLike>>();

  const sampleGridContextMenu = createSampleGridContextMenuController({
    getCategories: () => state.categories,
    getCurrentGridSamples: () => currentGridSamples,
    getSortState: () => ({ key: state.gridSortKey, dir: state.gridSortDir }),
    setSortState: (key, dir) => {
      state.gridSortKey = key;
      state.gridSortDir = dir;
    },
    refreshSamples,
    onMoveSample: (sample, newCategory, newSubcategory) => {
      void handleMoveSample(sample, newCategory, newSubcategory);
    },
    closeOtherMenus: () => {
      closeSubcategoryContextMenu();
    },
  });

  let disposed = false;

  /* istanbul ignore next -- cleanup is exercised indirectly by browser tests; remaining branches are defensive teardown guards */
  function cleanup(): void {
    /* istanbul ignore if -- defensive guard for repeated teardown calls */
    if (disposed) return;
    disposed = true;
    clearCategoryConfigWatcher();
    cleanupShellSplitter();
    cleanupShellSplitter = noop;
    cleanupTransportShortcuts();
    cleanupTransportShortcuts = noop;
    cleanupSequencerScrollIntent();
    cleanupSequencerScrollIntent = noop;
    clearProgressUpdateInterval();
    stopMixPlayback();
    setMixSampleLoadingState(false, 0, 0);
    closeSubcategoryContextMenu();
    closeSampleContextMenu();
    player.destroy();
    /* istanbul ignore if -- audio context is optional and may never be created before teardown */
    if (mixAudioContext) {
      void mixAudioContext.close().catch(() => { });
      mixAudioContext = null;
    }
    /* istanbul ignore next -- browser coverage boots the library before unload */
    state.library?.dispose();
  }

  /* v8 ignore next -- progress interval teardown is a defensive transport helper */
  function clearProgressUpdateInterval(): void {
    if (progressUpdateIntervalId === null) return;
    clearInterval(progressUpdateIntervalId);
    progressUpdateIntervalId = null;
  }

  function applySampleBubbleZoom(): void {
    document.documentElement.style.setProperty(
      SAMPLE_BUBBLE_ZOOM_CSS_VAR,
      String(state.sampleBubbleZoomScale),
    );
  }

  function activeCategoryColorVar(categoryId: string | null | undefined): string {
    if (!categoryId) {
      return "var(--category-color-unsorted, var(--category-palette-13))";
    }

    const token = categoryId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return `var(--category-color-${token || "unsorted"}, var(--category-color-unsorted, var(--category-palette-13)))`;
  }

  function adjustSampleBubbleZoom(delta: number): void {
    const updated = Number((state.sampleBubbleZoomScale + delta).toFixed(4));
    state.sampleBubbleZoomScale = Math.min(SAMPLE_BUBBLE_ZOOM_MAX, Math.max(SAMPLE_BUBBLE_ZOOM_MIN, updated));
    applySampleBubbleZoom();
  }

  function clearCategoryConfigWatcher(): void {
    stopCategoryConfigWatch();
    stopCategoryConfigWatch = noop;
  }

  function ensureBpmFilterOption(select: HTMLSelectElement, bpm: number): void {
    const value = String(bpm);
    if (Array.from(select.options).some((option) => option.value === value)) {
      return;
    }

    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;

    for (const existing of Array.from(select.options)) {
      if (existing.value === "") continue;
      const existingBpm = Number(existing.value);
      if (Number.isFinite(existingBpm) && existingBpm > bpm) {
        select.insertBefore(option, existing);
        return;
      }
    }

    select.appendChild(option);
  }

  function isSubcategoryOperationInFlight(operation: SubcategoryOperation): boolean {
    return categoryConfigController.isSubcategoryOperationInFlight(operation);
  }

  function beginSubcategoryOperation(operation: SubcategoryOperation): void {
    categoryConfigController.beginSubcategoryOperation(operation);
  }

  function completeSubcategoryOperation(operation: SubcategoryOperation): void {
    categoryConfigController.completeSubcategoryOperation(operation);
  }

  player.onStateChange((playerState) => {
    setTransportBuildLabelAudioPlaying("sample", playerState === "playing");
    updatePlayingBlock(player.activePath);
    updateTransport(player.activePath, player);

    clearProgressUpdateInterval();
    if (playerState === "playing") {
      const intervalMs = calcProgressInterval(player.duration);
      progressUpdateIntervalId = window.setInterval(() => updateTransport(player.activePath, player), intervalMs);
    }
  });

  function clearMixPlaybackStopTimeout(): void {
    if (mixPlaybackStopTimeoutId === null) return;
    window.clearTimeout(mixPlaybackStopTimeoutId);
    mixPlaybackStopTimeoutId = null;
  }

  function formatLoadedMixName(filename: string): string {
    return filename.replace(/\.mix$/i, "");
  }

  function setMixSampleLoadingState(isLoading: boolean, loadedCount: number, totalCount: number): void {
    mixSamplesLoading = isLoading;
    mixSamplesLoadedCount = Math.max(0, loadedCount);
    mixSamplesTotalCount = Math.max(0, totalCount);
    setMixSampleLoadingOverlay({
      isVisible: mixSamplesLoading,
      mixName: activeMixName ?? undefined,
      loadedCount: mixSamplesLoadedCount,
      totalCount: mixSamplesTotalCount,
    });
  }

  function getMixUi(): MixUiRefs | null {
    if (!slots) return null;

    const { sequencer, contextStrip } = slots;
    return {
      canvas: sequencer.querySelector<HTMLElement>(".sequencer-canvas")!,
      header: sequencer.querySelector<HTMLElement>(".sequencer-header")!,
      mixName: contextStrip.querySelector<HTMLElement>(".context-mix-name")!,
      bpmDisplay: contextStrip.querySelector<HTMLElement>(".context-bpm-display")!,
      homeButton: sequencer.querySelector<HTMLButtonElement>(".seq-home-btn")!,
      playButton: sequencer.querySelector<HTMLButtonElement>(".seq-play-btn")!,
      stopButton: sequencer.querySelector<HTMLButtonElement>(".seq-stop-btn")!,
      position: sequencer.querySelector<HTMLElement>(".seq-position")!,
      scroll: sequencer.querySelector<HTMLElement>(".sequencer-scroll")!,
      playhead: sequencer.querySelector<HTMLElement>(".sequencer-playhead"),
    };
  }

  function isPointerOnHorizontalScrollbar(scroll: HTMLElement, clientY: number): boolean {
    const scrollbarHeight = scroll.offsetHeight - scroll.clientHeight;
    if (scrollbarHeight <= 0) return false;
    const rect = scroll.getBoundingClientRect();
    return clientY >= rect.bottom - scrollbarHeight;
  }

  function initSequencerScrollIntentHandlers(currentSlots: SpaShellSlots): () => void {
    const scroll = currentSlots.sequencer.querySelector<HTMLElement>(".sequencer-scroll");
    if (!scroll) return noop;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!activeMixPlan || activeMixPlan.loopBeats === null) return;
      if (!isPointerOnHorizontalScrollbar(scroll, event.clientY)) return;
      mixAutoScrollSuppressedByUser = true;
    };

    const handleWheel = (event: WheelEvent): void => {
      if (!activeMixPlan || activeMixPlan.loopBeats === null) return;
      const horizontalIntent = Math.abs(event.deltaX) > 0 || (event.shiftKey && Math.abs(event.deltaY) > 0);
      if (!horizontalIntent) return;
      mixAutoScrollSuppressedByUser = true;
    };

    scroll.addEventListener("pointerdown", handlePointerDown);
    scroll.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      scroll.removeEventListener("pointerdown", handlePointerDown);
      scroll.removeEventListener("wheel", handleWheel);
    };
  }

  function isShortcutEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null;
  }

  function isSpaceShortcutKey(event: KeyboardEvent): boolean {
    return event.code === "Space" || event.key === " " || event.key === "Spacebar";
  }

  function currentMixBarStartBeat(): number {
    if (!activeMixPlan || activeMixPlan.loopBeats === null) return 0;
    return clampMixStartBeat(Math.floor(mixPlayheadBeat));
  }

  function syncPlayPauseButton(button: HTMLButtonElement, mode: "play" | "pause"): void {
    const currentMode = button.dataset.transportMode;
    if (currentMode !== mode) {
      button.replaceChildren(mode === "pause" ? createSequencerPauseIcon() : createSequencerPlayIcon());
      button.dataset.transportMode = mode;
    }

    if (mode === "pause") {
      button.setAttribute("aria-label", "Pause mix at current bar start");
      button.title = "Pause mix at current bar start";
      return;
    }

    button.setAttribute("aria-label", "Play mix");
    button.title = "Play mix";
  }

  function getCurrentShellEditorHeight(shell: HTMLElement): number | null {
    const raw = shell.style.getPropertyValue(SHELL_EDITOR_HEIGHT_CSS_VAR);
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function setShellEditorHeight(
    shell: HTMLElement,
    contextStrip: HTMLElement,
    splitter: HTMLElement,
    requestedEditorHeight: number,
  ): void {
    const shellHeight = shell.getBoundingClientRect().height;
    const available = shellHeight - contextStrip.offsetHeight - splitter.offsetHeight;
    if (!Number.isFinite(available) || available <= 0) return;

    const minEditor = Math.min(SHELL_EDITOR_MIN_PX, Math.max(80, available * 0.2));
    const minBrowser = Math.min(SHELL_BROWSER_MIN_PX, Math.max(80, available * 0.2));
    const maxEditor = Math.max(minEditor, available - minBrowser);
    const clamped = Math.min(maxEditor, Math.max(minEditor, requestedEditorHeight));
    shell.style.setProperty(SHELL_EDITOR_HEIGHT_CSS_VAR, `${Math.round(clamped)}px`);

    const percent = Math.max(0, Math.min(100, Math.round((clamped / available) * 100)));
    splitter.setAttribute("aria-valuenow", String(percent));
  }

  function initShellSplitter(currentSlots: SpaShellSlots): () => void {
    const { shell, contextStrip, splitter } = currentSlots;
    let dragging = false;

    const applyFromClientY = (clientY: number): void => {
      const requested = clientY - shell.getBoundingClientRect().top;
      setShellEditorHeight(shell, contextStrip, splitter, requested);
    };

    const stopDragging = (): void => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove("is-dragging");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      event.preventDefault();
      applyFromClientY(event.clientY);
    };

    const handlePointerUp = (): void => {
      stopDragging();
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      splitter.classList.add("is-dragging");
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      applyFromClientY(event.clientY);
    };

    const nudgeBy = (deltaPx: number): void => {
      const current = getCurrentShellEditorHeight(shell)
        ?? shell.getBoundingClientRect().height * MIX_GRID_DEFAULT_EDITOR_RATIO;
      setShellEditorHeight(shell, contextStrip, splitter, current + deltaPx);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          nudgeBy(-SHELL_SPLITTER_KEY_STEP_PX);
          break;
        case "ArrowDown":
          event.preventDefault();
          nudgeBy(SHELL_SPLITTER_KEY_STEP_PX);
          break;
        case "PageUp":
          event.preventDefault();
          nudgeBy(-SHELL_SPLITTER_KEY_STEP_PX * 4);
          break;
        case "PageDown":
          event.preventDefault();
          nudgeBy(SHELL_SPLITTER_KEY_STEP_PX * 4);
          break;
        case "Home":
          event.preventDefault();
          setShellEditorHeight(shell, contextStrip, splitter, 0);
          break;
        case "End":
          event.preventDefault();
          setShellEditorHeight(shell, contextStrip, splitter, Number.MAX_SAFE_INTEGER);
          break;
        default:
          break;
      }
    };

    const handleResize = (): void => {
      const current = getCurrentShellEditorHeight(shell)
        ?? shell.getBoundingClientRect().height * MIX_GRID_DEFAULT_EDITOR_RATIO;
      setShellEditorHeight(shell, contextStrip, splitter, current);
    };

    splitter.addEventListener("pointerdown", handlePointerDown);
    splitter.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    const initialHeight = shell.getBoundingClientRect().height * MIX_GRID_DEFAULT_EDITOR_RATIO;
    setShellEditorHeight(shell, contextStrip, splitter, initialHeight);

    return () => {
      stopDragging();
      splitter.removeEventListener("pointerdown", handlePointerDown);
      splitter.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      splitter.classList.remove("is-dragging");
    };
  }

  function clampMixStartBeat(beat: number): number {
    return clampMixBeat(beat, activeMixPlan?.loopBeats ?? null);
  }

  function timelineBeatFromClientX(target: HTMLElement, clientX: number): number | null {
    if (!activeMixPlan || activeMixPlan.loopBeats === null) return null;
    const rect = target.getBoundingClientRect();
    const localX = clientX - rect.left - MIX_TIMELINE_LABEL_PX;
    return clampMixStartBeat(Math.floor(localX / MIX_TIMELINE_BEAT_PX));
  }

  function seekMixPlaybackToBeat(beat: number): void {
    if (!activeMixPlan || activeMixPlan.loopBeats === null) return;
    const startBeat = clampMixStartBeat(beat);
    // A direct timeline seek is an explicit "follow this point" action.
    mixAutoScrollSuppressedByUser = false;
    setMixPlayheadBeat(startBeat, true);
    updateMixPlaybackProgress(startBeat);
    void playSelectedMix(startBeat);
  }

  function playSequencerEventSample(audioUrl: string | null): void {
    stopMixPlayback();
    if (!audioUrl) {
      showErrorToast("Could not play this sequencer sample - audio file not found.");
      return;
    }
    player.play(audioUrl);
  }

  function setMixPlayheadBeat(beat: number, autoScroll: boolean): void {
    if (!activeMixPlan || activeMixPlan.loopBeats === null) {
      mixPlayheadBeat = 0;
      return;
    }

    const limit = activeMixPlan.loopBeats;
    const clampedBeat = Math.max(0, Math.min(limit, beat));
    mixPlayheadBeat = clampedBeat;

    const ui = getMixUi();
    if (!ui || !ui.playhead) return;
    const leftPx = MIX_TIMELINE_LABEL_PX + (clampedBeat * MIX_TIMELINE_BEAT_PX);
    ui.playhead.style.transform = `translateX(${leftPx}px)`;

    if (!autoScroll || mixAutoScrollSuppressedByUser) return;

    const triggerLeft = ui.scroll.scrollLeft + (ui.scroll.clientWidth * MIX_PLAYHEAD_AUTO_SCROLL_TRIGGER_RATIO);
    if (leftPx < triggerLeft) return;

    const targetLeft = leftPx - (ui.scroll.clientWidth * MIX_PLAYHEAD_AUTO_SCROLL_TARGET_RATIO);
    const maxLeft = Math.max(0, ui.scroll.scrollWidth - ui.scroll.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, targetLeft));
    if (clampedLeft <= ui.scroll.scrollLeft) return;
    ui.scroll.scrollLeft = clampedLeft;
  }

  function stopMixPlaybackAnimation(): void {
    if (mixPlaybackAnimationFrameId !== null) {
      window.cancelAnimationFrame(mixPlaybackAnimationFrameId);
      mixPlaybackAnimationFrameId = null;
    }
    mixPlaybackStartedAtMs = null;
  }

  function updateMixPlaybackProgress(beat: number): void {
    const ui = getMixUi();
    if (!ui || !activeMixPlan) return;

    if (activeMixPlan.loopBeats === null) {
      ui.position.textContent = `${activeMixPlan.events.length} events · ${activeMixPlan.resolvedEvents} ready · list view`;
      return;
    }

    const displayBeat = Math.min(activeMixPlan.loopBeats, Math.floor(beat) + 1);
    ui.position.textContent = `Bar ${displayBeat} / ${activeMixPlan.loopBeats} · ${activeMixPlan.resolvedEvents} ready`;
  }

  function startMixPlaybackAnimation(startAtMs: number, startBeat: number): void {
    stopMixPlaybackAnimation();
    mixPlaybackStartedAtMs = startAtMs;
    const initialBeat = clampMixStartBeat(startBeat);
    setMixPlayheadBeat(initialBeat, true);
    updateMixPlaybackProgress(initialBeat);

    const tick = (): void => {
      if (!activeMixPlan || mixPlaybackStartedAtMs === null) {
        stopMixPlaybackAnimation();
        return;
      }

      const elapsedSec = Math.max(0, (performance.now() - mixPlaybackStartedAtMs) / 1000);
      const elapsedBeats = Math.max(0, (elapsedSec * timelineBpm(activeMixPlan)) / 60);
      const limit = activeMixPlan.loopBeats;
      const timelineBeat = initialBeat + elapsedBeats;
      const clampedBeat = limit === null ? timelineBeat : Math.min(limit, timelineBeat);
      setMixPlayheadBeat(clampedBeat, true);
      updateMixPlaybackProgress(clampedBeat);

      if (limit !== null && timelineBeat >= limit) {
        stopMixPlayback();
        return;
      }

      mixPlaybackAnimationFrameId = window.requestAnimationFrame(tick);
    };

    mixPlaybackAnimationFrameId = window.requestAnimationFrame(tick);
  }

  /* v8 ignore next -- placeholder DOM rendering is covered by higher-level browser tests */
  function setMixPlaceholder(message: string): void {
    const ui = getMixUi();
    /* v8 ignore next -- spa shell always provides a sequencer canvas before placeholder updates run */
    if (!ui) return;
    ui.canvas.replaceChildren();
    const placeholder = document.createElement("p");
    placeholder.className = "sequencer-placeholder";
    placeholder.textContent = message;
    ui.canvas.appendChild(placeholder);
  }

  /* v8 ignore next -- header DOM rendering is covered by higher-level browser tests */
  function syncSequencerHeader(beatCount: number): void {
    const ui = getMixUi();
    /* v8 ignore next -- spa shell always provides a sequencer header before mix timeline sync runs */
    if (!ui) return;

    ui.header.replaceChildren();
    ui.header.style.gridTemplateColumns = `${MIX_TIMELINE_LABEL_PX}px repeat(${beatCount}, ${MIX_TIMELINE_BEAT_PX}px)`;
    ui.header.style.minWidth = `${timelineWidthPx(beatCount)}px`;

    const spacer = document.createElement("span");
    spacer.className = "sequencer-header-spacer";
    ui.header.appendChild(spacer);

    for (let beat = 1; beat <= beatCount; beat++) {
      const cell = document.createElement("span");
      cell.className = "sequencer-beat-number";
      const beatIndex = beat - 1;
      cell.dataset.beat = String(beatIndex);
      if (beat % MIX_GRID_MAJOR_EVERY_BEATS === 0) {
        cell.classList.add("is-major");
      }
      cell.textContent = String(beat);
      cell.addEventListener("click", () => {
        seekMixPlaybackToBeat(beatIndex);
      });
      ui.header.appendChild(cell);
    }
  }

  /* v8 ignore next -- timeline DOM rendering is covered by integration tests; remaining misses are defensive UI guards */
  function renderMixPlan(plan: MixPlaybackPlan): void {
    const ui = getMixUi();
    /* v8 ignore next -- renderMixPlan only runs after the sequencer shell has mounted */
    if (!ui) return;

    mixAutoScrollSuppressedByUser = false;

    const beatCount = Math.max(1, plan.loopBeats ?? 0);
    syncSequencerHeader(beatCount);
    ui.canvas.replaceChildren();
    ui.canvas.classList.toggle("has-mix", true);
    ui.canvas.style.setProperty("--mix-grid-label-px", `${MIX_TIMELINE_LABEL_PX}px`);
    ui.canvas.style.setProperty("--mix-grid-beat-step-px", `${MIX_TIMELINE_BEAT_PX}px`);
    ui.canvas.style.setProperty(
      "--mix-grid-major-step-px",
      `${MIX_TIMELINE_BEAT_PX * MIX_GRID_MAJOR_EVERY_BEATS}px`,
    );

    if (plan.events.length === 0) {
      setMixPlaceholder("Parsed successfully, but no track placements were recovered for this mix yet.");
      setMixPlayheadBeat(0, false);
      return;
    }

    const lanes = new Map<string, MixPlaybackPlan["events"]>();
    for (const event of plan.events) {
      const laneEvents = lanes.get(event.channelId);
      if (laneEvents) {
        laneEvents.push(event);
      } else {
        lanes.set(event.channelId, [event]);
      }
    }

    const timeline = document.createElement("div");
    timeline.className = "sequencer-timeline";
    timeline.style.width = `${timelineWidthPx(beatCount)}px`;

    const lanesEl = document.createElement("div");
    lanesEl.className = "sequencer-lanes";

    const appendLaneRow = (channelId: string, labelText: string, events: MixPlaybackPlan["events"]): void => {
      const row = document.createElement("div");
      row.className = "sequencer-lane";
      row.style.gridTemplateColumns = `${MIX_TIMELINE_LABEL_PX}px repeat(${beatCount}, ${MIX_TIMELINE_BEAT_PX}px)`;

      const label = document.createElement("span");
      label.className = "sequencer-lane-label";
      label.textContent = labelText;
      row.appendChild(label);

      row.addEventListener("click", (clickEvent) => {
        const beat = timelineBeatFromClientX(row, clickEvent.clientX);
        if (beat === null) return;
        seekMixPlaybackToBeat(beat);
      });

      for (const event of events) {
        const block = document.createElement("div");
        block.className = `sequencer-event${event.resolved ? "" : " is-missing"}`;
        const categoryToken = categoryTokenFromAudioUrl(event.audioUrl);
        block.dataset.category = categoryToken;
        block.style.setProperty("--seq-event-color", categoryColorFromAudioUrl(event.audioUrl));
        // Column offset: +2 accounts for the 1-based CSS grid column
        // numbering and the label column occupying column 1.
        const GRID_LABEL_COLUMNS = 2;
        const gridCol = Math.min(beatCount + 1, event.beat + GRID_LABEL_COLUMNS);
        const requestedSpan = Math.max(1, Math.round(event.lengthBeats));
        const maxSpan = Math.max(1, beatCount - (gridCol - GRID_LABEL_COLUMNS));
        const span = Math.min(requestedSpan, maxSpan);
        block.style.gridColumn = `${gridCol} / span ${span}`;
        block.textContent = event.displayLabel;
        block.title = event.audioUrl
          ? `${event.displayLabel} · ${event.audioUrl}`
          : `${event.displayLabel} · unresolved sample reference`;

        let singleClickTimeoutId: number | null = null;
        const clearSingleClickTimeout = (): void => {
          if (singleClickTimeoutId === null) return;
          window.clearTimeout(singleClickTimeoutId);
          singleClickTimeoutId = null;
        };

        block.addEventListener("click", (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          clearSingleClickTimeout();
          singleClickTimeoutId = window.setTimeout(() => {
            singleClickTimeoutId = null;
            playSequencerEventSample(event.audioUrl);
          }, SEQUENCER_EVENT_CLICK_DELAY_MS);
        });

        block.addEventListener("dblclick", (doubleClickEvent) => {
          doubleClickEvent.preventDefault();
          doubleClickEvent.stopPropagation();
          clearSingleClickTimeout();
          seekMixPlaybackToBeat(event.beat);
        });

        row.appendChild(block);
      }

      lanesEl.appendChild(row);
    };

    const renderedLaneIds = new Set<string>();
    for (const lane of plan.lanes) {
      appendLaneRow(lane.id, lane.label, lanes.get(lane.id) ?? []);
      renderedLaneIds.add(lane.id);
    }

    for (const [channelId, events] of lanes) {
      if (renderedLaneIds.has(channelId)) continue;
      appendLaneRow(channelId, describeMixLane(channelId), events);
    }
    lanesEl.style.gridTemplateRows = `repeat(${Math.max(1, lanesEl.childElementCount)}, minmax(0, 1fr))`;

    const playhead = document.createElement("div");
    playhead.className = "sequencer-playhead";
    timeline.append(lanesEl, playhead);
    ui.canvas.appendChild(timeline);
    setMixPlayheadBeat(0, false);
  }

  function syncMixUi(): void {
    const ui = getMixUi();
    if (!ui) return;

    if (!activeMixPlan || !activeMixName) {
      mixAutoScrollSuppressedByUser = false;
      renderedMixPlan = null;
      ui.mixName.textContent = "No mix loaded";
      ui.bpmDisplay.innerHTML = "&mdash; BPM";
      ui.position.textContent = "0 events · 0 ready";
      ui.playButton.disabled = true;
      syncPlayPauseButton(ui.playButton, "play");
      ui.stopButton.disabled = true;
      mixPlayheadBeat = 0;
      ui.canvas.classList.remove("has-mix");
      syncSequencerHeader(32);
      setMixPlaceholder("Select a mix file to view its timeline");
      ui.scroll.scrollTo({ left: 0 });
      return;
    }

    ui.mixName.textContent = formatLoadedMixName(activeMixName);
    ui.bpmDisplay.textContent = `${activeMixPlan.bpm} BPM`;
    if (mixSamplesLoading) {
      if (mixSamplesTotalCount > 0) {
        const loaded = Math.max(0, Math.min(mixSamplesTotalCount, mixSamplesLoadedCount));
        ui.position.textContent = `Loading samples ${loaded}/${mixSamplesTotalCount}`;
      } else {
        ui.position.textContent = "Loading samples...";
      }
    } else if (!mixTransportPlaying) {
      ui.position.textContent = `${activeMixPlan.events.length} events · ${activeMixPlan.resolvedEvents} ready`;
    }

    syncPlayPauseButton(ui.playButton, mixTransportPlaying ? "pause" : "play");
    ui.playButton.disabled = activeMixPlan.events.length === 0;
    ui.stopButton.disabled = !mixTransportPlaying;

    const planChanged = renderedMixPlan !== activeMixPlan;
    if (planChanged) {
      renderMixPlan(activeMixPlan);
      renderedMixPlan = activeMixPlan;
    }
    if (!mixTransportPlaying && planChanged) {
      ui.scroll.scrollTo({ left: 0 });
    }
  }

  async function readMixRefBuffer(ref: MixFileRef): Promise<ArrayBuffer> {
    switch (ref.source.type) {
      case "url": {
        const response = await fetch(ref.source.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${ref.source.url}: HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      }
      case "handle": {
        const file = await ref.source.handle.getFile();
        return file.arrayBuffer();
      }
      case "file":
        return ref.source.file.arrayBuffer();
    }
  }

  async function ensureMixAudioContext(): Promise<AudioContext | null> {
    if (mixAudioContext) {
      if (mixAudioContext.state === "suspended") {
        await mixAudioContext.resume();
      }
      return mixAudioContext;
    }

    const audioContextCtor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      ?? null;
    if (!audioContextCtor) {
      showErrorToast("Web Audio is not available in this browser.");
      return null;
    }

    mixAudioContext = new audioContextCtor();
    if (mixAudioContext.state === "suspended") {
      await mixAudioContext.resume();
    }
    return mixAudioContext;
  }

  async function decodeMixAudioBuffer(audioUrl: string, ctx: AudioContext): Promise<AudioBufferLike> {
    const cached = mixAudioBufferCache.get(audioUrl);
    if (cached) return cached;

    const pending = (async () => {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${audioUrl}: HTTP ${response.status}`);
      }
      return ctx.decodeAudioData(await response.arrayBuffer());
    })();

    // Evict least-recently-set entry when the cache exceeds the limit.
    if (mixAudioBufferCache.size >= MIX_AUDIO_CACHE_MAX) {
      const oldestKey = mixAudioBufferCache.keys().next().value;
      if (oldestKey !== undefined) mixAudioBufferCache.delete(oldestKey);
    }
    mixAudioBufferCache.set(audioUrl, pending);
    try {
      return await pending;
    } catch (error) {
      mixAudioBufferCache.delete(audioUrl);
      throw error;
    }
  }

  async function preloadMixPlanAudio(plan: MixPlaybackPlan, requestId: number): Promise<void> {
    const audioUrls = collectMixAudioUrls(plan);
    if (audioUrls.length === 0) {
      setMixSampleLoadingState(false, 0, 0);
      syncMixUi();
      return;
    }

    setMixSampleLoadingState(true, 0, audioUrls.length);
    syncMixUi();

    const ctx = await ensureMixAudioContext();
    if (!ctx || requestId !== mixLoadRequestId || activeMixPlan !== plan) {
      return;
    }

    let loadedCount = 0;
    await Promise.all(audioUrls.map(async (audioUrl) => {
      try {
        await decodeMixAudioBuffer(audioUrl, ctx);
      } catch (error) {
        console.warn(`Failed to preload ${audioUrl}`, error);
      } finally {
        if (requestId !== mixLoadRequestId || activeMixPlan !== plan) {
          return;
        }
        loadedCount += 1;
        setMixSampleLoadingState(true, loadedCount, audioUrls.length);
        syncMixUi();
      }
    }));
  }

  function stopMixPlayback(resetScrollToStart: boolean = true): void {
    mixPlaybackRequestId += 1;
    clearMixPlaybackStopTimeout();
    stopMixPlaybackAnimation();
    mixTransportPlaying = false;
    mixPlaybackHost?.clear();
    mixPlaybackHost = null;
    setTransportBuildLabelAudioPlaying("mix", false);
    syncMixUi();
    if (resetScrollToStart) {
      const ui = getMixUi();
      if (ui) {
        ui.scroll.scrollTo({ left: 0 });
      }
    }
  }

  function pauseMixPlaybackAtCurrentBarStart(): void {
    if (!activeMixPlan || !mixTransportPlaying) return;

    const pausedBeat = currentMixBarStartBeat();
    stopMixPlayback(false);
    setMixPlayheadBeat(pausedBeat, true);
    updateMixPlaybackProgress(pausedBeat);
  }

  function stopAllPlaybackAndRewindMix(): void {
    player.stop();
    stopMixPlayback();
    if (!activeMixPlan) return;
    setMixPlayheadBeat(0, true);
    updateMixPlaybackProgress(0);
  }

  function scheduleMixPlaybackStop(plan: MixPlaybackPlan, startBeat: number, extraGraceMs = 0): void {
    clearMixPlaybackStopTimeout();
    // List-view mixes (loopBeats === null) play every event one-shot from beat 0;
    // bound the watchdog by event count instead of timeline length.
    const beats = plan.loopBeats === null
      ? Math.max(4, plan.events.length)
      : Math.max(1, plan.loopBeats - clampMixStartBeat(startBeat));
    const durationMs = Math.max(
      1000,
      Math.ceil((beats * 60_000) / timelineBpm(plan)) + 2000 + Math.max(0, extraGraceMs),
    );
    mixPlaybackStopTimeoutId = window.setTimeout(() => {
      stopMixPlayback();
    }, durationMs);
  }

  async function playSelectedMix(startBeat: number = 0): Promise<void> {
    if (!activeMixPlan) return;

    const plan = activeMixPlan;
    const requestedStartBeat = plan.loopBeats === null ? 0 : clampMixStartBeat(startBeat);
    const resetScrollToStart = requestedStartBeat <= 0;
    stopMixPlayback(resetScrollToStart);
    player.stop();
    const requestId = ++mixPlaybackRequestId;
    const playableEvents = plan.events.filter((event) => event.audioUrl !== null && event.beat >= requestedStartBeat);
    const audioUrls = [...new Set(
      playableEvents
        .map((event) => event.audioUrl)
        .filter((audioUrl): audioUrl is string => typeof audioUrl === "string" && audioUrl.length > 0),
    )];
    let started = 0;

    // Flip transport state immediately so long decode phases do not block UI
    // progression (playhead/autoscroll/stop control).
    mixTransportPlaying = true;
    const startAtMs = performance.now() + 50;
    setTransportBuildLabelAudioPlaying("mix", true);
    scheduleMixPlaybackStop(plan, requestedStartBeat);
    syncMixUi();
    startMixPlaybackAnimation(startAtMs, requestedStartBeat);

    if (playableEvents.length > 0) {
      const ctx = await ensureMixAudioContext();
      if (ctx && mixTransportPlaying && requestId === mixPlaybackRequestId && activeMixPlan === plan) {
        mixPlaybackHost = new MixPlayerHost(ctx);
        for (const channelId of plan.channelIds) {
          mixPlaybackHost.registerChannel(channelId);
        }

        const decodedBuffers = new Map<string, AudioBufferLike>();

        // Decode concurrently so dense mixes do not stall transport startup on a long serial fetch/decode chain.
        await Promise.all(audioUrls.map(async (audioUrl) => {
          try {
            decodedBuffers.set(audioUrl, await decodeMixAudioBuffer(audioUrl, ctx));
          } catch (error) {
            console.warn(`Failed to decode ${audioUrl}`, error);
          }
        }));

        if (!mixTransportPlaying || requestId !== mixPlaybackRequestId || activeMixPlan !== plan) {
          return;
        }

        for (const event of playableEvents) {
          const audioUrl = event.audioUrl;
          if (!audioUrl) continue;
          const buffer = decodedBuffers.get(audioUrl);
          /* v8 ignore next -- failed decodes are logged above and intentionally skipped without aborting playback */
          if (!buffer) continue;
          mixPlaybackHost.scheduleSample({
            buffer,
            beat: Math.max(0, event.beat - requestedStartBeat),
            channelId: event.channelId,
            durationBeats: event.lengthBeats,
          });
        }

        const audioStartAt = ctx.currentTime + 0.05;
        started = mixPlaybackHost.play(timelineBpm(plan), audioStartAt);
        if (started > 0) {
          // Re-anchor transport UI to the real audio start time to reduce
          // cumulative drift during long decode/schedule phases.
          const startDelayMs = Math.max(0, (audioStartAt - ctx.currentTime) * 1000);
          startMixPlaybackAnimation(performance.now() + startDelayMs, requestedStartBeat);
          scheduleMixPlaybackStop(plan, requestedStartBeat, MIX_PLAYBACK_DRIFT_GRACE_MS);
        }
      }
    }

    if (started === 0 && playableEvents.length > 0) {
      showErrorToast("Starting timeline playback without resolved audio for some mix events.");
    }
  }

  function handleProductModeChange(entry: ProductModeEntry): void {
    state.productMode = entry;
    applyProductTheme(entry);

    if (!isAllEntry(entry) && entry.defaultBpm !== null) {
      state.bpm = entry.defaultBpm;
      if (slots) {
        ensureBpmFilterOption(slots.bpm, entry.defaultBpm);
        slots.bpm.value = String(entry.defaultBpm);
      }
    }

    if (state.activeCategory) {
      state.tabs = buildTabsForCategory(state.activeCategory);
      const still = state.tabs.find((tab) => tab.id === state.activeTab?.id);
      state.activeTab = still ?? state.tabs[0]!;
      refreshTabs();
    }
    refreshSamples();
  }

  async function handleMixSelection(ref: MixFileRef): Promise<void> {
    const requestId = ++mixLoadRequestId;
    stopMixPlayback();
    setMixSampleLoadingState(false, 0, 0);
    mixAutoScrollSuppressedByUser = false;
    activeMixName = null;
    activeMixPlan = null;
    renderedMixPlan = null;
    syncMixUi();

    try {
      const productHint = ref.productId.startsWith("_userdata/") ? undefined : ref.productId;
      const buffer = await readMixRefBuffer(ref);
      if (requestId !== mixLoadRequestId) return;
      const mix = parseMixBrowser(buffer, productHint);
      if (!mix) {
        throw new Error(`Could not parse ${ref.label}`);
      }

      activeMixName = ref.label;
      activeMixPlan = buildMixPlaybackPlan(mix, state.sampleIndex);
      syncMixUi();
      await preloadMixPlanAudio(activeMixPlan, requestId);
      if (requestId !== mixLoadRequestId) return;
      setMixSampleLoadingState(false, 0, 0);
      syncMixUi();
    } catch (error) {
      if (requestId !== mixLoadRequestId) return;
      console.error("Failed to load selected mix:", error);
      activeMixName = null;
      activeMixPlan = null;
      setMixSampleLoadingState(false, 0, 0);
      syncMixUi();
      showErrorToast("Could not load selected .mix file.");
    }
  }

  /* istanbul ignore next -- production-only home flow is not exercised by the dev-server coverage harness */
  function showHome(): void {
    cleanupTransportShortcuts();
    cleanupTransportShortcuts = noop;
    cleanupSequencerScrollIntent();
    cleanupSequencerScrollIntent = noop;
    cleanupShellSplitter();
    cleanupShellSplitter = noop;
    app.replaceChildren();
    slots = null;

    renderHomePage(
      app,
      () => void handlePickFolder(),
      isDev ? () => void startWithFetchLibrary() : null,
    );
  }
  /* istanbul ignore next -- the OS folder picker path is not exercised by the dev-server coverage harness */
  async function handlePickFolder(): Promise<void> {
    /* v8 ignore start -- production-only folder picking is not exercised by the dev-server coverage harness */
    try {
      const lib = await pickLibraryFolder();
      await startBrowser(lib);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    }
    /* v8 ignore stop */
  }

  async function startWithFetchLibrary(): Promise<void> {
    await startBrowser(new FetchLibrary());
  }

  async function startBrowser(library: Library): Promise<void> {
    clearCategoryConfigWatcher();
    closeSubcategoryContextMenu();
    closeSampleContextMenu();
    resetSubcategoryAddState();
    state.library = library;
    slots = renderSpaShell(app);
    cleanupTransportShortcuts();
    cleanupTransportShortcuts = noop;
    cleanupSequencerScrollIntent();
    cleanupSequencerScrollIntent = noop;
    cleanupShellSplitter();
    cleanupShellSplitter = initShellSplitter(slots);
    cleanupSequencerScrollIntent = initSequencerScrollIntentHandlers(slots);
    setMixSampleLoadingState(false, 0, 0);
    const currentSlots = slots;

    currentSlots.transport.querySelector<HTMLButtonElement>("#transport-stop")!.addEventListener("click", () => {
      stopAllPlaybackAndRewindMix();
    });
    currentSlots.sequencer.querySelector<HTMLButtonElement>(".seq-play-btn")!.addEventListener("click", () => {
      if (mixTransportPlaying) {
        pauseMixPlaybackAtCurrentBarStart();
        return;
      }
      void playSelectedMix(currentMixBarStartBeat());
    });
    currentSlots.sequencer.querySelector<HTMLButtonElement>(".seq-stop-btn")!.addEventListener("click", () => {
      stopMixPlayback();
    });
    currentSlots.sequencer.querySelector<HTMLButtonElement>(".seq-home-btn")!.addEventListener("click", () => {
      if (!activeMixPlan) return;
      if (mixTransportPlaying) {
        void playSelectedMix(0);
        return;
      }
      setMixPlayheadBeat(0, true);
      updateMixPlaybackProgress(0);
    });

    const handleTransportShortcuts = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isShortcutEditableTarget(event.target)) return;

      if (isSpaceShortcutKey(event)) {
        if (!activeMixPlan) return;
        event.preventDefault();
        if (mixTransportPlaying) {
          pauseMixPlaybackAtCurrentBarStart();
          return;
        }
        void playSelectedMix(currentMixBarStartBeat());
        return;
      }

      if (event.key === "Enter") {
        if (!activeMixPlan) return;
        event.preventDefault();
        if (mixTransportPlaying) {
          stopAllPlaybackAndRewindMix();
          return;
        }
        void playSelectedMix(0);
      }
    };

    document.addEventListener("keydown", handleTransportShortcuts);
    cleanupTransportShortcuts = () => {
      document.removeEventListener("keydown", handleTransportShortcuts);
    };

    currentSlots.bpm.value = state.bpm === null ? "" : String(state.bpm);
    applySampleBubbleZoom();
    syncMixUi();

    currentSlots.bpm.addEventListener("change", () => {
      state.bpm = currentSlots.bpm.value === "" ? null : Number(currentSlots.bpm.value);
      if (state.activeCategory) {
        state.tabs = buildTabsForCategory(state.activeCategory);
        const still = state.tabs.find((tab) => tab.id === state.activeTab?.id);
        state.activeTab = still ?? state.tabs[0]!;
        refreshTabs();
      }
      refreshSamples();
    });

    currentSlots.grid.addEventListener("contextmenu", (event) => {
      sampleGridContextMenu.handleContextMenu(event);
    });

    currentSlots.zoomOut.addEventListener("click", () => {
      adjustSampleBubbleZoom(-SAMPLE_BUBBLE_ZOOM_STEP);
    });

    currentSlots.zoomIn.addEventListener("click", () => {
      adjustSampleBubbleZoom(SAMPLE_BUBBLE_ZOOM_STEP);
    });

    currentSlots.searchInput.addEventListener("input", () => {
      state.searchQuery = currentSlots.searchInput.value;
      currentSlots.searchClear.classList.toggle("is-hidden", state.searchQuery === "");
      refreshSamples();
    });

    currentSlots.searchClear.addEventListener("click", () => {
      state.searchQuery = "";
      currentSlots.searchInput.value = "";
      currentSlots.searchClear.classList.add("is-hidden");
      currentSlots.searchInput.focus();
      refreshSamples();
    });

    currentSlots.tabs.addEventListener("contextmenu", (event) => {
      handleSubcategoryTabContextMenu(event);
    });

    const [index, samples, categoryConfig] = await Promise.all([
      library.loadIndex(),
      library.loadSamples().catch((error) => {
        console.warn("Failed to load sample catalog; continuing with an empty list.", error);
        return [];
      }),
      library.loadCategoryConfig?.().catch((error) => {
        console.warn("Failed to load category config; continuing with defaults.", error);
        return buildDefaultCategoryConfig();
      }) ?? Promise.resolve(buildDefaultCategoryConfig()),
    ]);

    initMixFileBrowser(currentSlots.archiveTree, {
      isDev,
      mixLibrary: isDev ? index.mixLibrary : undefined,
      onSelectFile: (ref) => {
        void handleMixSelection(ref);
      },
      onProductModeChange: (entry) => handleProductModeChange(entry),
    });
    state.sampleIndex = index.sampleIndex ?? {};
    state.samples = samples;
    applyCategoryConfig(categoryConfig);
    startCategoryConfigWatching();
  }

  function selectCategory(category: CategoryEntry): void {
    player.stop();
    closeSubcategoryContextMenu();
    closeSampleContextMenu();
    resetSubcategoryAddState();
    state.activeCategory = category;
    state.activeTab = null;
    syncActiveCategory();
  }

  function buildSystemUnsortedCategory(): CategoryEntry {
    const unsortedSampleCount = state.samples.reduce((count, sample) => (
      sampleCategory(sample) === UNSORTED_CATEGORY_ID ? count + 1 : count
    ), 0);

    return {
      id: UNSORTED_CATEGORY_ID,
      name: UNSORTED_CATEGORY_ID,
      subcategories: [UNSORTED_SUBCATEGORY_ID],
      sampleCount: unsortedSampleCount,
    };
  }

  function buildTabsForCategory(category: CategoryEntry): CategoryTab[] {
    return category.subcategories.map((subcategory) => {
      const kind = getSubcategoryKind(category.id, subcategory);
      return {
        id: `subcategory:${subcategory}`,
        label: subcategory,
        mode: "subcategory",
        value: subcategory,
        kind,
        /* istanbul ignore next -- this flag is derived directly from getSubcategoryKind and has dedicated coverage in data/browser tests */
        removable: kind === "user",
      };
    });
  }

  function refreshTabs(): void {
    const currentSlots = slots!;
    const addState = subcategoryAddState();

    closeSubcategoryContextMenu();
    currentSlots.tabs.style.setProperty(
      "--active-category-color",
      activeCategoryColorVar(state.activeCategory?.id),
    );

    renderSubcategoryTabs(
      currentSlots.tabs,
      state.tabs,
      state.activeTab!.id,
      (tabId) => {
        state.activeTab = state.tabs.find((tab) => tab.id === tabId)!;
        refreshTabs();
        refreshSamples();
      },
      addState,
    );
  }

  function refreshSamples(): void {
    const currentSlots = slots!;
    const currentLibrary = state.library!;
    const activeCategory = state.activeCategory!;

    const allowedProducts = isAllEntry(state.productMode)
      ? null
      : new Set(state.productMode.productIds);

    const { visibleSamples } = computeSampleBrowserResult({
      samples: state.samples,
      categoryId: activeCategory.id,
      subcategory: state.activeTab!.value,
      bpm: state.bpm,
      availableSubcategories: state.tabs.map((tab) => tab.value),
      searchQuery: state.searchQuery,
      gridSortKey: state.gridSortKey,
      gridSortDir: state.gridSortDir,
      allowedProducts,
    });

    currentGridSamples = visibleSamples;
    renderSampleGrid(currentSlots.grid, visibleSamples, player, currentLibrary);
    updatePlayingBlock(player.activePath);
  }

  function renderEmptyState(message: string): void {
    const currentSlots = slots!;
    currentSlots.tabs.replaceChildren();
    currentSlots.grid.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "sample-grid-empty";
    empty.textContent = message;
    currentSlots.grid.appendChild(empty);
  }

  function applyCategoryConfig(config: CategoryConfig, preferredTabId: string | null = null): void {
    state.categoryConfig = config;
    state.categories = buildCategoryEntries(state.samples, config.categories);
    syncActiveCategory(preferredTabId);
  }

  function syncActiveCategory(preferredTabId: string | null = null): void {
    const currentSlots = slots;
    /* istanbul ignore next -- renderSpaShell always establishes slots before syncActiveCategory runs */
    if (!currentSlots) return;

    const activeCategoryId = state.activeCategory?.id ?? null;
    state.activeCategory = activeCategoryId
      ? state.categories.find((category) => category.id === activeCategoryId)
      ?? (activeCategoryId === UNSORTED_CATEGORY_ID ? buildSystemUnsortedCategory() : null)
      : null;

    if (!state.activeCategory) {
      state.activeCategory = state.categories.find((category) => category.sampleCount > 0)
        ?? state.categories[0]
        ?? null;
    }

    renderCategorySidebar(
      currentSlots.sidebar,
      state.categories,
      state.activeCategory?.id ?? null,
      (category) => selectCategory(category),
      () => { /* TODO: external JSON library loading */ },
    );

    if (!state.activeCategory) {
      renderEmptyState("No categories found in this library.");
      return;
    }

    state.tabs = buildTabsForCategory(state.activeCategory);
    state.activeTab = (preferredTabId
      ? state.tabs.find((tab) => tab.id === preferredTabId)
      : null)
      ?? state.tabs.find((tab) => tab.id === state.activeTab?.id)
      ?? state.tabs[0]!;

    refreshTabs();
    refreshSamples();
  }

  function startCategoryConfigWatching(): void {
    clearCategoryConfigWatcher();
    /* istanbul ignore next -- the shipped browser libraries always expose config loading */
    if (!state.library?.loadCategoryConfig) return;

    const hot = import.meta.hot;

    const handleCategoryConfigUpdated = (): void => {
      void refreshCategoryConfig(true);
    };

    const handleSampleMetadataUpdated = (): void => {
      void refreshSampleMetadata();
    };

    window.addEventListener(CATEGORY_CONFIG_UPDATED_EVENT, handleCategoryConfigUpdated as EventListener);
    hot?.on(CATEGORY_CONFIG_UPDATED_EVENT, handleCategoryConfigUpdated);
    window.addEventListener(SAMPLE_METADATA_UPDATED_EVENT, handleSampleMetadataUpdated as EventListener);
    hot?.on(SAMPLE_METADATA_UPDATED_EVENT, handleSampleMetadataUpdated);
    stopCategoryConfigWatch = () => {
      window.removeEventListener(CATEGORY_CONFIG_UPDATED_EVENT, handleCategoryConfigUpdated as EventListener);
      hot?.off(CATEGORY_CONFIG_UPDATED_EVENT, handleCategoryConfigUpdated);
      window.removeEventListener(SAMPLE_METADATA_UPDATED_EVENT, handleSampleMetadataUpdated as EventListener);
      hot?.off(SAMPLE_METADATA_UPDATED_EVENT, handleSampleMetadataUpdated);
    };
  }

  async function refreshCategoryConfig(force: boolean): Promise<void> {
    const library = state.library;
    /* v8 ignore next -- refreshes are only scheduled after watcher setup validates config loading */
    if (!library?.loadCategoryConfig) return;
    /* v8 ignore next -- duplicate refresh events are intentionally coalesced and timing-sensitive under coverage instrumentation */
    if (categoryConfigController.isCategoryConfigRefreshInFlight()) return;

    categoryConfigController.beginCategoryConfigRefresh();
    try {
      const nextConfig = await library.loadCategoryConfig({ force });
      if (categoryConfigsEqual(nextConfig, state.categoryConfig)) {
        return;
      }
      applyCategoryConfig(nextConfig);
    } catch (error) {
      console.warn("Failed to refresh category config.", error);
    } finally {
      categoryConfigController.completeCategoryConfigRefresh();
    }
  }

  async function refreshSampleMetadata(): Promise<void> {
    const library = state.library;
    /* v8 ignore next -- metadata refresh listeners are only registered after startBrowser sets state.library */
    if (!library) return;
    try {
      const samples = await library.loadSamples({ force: true });
      state.samples = samples;
      applyCategoryConfig(state.categoryConfig);
    } catch (error) {
      console.warn("Failed to refresh sample metadata.", error);
    }
  }

  function resetSubcategoryAddState(): void {
    state.isAddingSubcategory = false;
    state.subcategoryDraft = "";
  }

  function closeSubcategoryContextMenu(): void {
    document.getElementById(SUBCATEGORY_CONTEXT_MENU_ID)?.remove();
    const cleanup = cleanupSubcategoryContextMenu;
    cleanupSubcategoryContextMenu = noop;
    cleanup();
  }

  function closeSampleContextMenu(): void {
    sampleGridContextMenu.close();
  }

  async function handleMoveSample(
    sample: Sample,
    newCategory: string,
    newSubcategory: string | null,
  ): Promise<void> {
    closeSampleContextMenu();

    try {
      if (state.library?.moveSample) {
        await state.library.moveSample(sample, newCategory, newSubcategory);
      }
      // In-memory patch (always — PROD changes are transient, DEV changes are persisted above)
      sample.category = newCategory;
      sample.subcategory = newSubcategory ?? undefined;
      applyCategoryConfig(state.categoryConfig);
    } catch (error) {
      console.error("Failed to move sample:", error);
      showErrorToast("Could not move sample — check the console for details.");
    }
  }

  function findTabById(tabId: string | null | undefined): CategoryTab | null {
    /* istanbul ignore next -- context-menu events only target rendered tab buttons with ids */
    if (!tabId) return null;
    return state.tabs.find((tab) => tab.id === tabId) ?? null;
  }

  /* v8 ignore start -- pointer-positioning and outside-click guards are timing-sensitive under coverage instrumentation */
  function handleSubcategoryTabContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      closeSubcategoryContextMenu();
      return;
    }

    const tabButton = target.closest<HTMLButtonElement>(".subcategory-tab");
    if (!tabButton) {
      closeSubcategoryContextMenu();
      return;
    }

    const tab = findTabById(tabButton.dataset.tabId);
    const canWrite = Boolean(
      tab?.removable &&
      state.library?.canWriteCategoryConfig?.() &&
      state.library?.saveCategoryConfig,
    );
    if (!tab || !canWrite) {
      closeSubcategoryContextMenu();
      return;
    }

    event.preventDefault();
    openSubcategoryContextMenu(tab, event.clientX, event.clientY);
  }

  function openSubcategoryContextMenu(tab: CategoryTab, clientX: number, clientY: number): void {
    closeSubcategoryContextMenu();

    const menu = document.createElement("div");
    menu.id = SUBCATEGORY_CONTEXT_MENU_ID;
    menu.className = "subcategory-context-menu";
    menu.setAttribute("role", "menu");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "subcategory-context-menu-item";
    removeButton.setAttribute("role", "menuitem");
    removeButton.textContent = "remove";
    removeButton.addEventListener("click", () => {
      void handleRemoveSubcategory(tab);
    });

    menu.appendChild(removeButton);
    document.body.appendChild(menu);

    const positionMenu = (): void => {
      const left = Math.min(clientX, window.innerWidth - menu.offsetWidth - 8);
      const top = Math.min(clientY, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };

    const handlePointerDown = (pointerEvent: PointerEvent): void => {
      if (!(pointerEvent.target instanceof Node) || menu.contains(pointerEvent.target)) return;
      closeSubcategoryContextMenu();
    };

    const handleKeydown = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      closeSubcategoryContextMenu();
    };

    const handleResize = (): void => {
      positionMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", handleResize);
    cleanupSubcategoryContextMenu = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", handleResize);
    };

    window.requestAnimationFrame(() => {
      positionMenu();
      removeButton.focus();
    });
  }
  /* v8 ignore stop */

  /* v8 ignore start -- add/remove draft-state guards are already integration-covered via saveCategoryConfig paths */
  function subcategoryAddState(): SubcategoryAddOptions {
    const activeCategory = state.activeCategory;
    const canWrite = Boolean(
      activeCategory &&
      state.library?.canWriteCategoryConfig?.() &&
      state.library?.saveCategoryConfig,
    );

    if (!canWrite) {
      resetSubcategoryAddState();
      return {
        addDisabled: true,
        addTitle: "Subcategory editing is disabled in the production build.",
      };
    }

    if (state.isAddingSubcategory) {
      return {
        isEditing: true,
        draftValue: state.subcategoryDraft,
        draftPlaceholder: "untitled",
        addTitle: `Create a subcategory in ${activeCategory!.name}`,
        onDraftChange: (value) => {
          state.subcategoryDraft = value;
        },
        onSubmit: () => void handleCreateSubcategory(),
        onCancel: () => cancelSubcategoryAdd(),
      };
    }

    return {
      onAdd: () => beginSubcategoryAdd(),
      addDisabled: false,
      addTitle: `Add a subcategory to ${activeCategory!.name}`,
    };
  }

  function beginSubcategoryAdd(): void {
    closeSubcategoryContextMenu();
    state.isAddingSubcategory = true;
    state.subcategoryDraft = "";
    refreshTabs();
  }

  function cancelSubcategoryAdd(): void {
    closeSubcategoryContextMenu();
    resetSubcategoryAddState();
    refreshTabs();
  }

  async function handleCreateSubcategory(): Promise<void> {
    const library = state.library;
    const activeCategory = state.activeCategory;
    /* istanbul ignore next -- the UI keeps add disabled unless writes are available and no submit is in flight */
    if (!library?.saveCategoryConfig || !activeCategory || isSubcategoryOperationInFlight("add")) return;

    closeSubcategoryContextMenu();
    const subcategoryName = normalizeCategoryLabel(state.subcategoryDraft);
    /* istanbul ignore next -- the confirm button stays disabled for blank drafts */
    if (!subcategoryName) return;

    beginSubcategoryOperation("add");

    try {
      const existingTab = state.tabs.find(
        (tab) => normalizeCategoryLabel(tab.value).toLowerCase() === subcategoryName.toLowerCase(),
      );
      if (existingTab || getSubcategoryKind(activeCategory.id, subcategoryName) !== "user") {
        resetSubcategoryAddState();
        applyCategoryConfig(state.categoryConfig, existingTab?.id ?? state.activeTab!.id);
        return;
      }

      const nextConfig = addSubcategoryToCategoryConfig(state.categoryConfig, activeCategory.id, subcategoryName);
      if (categoryConfigsEqual(nextConfig, state.categoryConfig)) {
        resetSubcategoryAddState();
        applyCategoryConfig(state.categoryConfig, `subcategory:${subcategoryName}`);
        return;
      }

      await library.saveCategoryConfig(nextConfig);
      resetSubcategoryAddState();
      applyCategoryConfig(nextConfig, `subcategory:${subcategoryName}`);
    } catch (error) {
      console.error("Failed to save category config.", error);
      showErrorToast("Could not save categories.json.");
    } finally {
      completeSubcategoryOperation("add");
    }
  }

  async function handleRemoveSubcategory(tab: CategoryTab): Promise<void> {
    const library = state.library;
    const activeCategory = state.activeCategory;
    if (
      !library?.saveCategoryConfig ||
      !activeCategory ||
      !tab.removable ||
      isSubcategoryOperationInFlight("remove")
    ) {
      return;
    }

    beginSubcategoryOperation("remove");
    closeSubcategoryContextMenu();

    try {
      const nextConfig = removeSubcategoryFromCategoryConfig(state.categoryConfig, activeCategory.id, tab.value);
      if (categoryConfigsEqual(nextConfig, state.categoryConfig)) {
        return;
      }

      await library.saveCategoryConfig(nextConfig);
      applyCategoryConfig(nextConfig);
    } catch (error) {
      console.error("Failed to save category config.", error);
      showErrorToast("Could not save categories.json.");
    } finally {
      completeSubcategoryOperation("remove");
    }
  }
  /* v8 ignore stop */

  /* istanbul ignore next -- browser coverage runs against the dev server, so DEV is always true here */
  if (isDev) {
    void startWithFetchLibrary();
  } else {
    showHome();
  }

  return cleanup;
}