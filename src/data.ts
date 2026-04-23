// Types and normalized catalog helpers for the Sound Browser.

export const CANONICAL_CATEGORIES = [
  "Loop",
  "Drum",
  "Bass",
  "Guitar",
  "Keys",
  "Sequence",
  "Voice",
  "Effect",
  "Scratch",
  "Orchestral",
  "Pads",
  "Extra",
  "Unsorted",
] as const;

export const DRUM_SUBCATEGORIES = [
  "kick",
  "snare",
  "clap",
  "toms",
  "crash",
  "hi-hats",
  "perc",
  "misc",
] as const;

export const VOICE_SUBCATEGORIES = [
  "rap male",
  "rap female",
  "sing male",
  "sing female",
  "robot",
  "misc",
] as const;

export const DRUM_SYSTEM_SUBCATEGORIES = DRUM_SUBCATEGORIES.filter((entry) => entry !== "misc");
export const VOICE_SYSTEM_SUBCATEGORIES = VOICE_SUBCATEGORIES.filter((entry) => entry !== "misc");

export const CATEGORY_CONFIG_FILENAME = "categories.json";
export const CATEGORY_CONFIG_UPDATED_EVENT = "category-config-updated";
export const UNSORTED_CATEGORY_ID = "Unsorted";
export const UNSORTED_SUBCATEGORY_ID = "unsorted";

export interface CategoryConfigEntry {
  id: string;
  name: string;
  subcategories: string[];
}

export interface CategoryConfig {
  categories: CategoryConfigEntry[];
}

export const DEFAULT_CATEGORY_CONFIG: CategoryConfig = {
  categories: CANONICAL_CATEGORIES.map((category) => ({
    id: category,
    name: category,
    subcategories:
      category === "Drum"
        ? [...DRUM_SUBCATEGORIES]
        : category === "Voice"
          ? [...VOICE_SUBCATEGORIES]
          : ["unsorted"],
  })),
};

export type SubcategoryKind = "special" | "system" | "user";

export type MixFormat = "A" | "B" | "C" | "D";

export interface MixFileEntry {
  filename: string;
  sizeBytes: number;
  format: MixFormat;
}

export interface CategoryEntry {
  id: string;
  name: string;
  subcategories: string[];
  sampleCount: number;
}

export interface MixLibraryEntry {
  id: string;
  name: string;
  mixes: MixFileEntry[];
}

export interface IndexData {
  categories: CategoryEntry[];
  mixLibrary: MixLibraryEntry[];
  sampleIndex?: Record<string, SampleLookupEntry>;
}

export interface SampleLookupEntry {
  byAlias: Record<string, string>;
  bySource: Record<string, string>;
  byStem: Record<string, string>;
}

export interface Sample {
  filename: string;
  alias?: string;
  category?: string;
  subcategory?: string | null;
  product?: string;
  source?: string;
  duration_sec?: number;
  beats?: number;
  bpm?: number;
  detail?: string;
  original_filename?: string;
  original_category?: string;
  decoded_size?: number;
  sample_rate?: number;
  bit_depth?: number;
  channels?: number;
  [key: string]: unknown;
}

export interface MetadataCatalog {
  generated_at?: string;
  total_samples?: number;
  per_category?: Record<string, number>;
  samples: Sample[];
}

export interface SampleFilterOptions {
  category: string;
  subcategory?: string | null;
  product?: string | null;
  bpm?: number | null;
  availableSubcategories?: string[];
}

