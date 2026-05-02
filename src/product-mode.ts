/**
 * product-mode.ts — Per-product debugging filter ("Product Mode").
 *
 * Lets the user isolate a single eJay product so its samples, mixes, theme,
 * and default BPM can be debugged end-to-end without the noise of the
 * other twelve. The default `"all"` entry restores the multi-product UI.
 *
 * See `.github/copilot-instructions.md` ("Guiding Principle") for the
 * rationale: one fully-working product is worth more than thirteen
 * partially-working abominations.
 */

export interface ProductModeEntry {
  /** Stable id; also used as the value of `<html data-product-theme>`. */
  id: string;
  /** Display label shown in the dropdown. */
  label: string;
  /**
   * Sample `product` values that belong to this entry (base product plus
   * any expansion sample packs). Empty for `"all"`.
   */
  productIds: readonly string[];
  /**
   * `mixLibrary` group ids whose `.mix` files should be visible when this
   * entry is selected. Empty for `"all"`.
   */
  mixGroupIds: readonly string[];
  /**
   * Default BPM auto-applied when this entry is selected; `null` means
   * "do not change the BPM filter".
   */
  defaultBpm: number | null;
}

/** Sentinel id for the unfiltered default entry. */
export const PRODUCT_MODE_ALL_ID = "all";

/**
 * Ordered list of product-mode entries. Order is the user-requested
 * dropdown order (chronological by product, not alphabetical).
 */
export const PRODUCT_MODE_ENTRIES: readonly ProductModeEntry[] = [
  {
    id: PRODUCT_MODE_ALL_ID,
    label: "All",
    productIds: [],
    mixGroupIds: [],
    defaultBpm: null,
  },
  {
    id: "rave",
    label: "Rave",
    productIds: ["Rave"],
    mixGroupIds: ["Rave"],
    defaultBpm: 180,
  },
  {
    id: "dance1",
    label: "Dance 1",
    productIds: ["Dance_eJay1"],
    mixGroupIds: ["Dance_eJay1"],
    defaultBpm: 140,
  },
  {
    id: "hiphop1",
    label: "HipHop 1",
    productIds: ["HipHop_eJay1", "GenerationPack1_HipHop", "SampleKit_DMKIT1", "SampleKit_DMKIT2"],
    mixGroupIds: ["HipHop_eJay1", "HipHop eJay 1", "HipHop 1"],
    defaultBpm: 96,
  },
  {
    id: "dance2",
    label: "Dance 2",
    productIds: ["Dance_eJay2"],
    mixGroupIds: ["Dance_eJay2"],
    defaultBpm: 140,
  },
  {
    id: "techno",
    label: "Techno",
    productIds: ["Techno_eJay"],
    mixGroupIds: ["Techno_eJay"],
    // Verified from archive/TECHNO_EJAY/EJAY/EJAY/METRO.PXD timing and
    // output/metadata.json (Techno_eJay samples are uniformly 140 BPM).
    defaultBpm: 140,
  },
  {
    id: "hiphop2",
    label: "HipHop 2",
    productIds: ["HipHop_eJay2"],
    mixGroupIds: ["HipHop_eJay2"],
    defaultBpm: 90,
  },
  {
    id: "dance3",
    label: "Dance 3",
    productIds: ["Dance_eJay3", "Dance_SuperPack"],
    mixGroupIds: ["Dance_eJay3", "Dance_SuperPack"],
    defaultBpm: 140,
  },
  {
    id: "dance4",
    label: "Dance 4",
    productIds: ["Dance_eJay4"],
    mixGroupIds: ["Dance_eJay4"],
    defaultBpm: 140,
  },
  {
    id: "hiphop3",
    label: "HipHop 3",
    productIds: ["HipHop_eJay3"],
    mixGroupIds: ["HipHop_eJay3"],
    defaultBpm: 90,
  },
  {
    id: "techno3",
    label: "Techno 3",
    productIds: ["Techno_eJay3"],
    mixGroupIds: ["Techno_eJay3"],
    defaultBpm: 140,
  },
  {
    id: "xtreme",
    label: "Xtreme",
    productIds: ["Xtreme_eJay"],
    mixGroupIds: ["Xtreme_eJay"],
    defaultBpm: 125,
  },
  {
    id: "hiphop4",
    label: "HipHop 4",
    productIds: ["HipHop_eJay4"],
    mixGroupIds: ["HipHop_eJay4"],
    defaultBpm: 90,
  },
  {
    id: "house",
    label: "House",
    productIds: ["House_eJay"],
    mixGroupIds: ["House_eJay"],
    defaultBpm: 125,
  },
];

const ENTRY_BY_ID: ReadonlyMap<string, ProductModeEntry> = new Map(
  PRODUCT_MODE_ENTRIES.map((entry) => [entry.id, entry]),
);

/** Look up a product-mode entry by id. Returns the `"all"` entry on miss. */
export function getProductModeEntry(id: string | null | undefined): ProductModeEntry {
  if (id) {
    const found = ENTRY_BY_ID.get(id);
    if (found) return found;
  }
  return PRODUCT_MODE_ENTRIES[0];
}

/** `true` when the entry represents the unfiltered "All" view. */
export function isAllEntry(entry: ProductModeEntry): boolean {
  return entry.id === PRODUCT_MODE_ALL_ID;
}

/**
 * Apply or clear the per-product theme on `<html>`. Removing the attribute
 * restores the default DaisyUI dark theme defined in `src/app.css`.
 */
export function applyProductTheme(entry: ProductModeEntry, root: HTMLElement = document.documentElement): void {
  if (isAllEntry(entry)) {
    root.removeAttribute("data-product-theme");
  } else {
    root.setAttribute("data-product-theme", entry.id);
  }
}

/**
 * Build a `<select>` element populated with all product-mode entries.
 * Caller is responsible for wiring the `change` listener.
 */
export function createProductModeSelect(initialId: string = PRODUCT_MODE_ALL_ID): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "product-mode-select";
  select.setAttribute("aria-label", "Product mode filter");
  for (const entry of PRODUCT_MODE_ENTRIES) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    select.appendChild(option);
  }
  select.value = initialId;
  return select;
}
