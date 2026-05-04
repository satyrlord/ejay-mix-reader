/**
 * dev-server/sample-metadata-plugin.ts — Vite dev-server plugin that handles
 * sample-move requests from the browser UI.
 *
 * Exposes a `PUT /__sample-move` endpoint that:
 *   1. Validates the request body (path-safe filenames, no traversal).
 *   2. Moves the WAV file on disk from one category/subcategory folder to another.
 *   3. Patches `output/metadata.json` in place.
 *   4. Emits a `sample-metadata-updated` HMR event so the browser refreshes.
 *
 * The path-validation and manifest-patching logic live in `index.ts`
 * (`validateSampleMovePaths`, `applySampleMoveToManifest`) and are unit-tested
 * there. This file contains only the Vite plugin shell and HTTP plumbing.
 *
 * Consumers:
 *   - vite.config.ts
 *   - scripts/__tests__/vite-sample-metadata-plugin.test.ts
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { Plugin } from "vite";

import { SAMPLE_METADATA_UPDATED_EVENT } from "../../src/data.js";
import {
  applySampleMoveToManifest,
  validateSampleMovePaths,
} from "./index.js";
import type { SampleMetadataManifest, SampleMoveRequest } from "./index.js";

type OutputRootProvider = string | (() => string);

function resolveOutputRoot(provider: OutputRootProvider): string {
  return typeof provider === "function" ? provider() : provider;
}

/** Maximum allowed body size for a `PUT /__sample-move` request (1 MiB). */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Returns a Vite dev-server plugin that serves `PUT /__sample-move` requests
 * for moving a sample from one category to another.
 *
 * @param outputRoot Absolute path to the `output/` directory that contains
 *   the WAV files and `metadata.json`.
 */
export function manageSampleMetadata(outputRoot: OutputRootProvider): Plugin {
  return {
    name: "manage-sample-metadata",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/__sample-move") {
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
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) {
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
            res.end("Invalid request body");
            return;
          }
          try {
            const activeOutputRoot = resolveOutputRoot(outputRoot);
            if (
              typeof parsed !== "object" ||
              parsed === null ||
              typeof (parsed as Record<string, unknown>).filename !== "string" ||
              typeof (parsed as Record<string, unknown>).oldCategory !== "string" ||
              typeof (parsed as Record<string, unknown>).newCategory !== "string"
            ) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Invalid request body");
              return;
            }

            const { filename, oldCategory, oldSubcategory, newCategory, newSubcategory } =
              parsed as SampleMoveRequest;
            const safeFilename = filename.trim();

            // Security: validate all path components and enforce containment within
            // outputRoot before touching the filesystem.
            const validationError = validateSampleMovePaths(
              activeOutputRoot,
              safeFilename,
              oldCategory,
              oldSubcategory,
              newCategory,
              newSubcategory,
            );
            if (validationError !== null) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end(validationError);
              return;
            }

            // Build source and destination paths (already validated above).
            const oldParts = [
              activeOutputRoot,
              oldCategory,
              ...(oldSubcategory ? [oldSubcategory] : []),
              safeFilename,
            ];
            const newParts = [
              activeOutputRoot,
              newCategory,
              ...(newSubcategory ? [newSubcategory] : []),
              safeFilename,
            ];
            const oldWav = resolve(...(oldParts as [string, ...string[]]));
            const newWav = resolve(...(newParts as [string, ...string[]]));
            const newDir = resolve(
              activeOutputRoot,
              newCategory,
              ...(newSubcategory ? [newSubcategory] : []),
            );
            const isSamePath = oldWav === newWav;

            // Patch output/metadata.json first so invalid requests fail before any file mutation.
            const metaPath = resolve(activeOutputRoot, "metadata.json");
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SampleMetadataManifest;
            const manifestUpdated = applySampleMoveToManifest(meta, {
              filename: safeFilename,
              oldCategory,
              oldSubcategory,
              newCategory,
              newSubcategory,
            });
            if (!manifestUpdated) {
              const sourceLabel = oldSubcategory ? `${oldCategory}/${oldSubcategory}` : oldCategory;
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end(`Sample not found in metadata: ${safeFilename} in ${sourceLabel}`);
              return;
            }

            if (!isSamePath && existsSync(newWav)) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Destination file already exists");
              return;
            }

            let movedWav = false;
            if (!isSamePath && existsSync(oldWav)) {
              mkdirSync(newDir, { recursive: true });
              renameSync(oldWav, newWav);
              movedWav = true;
            } else if (!isSamePath) {
              server.config.logger.warn(
                `[manage-sample-metadata] WAV not found at ${oldWav}; metadata will still be updated`,
              );
            }

            try {
              writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
            } catch (error) {
              if (movedWav) {
                try {
                  renameSync(newWav, oldWav);
                } catch (rollbackError) {
                  server.config.logger.warn(`[manage-sample-metadata] Rollback failed: ${String(rollbackError)}`);
                }
              }
              throw error;
            }

            server.ws.send({ type: "custom", event: SAMPLE_METADATA_UPDATED_EVENT, data: null });
            res.statusCode = 204;
            res.end();
          } catch (error) {
            server.config.logger.warn(`[manage-sample-metadata] Error: ${String(error)}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal error");
          }
        });
      });
    },
  };
}
