import "./app.css";

import type { ProductEntry, Sample, SampleSort, SampleSortKey } from "./data.js";
import { deriveChannels, filterSamples, sortSamples } from "./data.js";
import type { Library } from "./library.js";
import { FetchLibrary, pickLibraryFolder } from "./library.js";
import { calcProgressInterval, Player } from "./player.js";
import {
  renderChannelFilters,
  renderHeader,
  renderHomePage,
  renderProductList,
  renderSampleList,
  renderTransportBar,
  updatePlayingRow,
  updateTransport,
} from "./render.js";

// ── App state ─────────────────────────────────────────────────

interface AppState {
  library: Library | null;
  products: ProductEntry[];
  product: ProductEntry | null;
  samples: Sample[];
  channels: string[];
  channel: string | null;
  query: string;
  sort: SampleSort;
}

const DEFAULT_SAMPLE_SORT: SampleSort = { key: null, direction: "asc" };

const state: AppState = {
  library: null,
  products: [],
  product: null,
  samples: [],
  channels: [],
  channel: null,
  query: "",
  sort: { ...DEFAULT_SAMPLE_SORT },
};
const player = new Player();

// ── DOM containers ────────────────────────────────────────────

const app = document.getElementById("app");
/* istanbul ignore if -- defensive guard: #app always exists in index.html */
if (!app) throw new Error("Missing #app element");

const homeSlot = document.createElement("div");
const headerSlot = document.createElement("div");
const filterSlot = document.createElement("div");
const mainSlot = document.createElement("div");
mainSlot.className = "pb-16"; // leave room for transport bar
const transportSlot = document.createElement("div");
app.append(homeSlot, headerSlot, filterSlot, mainSlot, transportSlot);

// ── Player events ─────────────────────────────────────────────

let progressUpdateIntervalId: number | null = null;

function clearProgressUpdateInterval(): void {
  if (progressUpdateIntervalId === null) return;
  clearInterval(progressUpdateIntervalId);
  progressUpdateIntervalId = null;
}

function leaveProductView(): void {
  if (!state.library || !state.product) return;
  player.stop();
  state.library.releaseProduct(state.product.id);
}

player.onStateChange((playerState) => {
  const active = player.activePath;
  updatePlayingRow(active);
  updateTransport(active, player);

  clearProgressUpdateInterval();
  if (playerState === "playing") {
    // Scale polling to sample length: ~20 updates per playback, clamped 50–250 ms.
    // Falls back to 250 ms when duration is not yet known.
    const intervalMs = calcProgressInterval(player.duration);
    progressUpdateIntervalId = window.setInterval(() => updateTransport(player.activePath, player), intervalMs);
  }
});

// Transport stop listener is attached directly in startBrowser
// after the transport bar is rendered (see below).

// ── Home page ─────────────────────────────────────────────────

/** True when the Vite dev server is likely serving output/ directly. */
const isDev = import.meta.env.DEV;

function showHome(): void {
  homeSlot.innerHTML = "";
  headerSlot.innerHTML = "";
  filterSlot.innerHTML = "";
  mainSlot.innerHTML = "";
  transportSlot.innerHTML = "";

  renderHomePage(
    homeSlot,
    // `void` explicitly discards the returned Promise; each async handler is responsible for its own errors.
    /* istanbul ignore next -- requires File System Access API; not available in Playwright */
    () => void handlePickFolder(),
    /* istanbul ignore next -- DEV is always true under the Vite test server */
    isDev ? () => void startWithFetchLibrary() : null,
  );
}

async function handlePickFolder(): Promise<void> {
  /* istanbul ignore next -- requires File System Access API; not available in Playwright */
  try {
    const lib = await pickLibraryFolder();
    await startBrowser(lib);
  } catch (err) {
    // User cancelled the picker — stay on home page
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  }
}

async function startWithFetchLibrary(): Promise<void> {
  await startBrowser(new FetchLibrary());
}

async function startBrowser(library: Library): Promise<void> {
  /* istanbul ignore if -- only reachable when switching between Fs and Fetch libraries */
  if (state.library && state.library !== library) {
    leaveProductView();
    state.library.dispose();
  }

  state.library = library;
  homeSlot.innerHTML = "";
  renderTransportBar(transportSlot);

  const stopBtn = transportSlot.querySelector("#transport-stop");
  stopBtn?.addEventListener("click", () => player.stop());

  const index = await library.loadIndex();
  state.products = index.products;
  showProducts(state.products);
}

// ── Render helpers ────────────────────────────────────────────

function showProducts(products: ProductEntry[]): void {
  leaveProductView();
  state.product = null;
  state.samples = [];
  state.channels = [];
  state.channel = null;
  state.query = "";
  state.sort = { ...DEFAULT_SAMPLE_SORT };

  renderHeader(headerSlot, (q) => {
    state.query = q;
    const lower = q.toLowerCase();
    const filtered = lower
      ? state.products.filter(p =>
          p.name.toLowerCase().includes(lower) ||
          p.channels.some(ch => ch.toLowerCase().includes(lower)))
      : state.products;
    filterSlot.innerHTML = "";
    renderProductList(mainSlot, filtered, (p) => void selectProduct(p));
  }, () => returnHome(), "\u2190 Back to Home");
  filterSlot.innerHTML = "";
  renderProductList(mainSlot, products, (p) => void selectProduct(p));
}

async function selectProduct(product: ProductEntry): Promise<void> {
  /* istanbul ignore if -- library is always set before product selection */
  if (!state.library) return;

  /* istanbul ignore if -- showProducts always resets state.product before selectProduct */
  if (state.product && state.product.id !== product.id) {
    leaveProductView();
  }

  state.product = product;
  state.channel = null;
  state.query = "";
  state.sort = { ...DEFAULT_SAMPLE_SORT };
  state.samples = await state.library.loadProductSamples(product.id);
  state.channels = deriveChannels(state.samples);

  renderHeader(
    headerSlot,
    (q) => { state.query = q; refreshSamples(); },
    () => showProductsFromLibrary(),
    "\u2190 Products",
    product.name,
  );
  refreshChannelFilterBar();
  refreshSamples();
}

function showProductsFromLibrary(): void {
  showProducts(state.products);
}

function returnHome(): void {
  leaveProductView();
  player.stop();
  state.library?.dispose();
  state.library = null;
  state.products = [];
  state.product = null;
  state.samples = [];
  state.channels = [];
  state.channel = null;
  state.query = "";
  state.sort = { ...DEFAULT_SAMPLE_SORT };
  showHome();
}

function refreshChannelFilterBar(): void {
  renderChannelFilters(filterSlot, state.channels, state.channel, (ch) => {
    state.channel = ch;
    refreshChannelFilterBar();
    refreshSamples();
  });
}

function refreshSamples(): void {
  /* istanbul ignore if -- defensive guard: only called after selectProduct sets product */
  if (!state.product || !state.library) return;
  const filtered = filterSamples(state.samples, state.channel, state.query);
  const sorted = sortSamples(filtered, state.sort);
  renderSampleList(
    mainSlot,
    sorted,
    state.product.id,
    player,
    state.library,
    state.sort,
    toggleSampleSort,
  );
  updatePlayingRow(player.activePath);
}

function toggleSampleSort(key: SampleSortKey): void {
  if (state.sort.key === key) {
    state.sort = {
      key,
      direction: state.sort.direction === "asc" ? "desc" : "asc",
    };
  } else {
    state.sort = { key, direction: "asc" };
  }

  refreshSamples();
}

// ── Bootstrap ─────────────────────────────────────────────────

showHome();