export interface HumanizeIdentifierOptions {
  compactDmkit?: boolean;
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeCategoryLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueStrings(values: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeCategoryLabel(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function isSpecialSubcategoryName(value: string | null | undefined): boolean {
  const normalized = normalizeLower(value);
  return normalized === "misc" || normalized === "unsorted";
}

function defaultSubcategoryOrder(categoryId: string): readonly string[] {
  const normalized = normalizeCategoryLabel(categoryId);
  if (normalized === "Drum") return DRUM_SUBCATEGORIES;
  if (normalized === "Voice") return VOICE_SUBCATEGORIES;
  return [UNSORTED_SUBCATEGORY_ID];
}

function systemSubcategoryOrder(categoryId: string): readonly string[] {
  const normalized = normalizeCategoryLabel(categoryId);
  if (normalized === "Drum") return DRUM_SYSTEM_SUBCATEGORIES;
  if (normalized === "Voice") return VOICE_SYSTEM_SUBCATEGORIES;
  return [];
}

export function getSubcategoryKind(categoryId: string, subcategoryName: string): SubcategoryKind {
  const normalizedSubcategory = normalizeLower(subcategoryName);
  if (!normalizedSubcategory) return "user";
  if (isSpecialSubcategoryName(normalizedSubcategory)) return "special";

  return systemSubcategoryOrder(categoryId)
    .some((entry) => normalizeLower(entry) === normalizedSubcategory)
    ? "system"
    : "user";
}

export function cloneCategoryConfig(config: CategoryConfig): CategoryConfig {
  return {
    categories: config.categories.map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: [...category.subcategories],
    })),
  };
}

export function buildDefaultCategoryConfig(): CategoryConfig {
  return cloneCategoryConfig(DEFAULT_CATEGORY_CONFIG);
}

export function categoryConfigsEqual(left: CategoryConfig, right: CategoryConfig): boolean {
  if (left.categories.length !== right.categories.length) {
    return false;
  }

  for (let categoryIndex = 0; categoryIndex < left.categories.length; categoryIndex++) {
    const leftCategory = left.categories[categoryIndex];
    const rightCategory = right.categories[categoryIndex];

    if (
      leftCategory.id !== rightCategory.id ||
      leftCategory.name !== rightCategory.name ||
      leftCategory.subcategories.length !== rightCategory.subcategories.length
    ) {
      return false;
    }

    for (let subcategoryIndex = 0; subcategoryIndex < leftCategory.subcategories.length; subcategoryIndex++) {
      if (leftCategory.subcategories[subcategoryIndex] !== rightCategory.subcategories[subcategoryIndex]) {
        return false;
      }
    }
  }

  return true;
}

export function normalizeCategoryConfig(value: unknown): CategoryConfig | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const rawCategories = (value as { categories?: unknown }).categories;
  if (!Array.isArray(rawCategories)) {
    return null;
  }

  const categories: CategoryConfigEntry[] = [];
  const seen = new Set<string>();

  for (const rawCategory of rawCategories) {
    if (typeof rawCategory !== "object" || rawCategory === null) {
      continue;
    }

    const id = normalizeCategoryLabel(String((rawCategory as { id?: unknown }).id ?? ""));
    if (!id) {
      continue;
    }

    const idKey = id.toLowerCase();
    if (seen.has(idKey)) {
      continue;
    }

    const rawName = (rawCategory as { name?: unknown }).name;
    const rawSubcategories = (rawCategory as { subcategories?: unknown }).subcategories;
    const subcategories = Array.isArray(rawSubcategories)
      ? uniqueStrings(rawSubcategories.filter((entry): entry is string => typeof entry === "string"))
      : [];

    seen.add(idKey);
    categories.push({
      id,
      name: normalizeCategoryLabel(typeof rawName === "string" ? rawName : id) || id,
      subcategories,
    });
  }

  return { categories };
}

export function addSubcategoryToCategoryConfig(
  config: CategoryConfig,
  categoryId: string,
  subcategoryName: string,
): CategoryConfig {
  const normalizedCategoryId = normalizeCategoryLabel(categoryId);
  const normalizedSubcategory = normalizeCategoryLabel(subcategoryName);
  const nextConfig = cloneCategoryConfig(config);

  if (!normalizedCategoryId || !normalizedSubcategory) {
    return nextConfig;
  }

  let category = nextConfig.categories.find((entry) => normalizeLower(entry.id) === normalizedCategoryId.toLowerCase());
  if (!category) {
    category = {
      id: normalizedCategoryId,
      name: normalizedCategoryId,
      subcategories: [],
    };
    nextConfig.categories.push(category);
  }

  if (!category.subcategories.some((entry) => normalizeLower(entry) === normalizedSubcategory.toLowerCase())) {
    category.subcategories.push(normalizedSubcategory);
  }

  return nextConfig;
}

