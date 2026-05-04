// Library abstraction for the normalized output tree.

import type { CategoryConfig, IndexData, MetadataCatalog, Sample } from "./data.js";
import type { PathConfigSnapshot } from "./path-config.js";
import { isPathConfigSnapshot } from "./path-config.js";
import {
  buildDefaultCategoryConfig,
  CATEGORY_CONFIG_FILENAME,
  EMBEDDED_MIX_MANIFEST_FILENAME,
  embeddedMixSamplesFromManifest,
  mergeSamplesByAudioPath,
  normalizeCategoryConfig,
  parseEmbeddedMixManifest,
  sampleAudioPath,
  UNSORTED_CATEGORY_ID,
} from "./data.js";

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

async function parseEmbeddedMixSamplesResponse(response: Response): Promise<Sample[]> {
  if (response.status === 404 || !response.ok) return [];

  const parsed: unknown = await response.json();
  const manifest = parseEmbeddedMixManifest(parsed);
  return manifest ? embeddedMixSamplesFromManifest(manifest) : [];
}

export interface Library {
  loadIndex(): Promise<IndexData>;
  loadSamples(options?: { force?: boolean }): Promise<Sample[]>;
  loadPathConfig?(options?: { force?: boolean }): Promise<PathConfigSnapshot>;
  updatePathConfig?(patch: { archiveRoots?: string[] | string; outputRoot?: string }): Promise<PathConfigSnapshot>;
  loadCategoryConfig?(options?: { force?: boolean }): Promise<CategoryConfig>;
  saveCategoryConfig?(config: CategoryConfig): Promise<void>;
  canWriteCategoryConfig?(): boolean;
  moveSample?(sample: Sample, newCategory: string, newSubcategory: string | null): Promise<void>;
  resolveAudioUrl(sample: Sample): Promise<string>;
  dispose(): void;
}

export class FetchLibrary implements Library {
  private indexPromise: Promise<IndexData> | null = null;
  private samplesPromise: Promise<Sample[]> | null = null;
  private pathConfigPromise: Promise<PathConfigSnapshot> | null = null;
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

  async loadSamples(options?: { force?: boolean }): Promise<Sample[]> {
    if (options?.force) {
      this.samplesPromise = null;
    }
    if (!this.samplesPromise) {
      this.samplesPromise = (async () => {
        const [catalogResponse, embeddedMixSamples] = await Promise.all([
          fetch("output/metadata.json"),
          fetch(`output/${UNSORTED_CATEGORY_ID}/${EMBEDDED_MIX_MANIFEST_FILENAME}`)
            .then(parseEmbeddedMixSamplesResponse)
            .catch(() => []),
        ]);

        let catalogSamples: Sample[] = [];
        if (catalogResponse.status !== 404) {
          if (!catalogResponse.ok) {
            throw new Error(`Failed to load sample catalog: ${catalogResponse.status}`);
          }

          const parsed: unknown = await catalogResponse.json();
          if (!isMetadataCatalog(parsed)) {
            throw new Error("Invalid output/metadata.json");
          }

          catalogSamples = parsed.samples;
        }

        return mergeSamplesByAudioPath(catalogSamples, embeddedMixSamples);
      })();
    }

    return this.samplesPromise;
  }

  async loadPathConfig(options?: { force?: boolean }): Promise<PathConfigSnapshot> {
    const force = options?.force ?? false;
    if (force) {
      this.pathConfigPromise = null;
    }
    if (!this.pathConfigPromise) {
      this.pathConfigPromise = (async () => {
        const response = await fetch("/__path-config", {
          cache: force ? "no-store" : "default",
        });
        if (!response.ok) {
          throw new Error(`Failed to load path config: ${response.status}`);
        }

        const parsed: unknown = await response.json();
        if (!isPathConfigSnapshot(parsed)) {
          throw new Error("Invalid /__path-config payload");
        }

        return parsed;
      })();
    }

    return this.pathConfigPromise;
  }

  async updatePathConfig(patch: { archiveRoots?: string[] | string; outputRoot?: string }): Promise<PathConfigSnapshot> {
    const response = await fetch("/__path-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      throw new Error(`Failed to save path config: ${response.status}`);
    }

    const parsed: unknown = await response.json();
    if (!isPathConfigSnapshot(parsed)) {
      throw new Error("Invalid /__path-config payload");
    }

    this.pathConfigPromise = Promise.resolve(parsed);
    return parsed;
  }

  async loadCategoryConfig(options?: { force?: boolean }): Promise<CategoryConfig> {
    const force = options?.force ?? false;
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
    const response = await fetch("/__category-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to save category config: ${response.status}`);
    }

    this.categoryConfigPromise = Promise.resolve(config);
  }

  canWriteCategoryConfig(): boolean {
    return true;
  }

  async moveSample(sample: Sample, newCategory: string, newSubcategory: string | null): Promise<void> {
    const response = await fetch("/__sample-move", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: sample.filename,
        oldCategory: sample.category ?? "",
        oldSubcategory: sample.subcategory ?? null,
        newCategory,
        newSubcategory: newSubcategory ?? null,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to move sample: ${response.status}`);
    }
    // Invalidate samples cache so next load reflects the server-side change
    this.samplesPromise = null;
  }

  resolveAudioUrl(sample: Sample): Promise<string> {
    return Promise.resolve(sampleAudioPath(sample));
  }

  dispose(): void {
    this.indexPromise = null;
    this.samplesPromise = null;
    this.pathConfigPromise = null;
    this.categoryConfigPromise = null;
  }
}
