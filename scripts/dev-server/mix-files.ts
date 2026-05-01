/**
 * dev-server/mix-files.ts — Pure helpers for archive .mix file discovery.
 *
 * No Vite imports. Functions here are unit-testable without starting a
 * Vite server or performing any file I/O beyond the target directories.
 *
 * The Vite plugin shells that consume these helpers (`serveMixFiles`,
 * `copyMixFilesPlugin`) still live in `vite.config.ts` until Phase D.2.
 *
 * Consumers:
 *   - vite.config.ts `copyMixFilesPlugin` (Phase D.2)
 *   - scripts/__tests__/vite-mix-files.test.ts
 */

import { existsSync, lstatSync, readdirSync, realpathSync } from "fs";
import { resolve, sep } from "path";

import { ARCHIVE_MIX_DIRS, resolveProductMixDir } from "../build-index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USERDATA_SUBDIR = "_userdata";
const USERDATA_SUBDIR_ALIASES = [USERDATA_SUBDIR, "_user"] as const;

function resolveUserdataSourceDir(archiveRoot: string): string | null {
  for (const subdir of USERDATA_SUBDIR_ALIASES) {
    const candidate = resolve(archiveRoot, subdir);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isContainedRealpath(pathToCheck: string, rootPath: string): boolean {
  try {
    const resolvedPath = realpathSync(pathToCheck);
    const resolvedRoot = realpathSync(rootPath);
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

/** A source → destination pair for one .mix file to be copied into dist. */
export interface MixFileCopyEntry {
  /** Absolute path to the source file in the archive. */
  src: string;
  /** Absolute path to the intended destination inside `outDir`. */
  dest: string;
  /** Canonical product id (key in `ARCHIVE_MIX_DIRS` or `_userdata/<rel>`). */
  productId: string;
  /** Bare filename, e.g. `"START.MIX"`. */
  filename: string;
}

/**
 * Enumerate all .mix files that should be copied from the archive into
 * the production build output directory.
 *
 * The function is pure in the sense that it only reads directory listings
 * and stat calls; it never creates directories or copies files. The caller
 * (the Vite build plugin) is responsible for the actual I/O.
 *
 * @param archiveRoot Absolute path to the `archive/` directory.
 * @param outDir      Absolute path to the target `dist/mix/` directory
 *                    (or any other desired output root).
 * @returns Ordered list of `{ src, dest }` pairs; empty when no files are
 *          found or when the archive directory does not exist.
 */
export function listMixFilesForCopy(
  archiveRoot: string,
  outDir: string,
): MixFileCopyEntry[] {
  const entries: MixFileCopyEntry[] = [];

  // Archive-product mixes
  for (const productId of Object.keys(ARCHIVE_MIX_DIRS)) {
    const resolvedProduct = resolveProductMixDir(productId, archiveRoot);
    if (!resolvedProduct) continue;
    const mixDir = resolvedProduct.mixDir;
    let mixDirRealPath: string;
    try {
      mixDirRealPath = realpathSync(mixDir);
    } catch {
      continue;
    }

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(mixDir);
    } catch {
      continue;
    }

    for (const filename of dirEntries) {
      if (!/\.mix$/i.test(filename)) continue;
      const src = resolve(mixDir, filename);
      try {
        const stats = lstatSync(src);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (!isContainedRealpath(src, mixDirRealPath)) continue;
      const dest = resolve(outDir, productId, filename);
      entries.push({ src, dest, productId, filename });
    }
  }

  // User-created mixes from archive/_userdata — scanned directly without
  // format detection so the copy step doesn't depend on parser correctness.
  collectUserdataMixPairs(archiveRoot, outDir, entries);

  return entries;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk the user-mix tree (`archive/_userdata`, or legacy
 * `archive/_user`) and append one `MixFileCopyEntry`
 * for every `.mix` file found at least one level deep.
 *
 * The copy destination mirrors the source sub-path so that
 * `_userdata/<group>/<file>.mix` copies to `outDir/_userdata/<group>/<file>.mix`.
 */
function collectUserdataMixPairs(
  archiveRoot: string,
  outDir: string,
  entries: MixFileCopyEntry[],
): void {
  const userdataDir = resolveUserdataSourceDir(archiveRoot);
  if (!userdataDir) return;

  let userdataRootReal: string;
  try {
    userdataRootReal = realpathSync(userdataDir);
  } catch {
    return;
  }

  function walk(dir: string, relParts: string[]): void {
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dir);
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const filename of dirEntries) {
      const full = resolve(dir, filename);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          continue;
        }
        if (st.isDirectory()) {
          if (!isContainedRealpath(full, userdataRootReal)) continue;
          subdirs.push(filename);
        } else if (st.isFile() && /\.mix$/i.test(filename) && relParts.length > 0) {
          if (!isContainedRealpath(full, userdataRootReal)) continue;
          const productId = `${USERDATA_SUBDIR}/${relParts.join("/")}`;
          const dest = resolve(outDir, USERDATA_SUBDIR, ...relParts, filename);
          entries.push({ src: full, dest, productId, filename });
        }
      } catch {
        // Unreadable or inaccessible entry — skip.
      }
    }
    for (const sub of subdirs) {
      walk(resolve(dir, sub), [...relParts, sub]);
    }
  }

  walk(userdataDir, []);
}