export function removeSubcategoryFromCategoryConfig(
  config: CategoryConfig,
  categoryId: string,
  subcategoryName: string,
): CategoryConfig {
  const normalizedCategoryId = normalizeCategoryLabel(categoryId);
  const normalizedSubcategory = normalizeCategoryLabel(subcategoryName);
  const nextConfig = cloneCategoryConfig(config);

  if (!normalizedCategoryId || !normalizedSubcategory) {
    return nextConfig;
  }

  const category = nextConfig.categories.find((entry) => normalizeLower(entry.id) === normalizedCategoryId.toLowerCase());
  if (!category) {
    return nextConfig;
  }

  category.subcategories = category.subcategories.filter(
    (entry) => normalizeLower(entry) !== normalizedSubcategory.toLowerCase(),
  );

  return nextConfig;
}

function encodeSafePathSegment(value: string, label: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("//")) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  const parts = normalized.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parts.map((part) => encodeURIComponent(part)).join("/");
}

export function sampleCategory(sample: Pick<Sample, "category">): string {
  const category = normalizeText(sample.category);
  return category.length > 0 ? category : "Unsorted";
}

export function sampleSubcategory(sample: Pick<Sample, "subcategory">): string | null {
  const subcategory = normalizeText(sample.subcategory);
  return subcategory.length > 0 ? subcategory : null;
}

export function sampleProduct(sample: Pick<Sample, "product">): string | null {
  const product = normalizeText(sample.product);
  return product.length > 0 ? product : null;
}

export function sampleAudioPath(sample: Pick<Sample, "filename" | "category" | "subcategory">): string {
  const filename = normalizeText(sample.filename);
  if (!filename) {
    throw new Error("Invalid sample filename: " + sample.filename);
  }

  const parts = [
    "output",
    encodeSafePathSegment(sampleCategory(sample), "sample category"),
  ];

  const subcategory = sampleSubcategory(sample);
  if (subcategory) {
    parts.push(encodeSafePathSegment(subcategory, "sample subcategory"));
  }

  parts.push(encodeSafePathSegment(filename, "sample filename"));
  return parts.join("/");
}

export function sampleDisplayName(sample: Pick<Sample, "alias" | "filename">): string {
  const alias = normalizeText(sample.alias);
  if (alias.length > 0) return alias;
  return sample.filename.replace(/^.*[\\/]/, "").replace(/\.wav$/i, "");
}

/**
 * Build a short metadata string for display under the sample label.
 * Shows product, BPM, and beat count when available.
 */
export function sampleMetadataLine(
  sample: Pick<Sample, "product" | "bpm" | "beats" | "detail">,
): string {
  const parts: string[] = [];

  const product = normalizeText(sample.product);
  if (product) {
    parts.push(product.replace(/_/g, " "));
  }

  if (typeof sample.bpm === "number" && sample.bpm > 0) {
    parts.push(`${sample.bpm} BPM`);
  }

  if (typeof sample.beats === "number" && sample.beats > 0) {
    parts.push(`${sample.beats}b`);
  }

  const detail = normalizeText(sample.detail);
  if (detail) {
    parts.push(detail);
  }

  return parts.join(" \u00B7 ");
}

/** Humanize ids for display; `compactDmkit` is opt-in so existing callers keep spaced `DMKIT 1` output by default. */
export function humanizeIdentifier(value: string, options: HumanizeIdentifierOptions = {}): string {
  const humanized = value
    .replace(/_/g, " ")
    .replace(/(\d+)$/, " $1")
    .replace(/ {2,}/g, " ")
    .trim();

  return options.compactDmkit
    ? humanized.replace(/\bDMKIT (\d+)\b/g, "DMKIT$1")
    : humanized;
}

