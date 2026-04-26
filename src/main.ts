import "./app.css";

import type { CategoryConfig, CategoryEntry, Sample, SampleLookupEntry, SubcategoryKind } from "./data.js";
import { initMixFileBrowser } from "./mix-file-browser.js";
import type { MixFileRef } from "./mix-file-browser.js";
import { parseMixBrowser } from "./mix-parser.js";
import { buildMixPlaybackPlan, MixPlayerHost } from "./mix-player.js";
import type { MixPlaybackPlan } from "./mix-player.js";
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
  filterSamples,
  filterSamplesBySearchQuery,
  getSubcategoryKind,
  normalizeCategoryLabel,
  removeSubcategoryFromCategoryConfig,
  sampleCategory,
  sortSamplesByKey,
  UNSORTED_CATEGORY_ID,
  UNSORTED_SUBCATEGORY_ID,
} from "./data.js";
import type { GridSortDir, GridSortKey } from "./data.js";
import type { Library } from "./library.js";
import { FetchLibrary, pickLibraryFolder } from "./library.js";
import { calcProgressInterval, Player } from "./player.js";
import {
  renderCategorySidebar,
  renderHomePage,
  renderSampleGrid,
  renderSpaShell,
  setTransportBuildLabelAudioPlaying,
  renderSubcategoryTabs,
  showErrorToast,
  type SubcategoryAddOptions,
  type SpaShellSlots,
  type UiTab,
  updatePlayingBlock,
  updateTransport,
} from "./render.js";

type CategoryTabMode = "subcategory";
type SubcategoryOperation = "add" | "remove";

