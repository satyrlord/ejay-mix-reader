import "./app.css";

import type { CategoryConfig, CategoryEntry, Sample, SubcategoryKind } from "./data.js";
import {
  addSubcategoryToCategoryConfig,
  buildCategoryEntries,
  buildDefaultCategoryConfig,
  filterSamples,
  getSubcategoryKind,
  normalizeCategoryLabel,
  removeSubcategoryFromCategoryConfig,
  sortSamplesForGrid,
} from "./data.js";
import type { Library } from "./library.js";
import { FetchLibrary, pickLibraryFolder } from "./library.js";
import { calcProgressInterval, Player } from "./player.js";
import {
  renderCategorySidebar,
  renderHomePage,
  renderSampleGrid,
  renderSpaShell,
  renderSubcategoryTabs,
  type SubcategoryAddOptions,
  type SpaShellSlots,
  type UiTab,
  updatePlayingBlock,
  updateTransport,
} from "./render.js";

type CategoryTabMode = "subcategory";

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
  bpm: number;
  isAddingSubcategory: boolean;
  subcategoryDraft: string;
}

const state: AppState = {
  library: null,
  categoryConfig: buildDefaultCategoryConfig(),
  categories: [],
  activeCategory: null,
  samples: [],
  tabs: [],
  activeTab: null,
  bpm: 140,
  isAddingSubcategory: false,
  subcategoryDraft: "",
};

const player = new Player();
let slots: SpaShellSlots | null = null;
let progressUpdateIntervalId: number | null = null;
let categoryConfigPollIntervalId: number | null = null;
let categoryConfigRefreshInFlight = false;
let subcategoryAddSubmitInFlight = false;
let subcategoryRemoveSubmitInFlight = false;
let cleanupSubcategoryContextMenu: (() => void) | null = null;

const CATEGORY_CONFIG_POLL_INTERVAL_MS = 1000;
const SUBCATEGORY_CONTEXT_MENU_ID = "subcategory-context-menu";

const appElement = document.getElementById("app");
/* istanbul ignore next -- index.html always provides #app */
if (!appElement) throw new Error("Missing #app element");
const app = appElement;

function clearProgressUpdateInterval(): void {
  if (progressUpdateIntervalId === null) return;
  clearInterval(progressUpdateIntervalId);
  progressUpdateIntervalId = null;
}

function clearCategoryConfigPollInterval(): void {
  if (categoryConfigPollIntervalId === null) return;
  clearInterval(categoryConfigPollIntervalId);
  categoryConfigPollIntervalId = null;
}