export function buildCategoryEntries(
  samples: Sample[],
  configuredCategories: CategoryConfigEntry[] = DEFAULT_CATEGORY_CONFIG.categories,
): CategoryEntry[] {
  const counts = new Map<string, number>();

  for (const sample of samples) {
    const category = sampleCategory(sample);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const normalizedConfigured = configuredCategories
    .map((category) => ({
      id: normalizeCategoryLabel(category.id),
      name: normalizeCategoryLabel(category.name) || normalizeCategoryLabel(category.id),
      subcategories: uniqueStrings(category.subcategories),
    }))
    .filter((category) => category.id.length > 0);

  return normalizedConfigured.map((category) => ({
    id: category.id,
    name: category.name,
    subcategories: orderedSubcategories(category.id, category.subcategories),
    sampleCount: counts.get(category.id) ?? 0,
  }));
}

function orderedSubcategories(categoryId: string, configured: readonly string[]): string[] {
  const normalizedConfigured = uniqueStrings(configured);
  const configuredByKey = new Map(normalizedConfigured.map((entry) => [entry.toLowerCase(), entry]));
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const defaultSubcategory of defaultSubcategoryOrder(categoryId)) {
    const key = normalizeLower(defaultSubcategory);
    const kind = getSubcategoryKind(categoryId, defaultSubcategory);
    if (kind !== "special" && !configuredByKey.has(key)) continue;
    if (seen.has(key)) continue;

    ordered.push(configuredByKey.get(key) ?? normalizeCategoryLabel(defaultSubcategory));
    seen.add(key);
  }

  for (const configuredSubcategory of normalizedConfigured) {
    const key = configuredSubcategory.toLowerCase();
    if (seen.has(key)) continue;
    ordered.push(configuredSubcategory);
    seen.add(key);
  }

  return ordered;
}

/**
 * Returns true when every whitespace-separated term in `query` appears
 * (case-insensitively) in either the sample's display name or its
 * metadata line (product · BPM · beats · detail).
 *
 * An empty or blank query always returns true.
 */
export function sampleMatchesSearchQuery(sample: Sample, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${sampleDisplayName(sample)} ${sampleMetadataLine(sample)}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterSamples(samples: Sample[], filters: SampleFilterOptions): Sample[] {
  const category = normalizeLower(filters.category);
  const subcategory = normalizeLower(filters.subcategory ?? null);
  const product = normalizeLower(filters.product ?? null);
  const bpm = filters.bpm ?? null;
  const availableSubcategories = new Set(
    (filters.availableSubcategories ?? [])
      .map((entry) => normalizeLower(entry))
      .filter((entry) => entry.length > 0),
  );

  return samples.filter((sample) => {
    if (normalizeLower(sampleCategory(sample)) !== category) {
      return false;
    }

    if (subcategory) {
      const sampleSub = normalizeLower(sampleSubcategory(sample));
      if (availableSubcategories.size > 0 && isSpecialSubcategoryName(subcategory)) {
        const matchesSpecialSubcategory =
          sampleSub === subcategory ||
          sampleSub === "" ||
          (sampleSub.length > 0 && !availableSubcategories.has(sampleSub));

        if (!matchesSpecialSubcategory) {
          return false;
        }
      } else if (subcategory === "misc") {
        if (sampleSub !== "misc" && sampleSub !== "") {
          return false;
        }
      } else if (subcategory === "unsorted") {
        if (sampleSub !== "") {
          return false;
        }
      } else if (sampleSub !== subcategory) {
        return false;
      }
    }

    if (product && normalizeLower(sampleProduct(sample)) !== product) {
      return false;
    }

    const isOneShot = typeof sample.beats !== "number" || sample.beats <= 0;
    if (!isOneShot && bpm !== null && typeof sample.bpm === "number" && sample.bpm !== bpm) {
      return false;
    }

    return true;
  });
}

export function sortSamplesForGrid(samples: Sample[]): Sample[] {
  return [...samples].sort((left, right) => {
    const leftBeats = typeof left.beats === "number" ? left.beats : -1;
    const rightBeats = typeof right.beats === "number" ? right.beats : -1;
    if (leftBeats !== rightBeats) {
      return rightBeats - leftBeats;
    }

    return sampleDisplayName(left).localeCompare(sampleDisplayName(right), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}
