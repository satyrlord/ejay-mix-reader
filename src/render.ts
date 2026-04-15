// DOM rendering functions for the Sound Browser UI.

import type { ProductEntry, Sample, SampleSort, SampleSortKey } from "./data.js";
import { sampleChannel, sampleMergedName } from "./data.js";
import type { Library } from "./library.js";
import type { Player } from "./player.js";

// ── Home page ─────────────────────────────────────────────────

export function renderHomePage(
  container: HTMLElement,
  onPickFolder: () => void,
  onUseDev: (() => void) | null,
): void {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.id = "home-page";
  wrapper.className = "hero min-h-screen";

  const content = document.createElement("div");
  content.className = "hero-content text-center flex-col gap-8";

  // Logo / title block
  const logo = document.createElement("div");
  logo.className = "flex flex-col items-center gap-4";
  logo.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="w-24 h-24" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1a1a2e"/>
      <g fill="none" stroke="#00ff88" stroke-width="2.5" stroke-linecap="round">
        <rect x="8" y="28" width="6" height="14" rx="1" fill="#00ff88" opacity=".7"/>
        <rect x="17" y="22" width="6" height="26" rx="1" fill="#00ff88" opacity=".8"/>
        <rect x="26" y="16" width="6" height="38" rx="1" fill="#00ff88" opacity=".9"/>
        <rect x="35" y="20" width="6" height="30" rx="1" fill="#00ff88" opacity=".85"/>
        <rect x="44" y="26" width="6" height="18" rx="1" fill="#00ff88" opacity=".75"/>
        <rect x="53" y="30" width="6" height="10" rx="1" fill="#00ff88" opacity=".65"/>
      </g>
    </svg>
    <h1 class="text-4xl font-bold tracking-tight">
      <span class="text-primary">eJay</span> Sound Browser
    </h1>
    <p class="text-base-content/60 max-w-md">
      Browse, search, and preview extracted audio samples from your eJay library.
    </p>
  `;

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "flex flex-col gap-3 items-center";

  const pickBtn = document.createElement("button");
  pickBtn.id = "pick-folder-btn";
  pickBtn.className = "btn btn-primary btn-lg gap-2";
  pickBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
      <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z"/>
    </svg>
    Choose output folder
  `;
  pickBtn.addEventListener("click", onPickFolder);

  const tooltipText =
    "Select a folder containing one sub-folder per product. " +
    "Each sub-folder should have channel sub-folders (e.g. bass, drum) " +
    "with .wav files inside. A metadata.json per product is optional. " +
    "Example: output/Dance_eJay1/bass/Kick 01.wav";

  const pickWrapper = document.createElement("div");
  pickWrapper.className = "tooltip tooltip-bottom";
  pickWrapper.setAttribute("data-tip", tooltipText);
  pickWrapper.appendChild(pickBtn);
  actions.appendChild(pickWrapper);

  if (onUseDev) {
    const devBtn = document.createElement("button");
    devBtn.id = "dev-library-btn";
    devBtn.className = "btn btn-ghost btn-sm opacity-60";
    devBtn.textContent = "Use development library";
    devBtn.addEventListener("click", onUseDev);
    actions.appendChild(devBtn);
  }

  const footer = document.createElement("footer");
  footer.className = "text-base-content/40 text-xs mt-4";
  footer.innerHTML = `
    <a href="https://github.com/satyrlord/ejay-mix-reader"
       target="_blank" rel="noopener noreferrer"
       class="inline-flex items-center gap-1 hover:text-base-content/70 transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4" aria-hidden="true">
        <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"/>
      </svg>
      satyrlord/ejay-mix-reader
    </a>
  `;

  content.append(logo, actions, footer);
  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

// ── Product list ──────────────────────────────────────────────

export function renderProductList(
  container: HTMLElement,
  products: ProductEntry[],
  onSelect: (product: ProductEntry) => void,
): void {
  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4";

  for (const product of products) {
    const card = document.createElement("div");
    card.className = "card bg-base-200 shadow-md cursor-pointer hover:bg-base-300 transition-colors";
    card.dataset.productId = product.id;

    const cardBody = document.createElement("div");
    cardBody.className = "card-body p-4";

    const title = document.createElement("h2");
    title.className = "card-title text-base";
    title.textContent = product.name;

    const sampleCount = document.createElement("p");
    sampleCount.className = "text-sm opacity-70";
    sampleCount.textContent = `${product.sampleCount} samples`;

    const channelList = document.createElement("div");
    channelList.className = "flex flex-wrap gap-1 mt-1";
    for (const channel of product.channels) {
      channelList.appendChild(createChannelBadge(channel));
    }

    cardBody.append(title, sampleCount, channelList);
    card.appendChild(cardBody);
    card.addEventListener("click", () => onSelect(product));
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

// ── Channel filters ───────────────────────────────────────────

export function renderChannelFilters(
  container: HTMLElement,
  channels: string[],
  active: string | null,
  onFilter: (channel: string | null) => void,
): void {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "flex flex-wrap gap-2 p-4";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Category filters");

  const allBtn = channelButton("All", active === null, () => onFilter(null));
  wrap.appendChild(allBtn);

  for (const ch of channels) {
    const btn = channelButton(ch, active === ch, () => onFilter(ch));
    btn.style.setProperty("--btn-color", channelColor(ch));
    if (active === ch) {
      btn.style.background = channelColor(ch);
      btn.style.color = "#000";
    }
    wrap.appendChild(btn);
  }

  container.appendChild(wrap);
}

function channelButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn btn-sm ${active ? "btn-active" : "btn-ghost"}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function createChannelBadge(label: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "badge badge-sm";
  badge.style.background = channelColor(label);
  badge.style.color = "#000";
  badge.textContent = label;
  return badge;
}

function channelColor(channel: string): string {
  const token = channel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `var(--channel-${token || "unknown"}, #666)`;
}

function showErrorToast(message: string): void {
  const existing = document.getElementById("error-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "error-toast";
  toast.className = "toast toast-end fixed bottom-16 right-4 z-50";
  const alert = document.createElement("div");
  alert.className = "alert alert-error text-sm py-2";
  const span = document.createElement("span");
  span.textContent = message;
  alert.appendChild(span);
  toast.appendChild(alert);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

// ── Sample list ───────────────────────────────────────────────

export function renderSampleList(
  container: HTMLElement,
  samples: Sample[],
  productId: string,
  player: Player,
  library: Library,
  sort: SampleSort,
  onSort: (key: SampleSortKey) => void,
): void {
  container.innerHTML = "";

  if (samples.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "text-center opacity-50 py-8";
    emptyState.textContent = "No samples match your filter.";
    container.appendChild(emptyState);
    return;
  }

  const table = document.createElement("table");
  table.className = "table table-sm w-full";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const playHeader = document.createElement("th");
  playHeader.className = "w-10";
  playHeader.scope = "col";
  headerRow.appendChild(playHeader);
  headerRow.append(
    createSortHeaderCell("Name", "name", sort, onSort),
    createSortHeaderCell("Category", "category", sort, onSort),
    createSortHeaderCell("Beats", "beats", sort, onSort, true),
    createSortHeaderCell("Duration", "duration", sort, onSort, true),
  );
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.id = "sample-tbody";

  for (const sample of samples) {
    const ch = sampleChannel(sample);
    const tr = document.createElement("tr");
    tr.className = "hover:bg-base-300 cursor-pointer";

    const mergedName = sampleMergedName(sample);
    const duration = sample.duration_sec != null
      ? sample.duration_sec.toFixed(2) + "s"
      : "—";

    const playCell = document.createElement("td");
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "btn btn-circle btn-xs btn-ghost play-btn";
    playButton.setAttribute("aria-label", `Play ${mergedName}`);
    playButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 play-icon" aria-hidden="true">
        <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z"/>
      </svg>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 stop-icon hidden" aria-hidden="true">
        <path d="M5.75 3A2.75 2.75 0 003 5.75v8.5A2.75 2.75 0 005.75 17h8.5A2.75 2.75 0 0017 14.25v-8.5A2.75 2.75 0 0014.25 3h-8.5z"/>
      </svg>
    `;
    playCell.appendChild(playButton);

    const nameCell = document.createElement("td");
    nameCell.className = "font-medium";
    nameCell.textContent = mergedName;

    const categoryCell = document.createElement("td");
    categoryCell.appendChild(createChannelBadge(ch));

    const beatsCell = document.createElement("td");
    beatsCell.className = "text-right font-mono text-sm";
    beatsCell.textContent = sample.beats?.toString() ?? "—";

    const durationCell = document.createElement("td");
    durationCell.className = "text-right font-mono text-sm";
    durationCell.textContent = duration;

    tr.append(playCell, nameCell, categoryCell, beatsCell, durationCell);

    tr.addEventListener("click", () => {
      library.resolveAudioUrl(productId, sample)
        .then((url) => {
          tr.dataset.path = url;
          player.toggle(url);
        })
        .catch((err: unknown) => {
          console.error("Failed to resolve audio URL:", err);
          showErrorToast("Could not play this sample — audio file not found.");
        });
    });
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);

  const scrollWrap = document.createElement("div");
  scrollWrap.className = "overflow-x-auto";
  scrollWrap.appendChild(table);
  container.appendChild(scrollWrap);
}

function createSortHeaderCell(
  label: string,
  key: SampleSortKey,
  sort: SampleSort,
  onSort: (key: SampleSortKey) => void,
  alignRight = false,
): HTMLTableCellElement {
  const th = document.createElement("th");
  th.scope = "col";
  if (alignRight) th.className = "text-right";

  const active = sort.key === key;
  const currentDirection = active ? sort.direction : null;
  th.setAttribute(
    "aria-sort",
    currentDirection === "asc"
      ? "ascending"
      : currentDirection === "desc"
        ? "descending"
        : "none",
  );

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.sortKey = key;
  button.className = [
    "inline-flex items-center gap-1 font-semibold transition-colors focus:outline-none",
    active ? "text-primary" : "text-base-content/70 hover:text-primary",
    alignRight ? "ml-auto" : "",
  ].join(" ").trim();
  button.setAttribute("aria-label", active ? `Sort ${label} descending` : `Sort ${label} ascending`);
  button.addEventListener("click", () => onSort(key));

  const text = document.createElement("span");
  text.textContent = label;

  const icon = document.createElement("span");
  icon.className = active ? "text-primary" : "text-base-content/40";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = currentDirection === "asc"
    ? "↑"
    : currentDirection === "desc"
      ? "↓"
      : "↕";

  button.append(text, icon);
  th.appendChild(button);
  return th;
}
// ── Transport bar ─────────────────────────────────────────────

export function renderTransportBar(container: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  bar.id = "transport";
  bar.className = "fixed bottom-0 left-0 right-0 bg-base-300 border-t border-base-content/10 px-4 py-2 flex items-center gap-4 h-14";

  bar.innerHTML = `
    <button id="transport-stop" class="btn btn-sm btn-ghost" aria-label="Stop">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
        <path d="M5.75 3A2.75 2.75 0 003 5.75v8.5A2.75 2.75 0 005.75 17h8.5A2.75 2.75 0 0017 14.25v-8.5A2.75 2.75 0 0014.25 3h-8.5z"/>
      </svg>
    </button>
    <span id="transport-name" class="text-sm truncate flex-1 opacity-70">No sample playing</span>
    <progress id="transport-progress" class="progress progress-primary w-32" value="0" max="100"></progress>
  `;

  container.appendChild(bar);
  return bar;
}

export function updateTransport(
  activePath: string | null,
  player: Player,
): void {
  const nameEl = document.getElementById("transport-name");
  const progressEl = document.getElementById("transport-progress") as HTMLProgressElement | null;

  /* istanbul ignore if -- elements always rendered by renderTransportBar */
  if (!nameEl || !progressEl) return;

  if (activePath) {
    // Show the filename from the path
    const parts = activePath.split("/");
    nameEl.textContent = decodeURIComponent(parts[parts.length - 1]).replace(/\.wav$/i, "");
    nameEl.classList.remove("opacity-70");

    const pct = player.duration > 0
      ? (player.currentTime / player.duration) * 100
      : 0;
    progressEl.value = pct;
  } else {
    nameEl.textContent = "No sample playing";
    nameEl.classList.add("opacity-70");
    progressEl.value = 0;
  }
}

export function updatePlayingRow(activePath: string | null): void {
  const tbody = document.getElementById("sample-tbody");
  /* istanbul ignore if -- tbody always present while samples are shown */
  if (!tbody) return;

  for (const row of tbody.children) {
    const tr = row as HTMLElement;
    const isPlaying = tr.dataset.path === activePath;
    tr.classList.toggle("bg-primary/10", isPlaying);

    const playIcon = tr.querySelector(".play-icon") as HTMLElement | null;
    const stopIcon = tr.querySelector(".stop-icon") as HTMLElement | null;
    if (playIcon) playIcon.classList.toggle("hidden", isPlaying);
    if (stopIcon) stopIcon.classList.toggle("hidden", !isPlaying);
  }
}

// ── Header ────────────────────────────────────────────────────

export function renderHeader(
  container: HTMLElement,
  onSearch: (query: string) => void,
  onBack: (() => void) | null,
  backLabel = "\u2190 Products",
  titleText = "eJay Sound Browser",
): void {
  container.innerHTML = "";

  const header = document.createElement("header");
  header.className = "sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-base-content/10 bg-base-200 px-3 py-2";

  const left = document.createElement("div");
  left.className = "min-w-0 justify-self-start";
  if (onBack) {
    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-sm btn-ghost nav-back-btn";
    backBtn.id = "back-btn";
    backBtn.textContent = backLabel;
    backBtn.addEventListener("click", onBack);
    left.appendChild(backBtn);
  }

  const center = document.createElement("div");
  center.className = "min-w-0 text-center";
  const title = document.createElement("h1");
  title.className = "truncate text-lg font-bold";
  title.textContent = titleText;
  center.appendChild(title);

  const right = document.createElement("div");
  right.className = "min-w-0 justify-self-end";
  const search = document.createElement("input");
  search.type = "search";
  search.id = "search-input";
  search.placeholder = "Search samples…";
  search.className = "input input-sm input-bordered w-32 max-w-full sm:w-48";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onSearch(search.value), 120);
  });
  right.appendChild(search);

  header.append(left, center, right);
  container.appendChild(header);
}

