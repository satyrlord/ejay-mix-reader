// Library abstraction for the normalized output tree.

import type { CategoryConfig, IndexData, MetadataCatalog, Sample } from "./data.js";
import {
  buildCategoryEntries,
  buildDefaultCategoryConfig,
  CATEGORY_CONFIG_FILENAME,
  normalizeCategoryConfig,
  sampleAudioPath,
} from "./data.js";

function normalizeMetadataPath(value: string): string[] {
  return value.replace(/\\/g, "/").split("/").filter(Boolean);
}

function isValidPathComponent(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value);
}

async function collectCategorySamples(
  dir: FileSystemDirectoryHandle,
  categoryName: string,
  pathParts: string[],
  samples: Sample[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      await collectCategorySamples(
        handle as FileSystemDirectoryHandle,
        categoryName,
        [...pathParts, name],
        samples,
      );
      continue;
    }

    if (!name.toLowerCase().endsWith(".wav")) continue;

    const subcategory = pathParts.length > 0 ? pathParts[0] : null;
    const nestedFilename = pathParts.length > 1
      ? `${pathParts.slice(1).join("/")}/${name}`
      : name;

    samples.push({
      filename: nestedFilename,
      category: categoryName,
      subcategory,
      alias: name.replace(/\.wav$/i, ""),
    });
  }
}

function isMetadataCatalog(value: unknown): value is MetadataCatalog {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as MetadataCatalog).samples)
  );
}

function isIndexData(value: unknown): value is IndexData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const parsed = value as Partial<IndexData>;
  return Array.isArray(parsed.categories) && Array.isArray(parsed.mixLibrary);
}

async function parseCategoryConfigResponse(response: Response): Promise<CategoryConfig> {
  if (response.status === 404) return buildDefaultCategoryConfig();
  if (!response.ok) {
    throw new Error(`Failed to load category config: ${response.status}`);
  }

  const parsed: unknown = await response.json();
  const config = normalizeCategoryConfig(parsed);
  if (!config) {
    throw new Error(`Invalid output/${CATEGORY_CONFIG_FILENAME}`);
  }

  return config;
}

export interface Library {
  loadIndex(): Promise<IndexData>;
  loadSamples(): Promise<Sample[]>;
  loadCategoryConfig?(options?: { force?: boolean }): Promise<CategoryConfig>;
  saveCategoryConfig?(config: CategoryConfig): Promise<void>;
  canWriteCategoryConfig?(): boolean;
  resolveAudioUrl(sample: Sample): Promise<string>;
  dispose(): void;
}

export class FetchLibrary implements Library {
  private indexPromise: Promise<IndexData> | null = null;
  private samplesPromise: Promise<Sample[]> | null = null;
  private categoryConfigPromise: Promise<CategoryConfig> | null = null;

  async loadIndex(): Promise<IndexData> {
    const promise = this.indexPromise ?? (this.indexPromise = (async (): Promise<IndexData> => {
        const response = await fetch("data/index.json");
        if (!response.ok) {
          throw new Error(`Failed to load index: ${response.status}`);
        }

        const parsed: unknown = await response.json();
        if (!isIndexData(parsed)) {
          throw new Error("Invalid data/index.json: missing or malformed categories/mixLibrary");
        }
        return parsed;
      })());

    return promise;
  }

  async loadSamples(): Promise<Sample[]> {
    if (!this.samplesPromise) {
      this.samplesPromise = (async () => {
        const response = await fetch("output/metadata.json");
        if (response.status === 404) return [];
        if (!response.ok) {
          throw new Error(`Failed to load sample catalog: ${response.status}`);
        }

        const parsed: unknown = await response.json();
        if (!isMetadataCatalog(parsed)) {
          throw new Error("Invalid output/metadata.json");
        }

        return parsed.samples;
      })();
    }

    return this.samplesPromise;
  }

  async loadCategoryConfig(options: { force?: boolean } = {}): Promise<CategoryConfig> {
    const force = options.force ?? false;
    if (force || !this.categoryConfigPromise) {
      this.categoryConfigPromise = (async () => {
        const response = await fetch(`output/${CATEGORY_CONFIG_FILENAME}`, {
          cache: force ? "no-store" : "default",
        });
        return parseCategoryConfigResponse(response);
      })();
    }

    return this.categoryConfigPromise;
  }

  async saveCategoryConfig(config: CategoryConfig): Promise<void> {
    if (!import.meta.env.DEV) {
      throw new Error("Category config is read-only in production.");
    }

    const response = await fetch("/__category-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to save category config: ${response.status}`);
    }

    this.categoryConfigPromise = Promise.resolve(buildDefaultCategoryConfig());
    this.categoryConfigPromise = Promise.resolve(config);
  }

  canWriteCategoryConfig(): boolean {
    return import.meta.env.DEV;
  }