player.onStateChange((playerState) => {
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
  try {
    const lib = await pickLibraryFolder();
    await startBrowser(lib);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
}

async function startWithFetchLibrary(): Promise<void> {
  await startBrowser(new FetchLibrary());
}

async function startBrowser(library: Library): Promise<void> {
  clearCategoryConfigPollInterval();
  closeSubcategoryContextMenu();
  resetSubcategoryAddState();
  state.library = library;
  slots = renderSpaShell(app);
  const currentSlots = slots;

  currentSlots.transport.querySelector("#transport-stop")?.addEventListener("click", () => player.stop());
  currentSlots.bpm.value = String(state.bpm);
  currentSlots.bpm.addEventListener("change", () => {
    state.bpm = Number(currentSlots.bpm.value);
    if (state.activeCategory) {
      state.tabs = buildTabsForCategory(state.activeCategory);
      const still = state.tabs.find((tab) => tab.id === state.activeTab?.id);
      state.activeTab = still ?? state.tabs[0] ?? null;
      refreshTabs();
    }
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

  void index;
  state.samples = samples;
  applyCategoryConfig(categoryConfig);
  startCategoryConfigPolling();
}

function selectCategory(category: CategoryEntry): void {
  player.stop();
  closeSubcategoryContextMenu();
  resetSubcategoryAddState();
  state.activeCategory = category;
  state.activeTab = null;
  syncActiveCategory();
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

  const filtered = sortSamplesForGrid(filterSamples(state.samples, filters));
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
  clearCategoryConfigPollInterval();
  clearProgressUpdateInterval();
  closeSubcategoryContextMenu();
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
  if (!currentSlots) return;

  const activeCategoryId = state.activeCategory?.id ?? null;
  state.activeCategory = activeCategoryId
    ? state.categories.find((category) => category.id === activeCategoryId) ?? null
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

function startCategoryConfigPolling(): void {
  clearCategoryConfigPollInterval();
  if (!state.library?.loadCategoryConfig) return;

  categoryConfigPollIntervalId = window.setInterval(() => {
    void refreshCategoryConfig(true);
  }, CATEGORY_CONFIG_POLL_INTERVAL_MS);
}

async function refreshCategoryConfig(force: boolean): Promise<void> {
  const library = state.library;
  if (!library?.loadCategoryConfig || categoryConfigRefreshInFlight) return;

  categoryConfigRefreshInFlight = true;
  try {
    const nextConfig = await library.loadCategoryConfig({ force });
    if (JSON.stringify(nextConfig) === JSON.stringify(state.categoryConfig)) {
      return;
    }
    applyCategoryConfig(nextConfig);
  } catch (error) {
    console.warn("Failed to refresh category config.", error);
  } finally {
    categoryConfigRefreshInFlight = false;
  }
}

function resetSubcategoryAddState(): void {
  state.isAddingSubcategory = false;
  state.subcategoryDraft = "";
}

function closeSubcategoryContextMenu(): void {
  document.getElementById(SUBCATEGORY_CONTEXT_MENU_ID)?.remove();
  cleanupSubcategoryContextMenu?.();
  cleanupSubcategoryContextMenu = null;
}

function findTabById(tabId: string | null | undefined): CategoryTab | null {
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
  if (!library?.saveCategoryConfig || !activeCategory || subcategoryAddSubmitInFlight) return;

  closeSubcategoryContextMenu();
  const subcategoryName = normalizeCategoryLabel(state.subcategoryDraft);
  if (!subcategoryName) return;

  subcategoryAddSubmitInFlight = true;
  const existingTab = state.tabs.find(
    (tab) => tab.value !== null && normalizeCategoryLabel(tab.value).toLowerCase() === subcategoryName.toLowerCase(),
  );
  if (existingTab || getSubcategoryKind(activeCategory.id, subcategoryName) !== "user") {
    resetSubcategoryAddState();
    applyCategoryConfig(state.categoryConfig, existingTab?.id ?? state.activeTab?.id ?? null);
    subcategoryAddSubmitInFlight = false;
    return;
  }

  const nextConfig = addSubcategoryToCategoryConfig(state.categoryConfig, activeCategory.id, subcategoryName);
  if (JSON.stringify(nextConfig) === JSON.stringify(state.categoryConfig)) {
    resetSubcategoryAddState();
    applyCategoryConfig(state.categoryConfig, `subcategory:${subcategoryName}`);
    subcategoryAddSubmitInFlight = false;
    return;
  }

  try {
    await library.saveCategoryConfig(nextConfig);
    resetSubcategoryAddState();
    applyCategoryConfig(nextConfig, `subcategory:${subcategoryName}`);
  } catch (error) {
    console.error("Failed to save category config.", error);
    window.alert("Could not save categories.json.");
  } finally {
    subcategoryAddSubmitInFlight = false;
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
    subcategoryRemoveSubmitInFlight
  ) {
    return;
  }

  subcategoryRemoveSubmitInFlight = true;
  closeSubcategoryContextMenu();
  const nextConfig = removeSubcategoryFromCategoryConfig(state.categoryConfig, activeCategory.id, tab.value);
  if (JSON.stringify(nextConfig) === JSON.stringify(state.categoryConfig)) {
    subcategoryRemoveSubmitInFlight = false;
    return;
  }

  try {
    await library.saveCategoryConfig(nextConfig);
    applyCategoryConfig(nextConfig);
  } catch (error) {
    console.error("Failed to save category config.", error);
    window.alert("Could not save categories.json.");
  } finally {
    subcategoryRemoveSubmitInFlight = false;
  }
}

/* istanbul ignore next -- browser coverage runs against the dev server, so DEV is always true here */
if (isDev) {
  void startWithFetchLibrary();
} else {
  showHome();
}