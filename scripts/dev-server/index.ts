/**
 * dev-server/index.ts — Business logic extracted from vite.config.ts.
 *
 * All functions here are pure (no Vite or http types) so they can be
 * unit-tested directly without starting a Vite server.
 *
 * Consumers:
 *   - vite.config.ts (imports to wire into Vite middleware)
 *   - scripts/__tests__/vite-mix-url.test.ts (unit tests)
 */

import type { IncomingMessage, ServerResponse } from "http";
import { existsSync, statSync, writeFileSync } from "fs";
import { resolve, sep } from "path";

import { ARCHIVE_MIX_DIRS } from "../build-index.js";
import { normalizeCategoryConfig } from "../../src/data.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type SampleMetadataRecord = Record<string, unknown>;

export type SampleMetadataManifest = {
  samples: SampleMetadataRecord[];
  total_samples?: number;
  per_category?: Record<string, number>;
} & Record<string, unknown>;

export type SampleMoveRequest = {
  filename: string;
  oldCategory: string;
  oldSubcategory: string | null;
  newCategory: string;
  newSubcategory: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────

/** Characters that are unsafe in path segments (Windows shell-special + path-special). */
const UNSAFE_SEGMENT_CHARS = /[:*?"<>|]/;

// ── resolveMixUrl ─────────────────────────────────────────────────────────

/**
 * Resolve a `/mix/<productId>/<filename>` request URL to an on-disk archive
 * path. Returns `null` for any URL that is not a mix request, mentions an
 * unknown product, tries to traverse directories, or points at a file that
 * does not exist on disk. The caller should respond 404 whenever `null` is
 * returned so the middleware remains safe against path-traversal attacks.
 *
 * User-created mixes stored under `archive/_userdata` use IDs of the form
 * `_userdata/<relPath>` (percent-encoded as a single URL segment by the
 * browser). The resolved path is verified to remain within
 * `archiveRoot/_userdata/` to prevent traversal attacks.
 */
export function resolveMixUrl(
  url: string,
  archiveRoot: string,
): { absolutePath: string; productId: string; filename: string } | null {
  const match = /^\/mix\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/.exec(url);
  if (!match) return null;
  const [, rawProductId, rawFilename] = match;
  let productId: string;
  let filename: string;
  try {
    productId = decodeURIComponent(rawProductId);
    filename = decodeURIComponent(rawFilename);
  } catch {
    return null;
  }
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  if (!/\.mix$/i.test(filename)) return null;

  // Handle _userdata groups: productId = "_userdata/<relPath>"
  if (productId.startsWith("_userdata/")) {
    const relPath = productId.slice("_userdata/".length);
    const parts = relPath.split("/");
    if (parts.length === 0 || parts.some((p) => p === ".." || p === "." || p === "")) return null;
    const absolutePath = resolve(archiveRoot, "_userdata", ...parts, filename);
    const expectedPrefix = resolve(archiveRoot, "_userdata") + sep;
    if (!absolutePath.startsWith(expectedPrefix)) return null;
    if (!existsSync(absolutePath)) return null;
    try {
      if (!statSync(absolutePath).isFile()) return null;
    } catch {
      return null;
    }
    return { absolutePath, productId, filename };
  }

  if (!Object.hasOwn(ARCHIVE_MIX_DIRS, productId)) return null;
  const layout = ARCHIVE_MIX_DIRS[productId];
  const absolutePath = resolve(archiveRoot, layout.archiveDir, layout.mixSubdir, filename);
  const expectedPrefix = resolve(archiveRoot, layout.archiveDir, layout.mixSubdir) + sep;
  if (!absolutePath.startsWith(expectedPrefix)) return null;
  if (!existsSync(absolutePath)) return null;
  try {
    if (!statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return { absolutePath, productId, filename };
}

// ── buildPerCategorySummary ───────────────────────────────────────────────

export function buildPerCategorySummary(samples: SampleMetadataRecord[]): Record<string, number> {
  const perCategory: Record<string, number> = {};

  for (const sample of samples) {
    const category = typeof sample["category"] === "string" && sample["category"].trim() !== ""
      ? sample["category"]
      : "Unsorted";
    const subcategory = typeof sample["subcategory"] === "string" && sample["subcategory"].trim() !== ""
      ? sample["subcategory"]
      : null;
    const key = subcategory ? `${category}/${subcategory}` : category;
    perCategory[key] = (perCategory[key] ?? 0) + 1;
  }

  return perCategory;
}

// ── applySampleMoveToManifest ─────────────────────────────────────────────

export function applySampleMoveToManifest(
  manifest: SampleMetadataManifest,
  move: SampleMoveRequest,
): boolean {
  let updated = false;

  for (const sample of manifest.samples) {
    const sampleOldCategory = typeof sample["category"] === "string" ? sample["category"] : "";
    const sampleOldSubcategory = typeof sample["subcategory"] === "string" ? sample["subcategory"] : null;
    if (
      sample["filename"] === move.filename &&
      sampleOldCategory === move.oldCategory &&
      sampleOldSubcategory === (move.oldSubcategory ?? null)
    ) {
      sample["category"] = move.newCategory;
      sample["subcategory"] = move.newSubcategory ?? null;
      updated = true;
      break;
    }
  }

  manifest.total_samples = manifest.samples.length;
  manifest.per_category = buildPerCategorySummary(manifest.samples);
  return updated;
}

// ── validateSampleMovePaths ───────────────────────────────────────────────

/**
 * Validate path components for a sample-move request.
 * Returns an error-message string when validation fails, or `null` when the
 * paths are safe. Checks:
 * - shell/path-special characters (`[:*?"<>|]`) in every segment
 * - path-traversal sequences (`..`, `/`, `\\`) in category/subcategory fields
 * - path-separator characters (`/`, `\\`) in the filename
 * - containment: both resolved absolute paths must start with `outputRoot +
 *   path.sep` (guards against drive-letter injection such as `"C:"` and
 *   against a literal `".."` filename escaping the category directory)
 * @internal exported for unit testing
 */
export function validateSampleMovePaths(
  outputRoot: string,
  filename: string,
  oldCategory: string,
  oldSubcategory: string | null,
  newCategory: string,
  newSubcategory: string | null,
): string | null {
  for (const field of [oldCategory, oldSubcategory ?? "", newCategory, newSubcategory ?? ""]) {
    if (field.includes("..") || field.includes("/") || field.includes("\\") || UNSAFE_SEGMENT_CHARS.test(field)) {
      return "Invalid path component";
    }
  }
  if (filename.includes("/") || filename.includes("\\") || UNSAFE_SEGMENT_CHARS.test(filename)) {
    return "Invalid path component";
  }

  const oldParts = [outputRoot, oldCategory, ...(oldSubcategory ? [oldSubcategory] : []), filename];
  const newParts = [outputRoot, newCategory, ...(newSubcategory ? [newSubcategory] : []), filename];
  const oldWav = resolve(...(oldParts as [string, ...string[]]));
  const newWav = resolve(...(newParts as [string, ...string[]]));
  const prefix = outputRoot + sep;
  if (!oldWav.startsWith(prefix) || !newWav.startsWith(prefix)) {
    return "Invalid path component";
  }

  return null;
}

// ── createCategoryConfigMiddleware ────────────────────────────────────────

/** Maximum allowed body size for a `PUT /__category-config` request. */
export const CATEGORY_CONFIG_MAX_BODY_BYTES = 1_048_576; // 1 MiB

/**
 * Returns a Connect-style middleware that handles `PUT /__category-config`.
 *
 * Extracted here (rather than inlined in vite.config.ts) so the 413 path,
 * the JSON validation, and the write path can all be unit-tested without
 * starting a Vite server.
 *
 * @param configPath  Absolute path to write the validated config JSON to.
 * @param onWritten   Called after a successful write (used to emit HMR event).
 * @param warnLog     Logger callback for unexpected errors.
 */
export function createCategoryConfigMiddleware(
  configPath: string,
  onWritten: () => void,
  warnLog: (msg: string) => void,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    if (req.url !== "/__category-config") {
      next();
      return;
    }

    if (req.method !== "PUT") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method not allowed");
      return;
    }

    let body = "";
    let bodyTooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > CATEGORY_CONFIG_MAX_BODY_BYTES) {
        bodyTooLarge = true;
        res.statusCode = 413;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Request entity too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (bodyTooLarge) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid JSON");
        return;
      }
      try {
        const config = normalizeCategoryConfig(parsed);
        if (!config) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid category config");
          return;
        }
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        res.statusCode = 204;
        onWritten();
        res.end();
      } catch (error) {
        warnLog(`[manage-category-config] Failed to write ${configPath}: ${String(error)}`);
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal error");
      }
    });
  };
}