  resolveAudioUrl(sample: Sample): Promise<string> {
    return Promise.resolve(sampleAudioPath(sample));
  }

  dispose(): void {
    this.indexPromise = null;
    this.samplesPromise = null;
    this.categoryConfigPromise = null;
  }
}

/* istanbul ignore next -- requires File System Access API; not available in Playwright */
export class FsLibrary implements Library {
  private static readonly MAX_BLOB_CACHE_SIZE = 200;

  private root: FileSystemDirectoryHandle;
  private blobCache = new Map<string, string>();
  private indexPromise: Promise<IndexData> | null = null;
  private samplesPromise: Promise<Sample[]> | null = null;
  private categoryConfigPromise: Promise<CategoryConfig> | null = null;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  async loadIndex(): Promise<IndexData> {
    if (!this.indexPromise) {
      this.indexPromise = (async () => {
        const [samples, categoryConfig] = await Promise.all([
          this.loadSamples(),
          this.loadCategoryConfig(),
        ]);
        const categories = buildCategoryEntries(samples, categoryConfig.categories);
        return { categories, mixLibrary: [] };
      })();
    }

    return this.indexPromise;
  }

  async loadSamples(): Promise<Sample[]> {
    if (!this.samplesPromise) {
      this.samplesPromise = this.loadSamplesUncached();
    }

    return this.samplesPromise;
  }

  async loadCategoryConfig(options: { force?: boolean } = {}): Promise<CategoryConfig> {
    const force = options.force ?? false;
    if (force || !this.categoryConfigPromise) {
      this.categoryConfigPromise = this.loadCategoryConfigUncached();
    }

    return this.categoryConfigPromise;
  }

  private async loadSamplesUncached(): Promise<Sample[]> {
    try {
      const metaHandle = await this.root.getFileHandle("metadata.json");
      const file = await metaHandle.getFile();
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (isMetadataCatalog(parsed)) {
        return parsed.samples;
      }
    } catch {
      // Fall back to scanning the normalized category tree.
    }

    const samples: Sample[] = [];
    for await (const [name, handle] of this.root.entries()) {
      if (handle.kind !== "directory") continue;
      await collectCategorySamples(handle as FileSystemDirectoryHandle, name, [], samples);
    }
    return samples;
  }

  private async loadCategoryConfigUncached(): Promise<CategoryConfig> {
    try {
      const configHandle = await this.root.getFileHandle(CATEGORY_CONFIG_FILENAME);
      const file = await configHandle.getFile();
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const config = normalizeCategoryConfig(parsed);
      if (config) {
        return config;
      }
    } catch {
      // Fall back to the built-in config when categories.json is missing.
    }

    return buildDefaultCategoryConfig();
  }

  canWriteCategoryConfig(): boolean {
    return false;
  }

  async resolveAudioUrl(sample: Sample): Promise<string> {
    const category = sample.category ?? "Unsorted";
    if (!isValidPathComponent(category)) {
      throw new Error(`Invalid audio path for sample: ${sample.filename}`);
    }

    const categoryDir = await this.root.getDirectoryHandle(category);

    let currentDir = categoryDir;
    if (sample.subcategory) {
      if (!isValidPathComponent(sample.subcategory)) {
        throw new Error(`Invalid audio path for sample: ${sample.filename}`);
      }
      currentDir = await currentDir.getDirectoryHandle(sample.subcategory);
    }

    const filenameParts = normalizeMetadataPath(sample.filename);
    if (filenameParts.some((part) => !isValidPathComponent(part))) {
      throw new Error(`Invalid audio path for sample: ${sample.filename}`);
    }

    const key = sampleAudioPath(sample);
    const cached = this.blobCache.get(key);
    if (cached) return cached;

    for (let i = 0; i < filenameParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(filenameParts[i]);
    }

    const fileHandle = await currentDir.getFileHandle(filenameParts[filenameParts.length - 1]);
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);

    if (this.blobCache.size >= FsLibrary.MAX_BLOB_CACHE_SIZE) {
      const evictCount = Math.max(1, Math.floor(FsLibrary.MAX_BLOB_CACHE_SIZE * 0.1));
      let evicted = 0;
      for (const [cacheKey, cacheUrl] of this.blobCache.entries()) {
        if (evicted >= evictCount) break;
        URL.revokeObjectURL(cacheUrl);
        this.blobCache.delete(cacheKey);
        evicted++;
      }
    }

    this.blobCache.set(key, url);
    return url;
  }

  dispose(): void {
    for (const url of this.blobCache.values()) {
      URL.revokeObjectURL(url);
    }

    this.blobCache.clear();
    this.indexPromise = null;
    this.samplesPromise = null;
    this.categoryConfigPromise = null;
  }
}

/* istanbul ignore next -- requires File System Access API; not available in Playwright */
export async function pickLibraryFolder(): Promise<FsLibrary> {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  return new FsLibrary(handle);
}