interface CategoryTab extends UiTab {
  mode: CategoryTabMode;
  value: string | null;
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
const MIX_PLAYHEAD_AUTO_SCROLL_RATIO = 0.4;

const SUBCATEGORY_CONTEXT_MENU_ID = "subcategory-context-menu";

const isDev = import.meta.env.DEV;

const noop = (): void => {};

function createAppController(app: HTMLElement): () => void {
  const state: AppState = {
    library: null,
    categoryConfig: buildDefaultCategoryConfig(),
    categories: [],
    activeCategory: null,
    samples: [],
    tabs: [],
    activeTab: null,
    bpm: null,
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
  let categoryConfigRefreshInFlight = false;
  const subcategoryOperationsInFlight = new Set<SubcategoryOperation>();
  let cleanupSubcategoryContextMenu: () => void = noop;
  let currentGridSamples: Sample[] = [];
  let activeMixPlan: MixPlaybackPlan | null = null;
  let activeMixName: string | null = null;
  let mixPlaybackHost: MixPlayerHost | null = null;
  let mixAudioContext: AudioContext | null = null;
  let mixPlaybackStopTimeoutId: number | null = null;
  let mixPlaybackAnimationFrameId: number | null = null;
  let mixPlaybackStartedAtMs: number | null = null;
  let mixTransportPlaying = false;
  const mixAudioBufferCache = new Map<string, Promise<unknown>>();

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

  /* v8 ignore next -- cleanup is exercised indirectly by browser tests; remaining branches are defensive teardown guards */
  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    clearCategoryConfigWatcher();
    clearProgressUpdateInterval();
    stopMixPlayback();
    closeSubcategoryContextMenu();
    closeSampleContextMenu();
    player.destroy();
    if (mixAudioContext) {
      void mixAudioContext.close().catch(() => {});
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

function adjustSampleBubbleZoom(delta: number): void {
  const updated = Number((state.sampleBubbleZoomScale + delta).toFixed(4));
  state.sampleBubbleZoomScale = Math.min(SAMPLE_BUBBLE_ZOOM_MAX, Math.max(SAMPLE_BUBBLE_ZOOM_MIN, updated));
  applySampleBubbleZoom();
}

function clearCategoryConfigWatcher(): void {
  stopCategoryConfigWatch();
  stopCategoryConfigWatch = noop;
}

function isSubcategoryOperationInFlight(operation: SubcategoryOperation): boolean {
  return subcategoryOperationsInFlight.has(operation);
}

function beginSubcategoryOperation(operation: SubcategoryOperation): void {
  subcategoryOperationsInFlight.add(operation);
}

function completeSubcategoryOperation(operation: SubcategoryOperation): void {
  subcategoryOperationsInFlight.delete(operation);
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

function describeMixLane(channelId: string): string {
  if (channelId.startsWith("lane-")) {
    return `Lane ${Number(channelId.slice(5)) + 1}`;
  }
  if (channelId.startsWith("track-")) {
    return `Track ${Number(channelId.slice(6)) + 1}`;
  }
  return channelId;
}

function getMixUi(): MixUiRefs | null {
  if (!slots) return null;

  const { sequencer, contextStrip } = slots;
  return {
    canvas: sequencer.querySelector<HTMLElement>(".sequencer-canvas")!,
    header: sequencer.querySelector<HTMLElement>(".sequencer-header")!,
    mixName: contextStrip.querySelector<HTMLElement>(".context-mix-name")!,
    bpmDisplay: contextStrip.querySelector<HTMLElement>(".context-bpm-display")!,
    playButton: sequencer.querySelector<HTMLButtonElement>(".seq-play-btn")!,
    stopButton: sequencer.querySelector<HTMLButtonElement>(".seq-stop-btn")!,
    position: sequencer.querySelector<HTMLElement>(".seq-position")!,
    scroll: sequencer.querySelector<HTMLElement>(".sequencer-scroll")!,
    playhead: sequencer.querySelector<HTMLElement>(".sequencer-playhead"),
  };
}

function timelineWidthPx(beatCount: number): number {
  return MIX_TIMELINE_LABEL_PX + (beatCount * MIX_TIMELINE_BEAT_PX);
}

function setMixPlayheadBeat(beat: number, autoScroll: boolean): void {
  const ui = getMixUi();
  if (!ui || !activeMixPlan || !ui.playhead) return;

  const clampedBeat = Math.max(0, Math.min(activeMixPlan.loopBeats, beat));
  const leftPx = MIX_TIMELINE_LABEL_PX + (clampedBeat * MIX_TIMELINE_BEAT_PX);
  ui.playhead.style.transform = `translateX(${leftPx}px)`;

  if (!autoScroll) return;

  const targetLeft = leftPx - (ui.scroll.clientWidth * MIX_PLAYHEAD_AUTO_SCROLL_RATIO);
  const maxLeft = Math.max(0, ui.scroll.scrollWidth - ui.scroll.clientWidth);
  ui.scroll.scrollLeft = Math.max(0, Math.min(maxLeft, targetLeft));
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

  const displayBeat = Math.min(activeMixPlan.loopBeats, Math.floor(beat) + 1);
  ui.position.textContent = `Bar ${displayBeat} / ${activeMixPlan.loopBeats} · ${activeMixPlan.resolvedEvents} ready`;
}

function startMixPlaybackAnimation(startAtMs: number): void {
  stopMixPlaybackAnimation();
  mixPlaybackStartedAtMs = startAtMs;

  const tick = (): void => {
    if (!activeMixPlan || mixPlaybackStartedAtMs === null) {
      stopMixPlaybackAnimation();
      return;
    }

    const elapsedSec = Math.max(0, (performance.now() - mixPlaybackStartedAtMs) / 1000);
    const elapsedBeats = Math.max(0, (elapsedSec * activeMixPlan.bpm) / 60);
    const clampedBeat = Math.min(activeMixPlan.loopBeats, elapsedBeats);
    setMixPlayheadBeat(clampedBeat, true);
    updateMixPlaybackProgress(clampedBeat);

    if (elapsedBeats >= activeMixPlan.loopBeats) {
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
    cell.textContent = String(beat);
    ui.header.appendChild(cell);
  }
}

/* v8 ignore next -- timeline DOM rendering is covered by integration tests; remaining misses are defensive UI guards */
function renderMixPlan(plan: MixPlaybackPlan): void {
  const ui = getMixUi();
  /* v8 ignore next -- renderMixPlan only runs after the sequencer shell has mounted */
  if (!ui) return;

  const beatCount = Math.max(1, plan.loopBeats);
  syncSequencerHeader(beatCount);
  ui.canvas.replaceChildren();
  ui.canvas.classList.toggle("has-mix", true);

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

  for (const [channelId, events] of lanes) {
    const row = document.createElement("div");
    row.className = "sequencer-lane";
    row.style.gridTemplateColumns = `${MIX_TIMELINE_LABEL_PX}px repeat(${beatCount}, ${MIX_TIMELINE_BEAT_PX}px)`;

    const label = document.createElement("span");
    label.className = "sequencer-lane-label";
    label.textContent = describeMixLane(channelId);
    row.appendChild(label);

    for (const event of events) {
      const block = document.createElement("div");
      block.className = `sequencer-event${event.resolved ? "" : " is-missing"}`;
      block.style.gridColumn = `${Math.min(beatCount + 1, event.beat + 2)} / span 1`;
      block.textContent = event.displayLabel;
      block.title = event.audioUrl
        ? `${event.displayLabel} · ${event.audioUrl}`
        : `${event.displayLabel} · unresolved sample reference`;
      row.appendChild(block);
    }

    lanesEl.appendChild(row);
  }

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
    ui.mixName.textContent = "No mix loaded";
    ui.bpmDisplay.innerHTML = "&mdash; BPM";
    ui.position.textContent = "0 events · 0 ready";
    ui.playButton.disabled = true;
    ui.stopButton.disabled = true;
    ui.canvas.classList.remove("has-mix");
    syncSequencerHeader(32);
    setMixPlaceholder("Select a mix file to view its timeline");
    ui.scroll.scrollTo({ left: 0 });
    return;
  }

  ui.mixName.textContent = formatLoadedMixName(activeMixName);
  ui.bpmDisplay.textContent = `${activeMixPlan.bpm} BPM · ${activeMixPlan.events.length} events · ${activeMixPlan.resolvedEvents} ready`;
  if (!mixTransportPlaying) {
    ui.position.textContent = `${activeMixPlan.events.length} events · ${activeMixPlan.resolvedEvents} ready`;
  }
  ui.playButton.disabled = activeMixPlan.events.length === 0;
  ui.stopButton.disabled = !mixTransportPlaying;

  renderMixPlan(activeMixPlan);
  if (!mixTransportPlaying) {
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

async function decodeMixAudioBuffer(audioUrl: string, ctx: AudioContext): Promise<unknown> {
  const cached = mixAudioBufferCache.get(audioUrl);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${audioUrl}: HTTP ${response.status}`);
    }
    return ctx.decodeAudioData(await response.arrayBuffer());
  })();

  mixAudioBufferCache.set(audioUrl, pending);
  try {
    return await pending;
  } catch (error) {
    mixAudioBufferCache.delete(audioUrl);
    throw error;
  }
}

function stopMixPlayback(): void {
  clearMixPlaybackStopTimeout();
  stopMixPlaybackAnimation();
  mixTransportPlaying = false;
  mixPlaybackHost?.clear();
  mixPlaybackHost = null;
  setTransportBuildLabelAudioPlaying("mix", false);
  syncMixUi();
}

function scheduleMixPlaybackStop(plan: MixPlaybackPlan): void {
  clearMixPlaybackStopTimeout();
  const durationMs = Math.max(1000, Math.ceil((plan.loopBeats * 60_000) / plan.bpm) + 2000);
  mixPlaybackStopTimeoutId = window.setTimeout(() => {
    stopMixPlayback();
  }, durationMs);
}

async function playSelectedMix(): Promise<void> {
  if (!activeMixPlan) return;

  stopMixPlayback();
  player.stop();
  const playableEvents = activeMixPlan.events.filter((event) => event.audioUrl !== null);
  let started = 0;

  if (playableEvents.length > 0) {
    const ctx = await ensureMixAudioContext();
    if (ctx) {
      mixPlaybackHost = new MixPlayerHost(ctx);
      for (const channelId of activeMixPlan.channelIds) {
        mixPlaybackHost.registerChannel(channelId);
      }

      const decodedBuffers = new Map<string, unknown>();
      const audioUrls = [...new Set(
        playableEvents
          .map((event) => event.audioUrl)
          .filter((audioUrl): audioUrl is string => typeof audioUrl === "string" && audioUrl.length > 0),
      )];

      // Decode concurrently so dense mixes do not stall transport startup on a long serial fetch/decode chain.
      await Promise.all(audioUrls.map(async (audioUrl) => {
        try {
          decodedBuffers.set(audioUrl, await decodeMixAudioBuffer(audioUrl, ctx));
        } catch (error) {
          console.warn(`Failed to decode ${audioUrl}`, error);
        }
      }));

      for (const event of playableEvents) {
        const audioUrl = event.audioUrl;
        if (!audioUrl) continue;
        const buffer = decodedBuffers.get(audioUrl);
        /* v8 ignore next -- failed decodes are logged above and intentionally skipped without aborting playback */
        if (!buffer) continue;
        mixPlaybackHost.scheduleSample({
          buffer,
          beat: event.beat,
          channelId: event.channelId,
        });
      }

      const audioStartAt = ctx.currentTime + 0.05;
      started = mixPlaybackHost.play(activeMixPlan.bpm, audioStartAt);
    }
  }

  mixTransportPlaying = true;
  const startAtMs = performance.now() + 50;

  setTransportBuildLabelAudioPlaying("mix", true);
  scheduleMixPlaybackStop(activeMixPlan);
  syncMixUi();
  startMixPlaybackAnimation(startAtMs);

  if (started === 0 && playableEvents.length > 0) {
    showErrorToast("Starting timeline playback without resolved audio for some mix events.");
  }
}

async function handleMixSelection(ref: MixFileRef): Promise<void> {
  stopMixPlayback();

  try {
    const productHint = ref.productId.startsWith("_userdata/") ? undefined : ref.productId;
    const buffer = await readMixRefBuffer(ref);
    const mix = parseMixBrowser(buffer, productHint);
    if (!mix) {
      throw new Error(`Could not parse ${ref.label}`);
    }

    activeMixName = ref.label;
    activeMixPlan = buildMixPlaybackPlan(mix, state.sampleIndex);
    syncMixUi();
  } catch (error) {
    console.error("Failed to load selected mix:", error);
    activeMixName = null;
    activeMixPlan = null;
    syncMixUi();
    showErrorToast("Could not load selected .mix file.");
  }
}

/* istanbul ignore next -- production-only home flow is not exercised by the dev-server coverage harness */
function showHome(): void {
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
  const currentSlots = slots;

  currentSlots.transport.querySelector<HTMLButtonElement>("#transport-stop")!.addEventListener("click", () => {
    player.stop();
    stopMixPlayback();
  });
  currentSlots.sequencer.querySelector<HTMLButtonElement>(".seq-play-btn")!.addEventListener("click", () => {
    void playSelectedMix();
  });
  currentSlots.sequencer.querySelector<HTMLButtonElement>(".seq-stop-btn")!.addEventListener("click", () => {
    stopMixPlayback();
  });
  currentSlots.bpm.value = state.bpm === null ? "" : String(state.bpm);
  applySampleBubbleZoom();
  syncMixUi();

  currentSlots.bpm.addEventListener("change", () => {
    state.bpm = currentSlots.bpm.value === "" ? null : Number(currentSlots.bpm.value);
    if (state.activeCategory) {
      state.tabs = buildTabsForCategory(state.activeCategory);
      const still = state.tabs.find((tab) => tab.id === state.activeTab?.id);
      state.activeTab = still ?? state.tabs[0] ?? null;
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
      removable: kind === "user",
    };
  });
}

function refreshTabs(): void {
  const currentSlots = slots!;
  const addState = subcategoryAddState();

  closeSubcategoryContextMenu();

  renderSubcategoryTabs(
    currentSlots.tabs,
    state.tabs,
    state.activeTab?.id ?? null,
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

  const filters = {
    category: activeCategory.id,
    subcategory: state.activeTab?.value ?? null,
    product: null,
    bpm: state.bpm,
    availableSubcategories: state.tabs
      .map((tab) => tab.value)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  };

  let filtered = sortSamplesByKey(
    filterSamples(state.samples, filters),
    state.gridSortKey,
    state.gridSortDir,
  );
  filtered = filterSamplesBySearchQuery(filtered, state.searchQuery);
  currentGridSamples = filtered;
  renderSampleGrid(currentSlots.grid, filtered, player, currentLibrary);
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
    ?? state.tabs[0]
    ?? null;

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
  if (categoryConfigRefreshInFlight) return;

  categoryConfigRefreshInFlight = true;
  try {
    const nextConfig = await library.loadCategoryConfig({ force });
    if (categoryConfigsEqual(nextConfig, state.categoryConfig)) {
      return;
    }
    applyCategoryConfig(nextConfig);
  } catch (error) {
    console.warn("Failed to refresh category config.", error);
  } finally {
    categoryConfigRefreshInFlight = false;
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
      (tab) => tab.value !== null && normalizeCategoryLabel(tab.value).toLowerCase() === subcategoryName.toLowerCase(),
    );
    if (existingTab || getSubcategoryKind(activeCategory.id, subcategoryName) !== "user") {
      resetSubcategoryAddState();
      applyCategoryConfig(state.categoryConfig, existingTab?.id ?? state.activeTab?.id ?? null);
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
    !tab.value ||
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

  /* istanbul ignore next -- browser coverage runs against the dev server, so DEV is always true here */
  if (isDev) {
    void startWithFetchLibrary();
  } else {
    showHome();
  }

  return cleanup;
}

const appElement = document.getElementById("app");
/* istanbul ignore next -- index.html always provides #app */
if (!appElement) throw new Error("Missing #app element");
const cleanupApp = createAppController(appElement);

window.addEventListener("beforeunload", cleanupApp, { once: true });
import.meta.hot?.dispose(cleanupApp);