// Library abstraction: load samples from a Vite-served folder or a
// user-selected local directory via the File System Access API.

import type { IndexData, ProductEntry, ProductMetadata, Sample } from "./data.js";
import { sampleAudioPath, sampleChannel } from "./data.js";

// ── Public interface ──────────────────────────────────────────

export interface Library {
  loadIndex(): Promise<IndexData>;
  loadProductSamples(productId: string): Promise<Sample[]>;
  resolveAudioUrl(productId: string, sample: Sample): Promise<string>;
  releaseProduct(productId: string): void;
  dispose(): void;
}

// ── Fetch-based library (dev server) ──────────────────────────

export class FetchLibrary implements Library {
  async loadIndex(): Promise<IndexData> {
    const resp = await fetch("data/index.json");
    if (!resp.ok) throw new Error(`Failed to load index: ${resp.status}`);
    return resp.json() as Promise<IndexData>;
  }

  async loadProductSamples(productId: string): Promise<Sample[]> {
    const resp = await fetch(`output/${productId}/metadata.json`);
    if (resp.status === 404) return [];
    if (!resp.ok) throw new Error(`Failed to load metadata for ${productId}: ${resp.status}`);
    const meta: unknown = await resp.json();
    if (!isProductMetadata(meta)) throw new Error(`Invalid metadata for ${productId}`);
    return meta.samples;
  }

  resolveAudioUrl(productId: string, sample: Sample): Promise<string> {
    return Promise.resolve(sampleAudioPath(productId, sample));
  }

  releaseProduct(_productId: string): void {}

  dispose(): void {}
}

// ── File System Access API library ────────────────────────────

/* istanbul ignore next -- requires File System Access API; not available in Playwright */
export class FsLibrary implements Library {
  private static readonly MAX_BLOB_CACHE_SIZE = 200;

  private root: FileSystemDirectoryHandle;
  private blobCache = new Map<string, string>();

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  async loadIndex(): Promise<IndexData> {
    const products: ProductEntry[] = [];

    for await (const [name, handle] of this.root.entries()) {
      if (handle.kind !== "directory") continue;
      const dirHandle = handle as FileSystemDirectoryHandle;

      // Scan sub-directories for channels and .wav file count
      const channels = new Set<string>();
      let sampleCount = 0;
      for await (const [subName, subHandle] of dirHandle.entries()) {
        if (subHandle.kind !== "directory") continue;
        channels.add(subName.toLowerCase());
        const subDir = subHandle as FileSystemDirectoryHandle;
        for await (const [fileName, fileHandle] of subDir.entries()) {
          if (fileHandle.kind === "file" && fileName.toLowerCase().endsWith(".wav")) {
            sampleCount++;
          }
        }
      }

      // Use metadata.json for enrichment if available
      try {
        const metaHandle = await dirHandle.getFileHandle("metadata.json");
        const file = await metaHandle.getFile();
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        if (isProductMetadata(parsed)) {
          if (parsed.samples.length > sampleCount) {
            sampleCount = parsed.samples.length;
          }
          // Add channels from metadata that might not have their own folder
          for (const s of parsed.samples) {
            channels.add(sampleChannel(s));
          }
        }
      } catch {
        // No metadata.json — rely on folder scan only
      }

      // Only include products that have at least one channel
      if (channels.size === 0) continue;

      products.push({
        id: name,
        name: deriveDisplayName(name),
        channels: [...channels].sort(),
        sampleCount,
      });
    }

    products.sort((a, b) => a.name.localeCompare(b.name));
    return { products };
  }

  async loadProductSamples(productId: string): Promise<Sample[]> {
    const productDir = await this.root.getDirectoryHandle(productId);

    // Try metadata.json first for rich sample data
    try {
      const metaHandle = await productDir.getFileHandle("metadata.json");
      const file = await metaHandle.getFile();
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (isProductMetadata(parsed)) return parsed.samples;
      // metadata.json has unexpected shape — fall through to folder scan
    } catch {
      // No metadata.json — fall through to folder scan
    }

    // Scan channel sub-folders for .wav files
    const samples: Sample[] = [];
    for await (const [channelName, channelHandle] of productDir.entries()) {
      if (channelHandle.kind !== "directory") continue;
      const channelDir = channelHandle as FileSystemDirectoryHandle;
      for await (const [fileName, fileHandle] of channelDir.entries()) {
        if (fileHandle.kind === "file" && fileName.toLowerCase().endsWith(".wav")) {
          samples.push({
            filename: fileName,
            channel: channelName,
            alias: fileName.replace(/\.wav$/i, ""),
          });
        }
      }
    }
    return samples;
  }

  async resolveAudioUrl(productId: string, sample: Sample): Promise<string> {
    const channel = sample.channel ?? sample.category ?? "unknown";
    const key = `${productId}/${channel}/${sample.filename}`;
    const cached = this.blobCache.get(key);
    if (cached) return cached;

    const productDir = await this.root.getDirectoryHandle(productId);

    let file: File;
    if (sample.filename.includes("/")) {
      // Gen 1: channel folder is part of filename (e.g. "rap/Come on!.wav")
      const parts = sample.filename.split("/");
      if (parts.some(p => p === ".." || p === "")) {
        throw new Error(`Invalid audio path component in: ${sample.filename}`);
      }
      let dir: FileSystemDirectoryHandle = productDir;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
      file = await fileHandle.getFile();
    } else {
      // Gen 2/3: flat filename, channel folder is separate
      const channelDir = await productDir.getDirectoryHandle(channel);
      const fileHandle = await channelDir.getFileHandle(sample.filename);
      file = await fileHandle.getFile();
    }

    const url = URL.createObjectURL(file);
    if (this.blobCache.size >= FsLibrary.MAX_BLOB_CACHE_SIZE) {
      // Evict oldest 10% of entries to avoid thrashing on rapid sample loads.
      // Deleting the current entry during Map iteration is safe per the ES2015 spec.
      const evictCount = Math.max(1, Math.floor(FsLibrary.MAX_BLOB_CACHE_SIZE * 0.1));
      let evicted = 0;
      for (const [k, u] of this.blobCache.entries()) {
        if (evicted >= evictCount) break;
        URL.revokeObjectURL(u);
        this.blobCache.delete(k);
        evicted++;
      }
    }
    this.blobCache.set(key, url);
    return url;
  }

  releaseProduct(productId: string): void {
    const prefix = `${productId}/`;

    // Deleting the current entry during Map iteration is safe per the ES2015 spec.
    for (const [key, url] of this.blobCache.entries()) {
      if (!key.startsWith(prefix)) continue;
      URL.revokeObjectURL(url);
      this.blobCache.delete(key);
    }
  }

  dispose(): void {
    for (const url of this.blobCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobCache.clear();
  }
}

// ── Helpers ───────────────────────────────────────────────────

function isProductMetadata(value: unknown): value is ProductMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ProductMetadata).samples)
  );
}

/* istanbul ignore next -- only used by FsLibrary */
function deriveDisplayName(folderId: string): string {
  return folderId
    .replace(/_/g, " ")
    .replace(/(\d+)$/, " $1")
    .replace(/\bDMKIT (\d+)\b/g, "DMKIT$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

// ── Folder picker ─────────────────────────────────────────────

/* istanbul ignore next -- requires File System Access API; not available in Playwright */
export async function pickLibraryFolder(): Promise<FsLibrary> {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  return new FsLibrary(handle);
}
