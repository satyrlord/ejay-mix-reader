import "./app.css";

import type { CategoryConfig, CategoryEntry, Sample, SubcategoryKind } from "./data.js";
import { initMixFileBrowser } from "./mix-file-browser.js";
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
}

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
};

const SAMPLE_BUBBLE_ZOOM_CSS_VAR = "--sample-bubble-zoom-scale";
const SAMPLE_BUBBLE_ZOOM_STEP = 0.1;
const SAMPLE_BUBBLE_ZOOM_MIN = 0.5;
const SAMPLE_BUBBLE_ZOOM_MAX = 2;

const player = new Player();
let slots: SpaShellSlots | null = null;
let progressUpdateIntervalId: number | null = null;
const noop = (): void => {};
let stopCategoryConfigWatch: () => void = noop;
let categoryConfigRefreshInFlight = false;
const subcategoryOperationsInFlight = new Set<SubcategoryOperation>();
let cleanupSubcategoryContextMenu: () => void = noop;
let currentGridSamples: Sample[] = [];

const SUBCATEGORY_CONTEXT_MENU_ID = "subcategory-context-menu";

const appElement = document.getElementById("app");
/* istanbul ignore next -- index.html always provides #app */
if (!appElement) throw new Error("Missing #app element");
const app = appElement;

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

const isDev = import.meta.env.DEV;

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

  currentSlots.transport.querySelector("#transport-stop")?.addEventListener("click", () => player.stop());
  currentSlots.bpm.value = state.bpm === null ? "" : String(state.bpm);
  applySampleBubbleZoom();

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
    onSelectFile: (_ref) => {
      // TODO: load and parse the selected .mix file (Milestone 3)
    },
  });
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

window.addEventListener("beforeunload", () => {
  clearCategoryConfigWatcher();
  clearProgressUpdateInterval();
  closeSubcategoryContextMenu();
  closeSampleContextMenu();
  player.destroy();
  /* istanbul ignore next -- browser coverage boots the library before unload */
  state.library?.dispose();
});

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
  /* istanbul ignore next -- refreshes are only scheduled after watcher setup validates config loading */
  if (!library?.loadCategoryConfig) return;
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