#!/usr/bin/env tsx

/**
 * build-library.ts — One-shot setup: extract, organise, and build the browser
 * library from whatever eJay products are present under archive/.
 *
 * Steps run automatically:
 *   1. pxd-parser.ts          — decode PXD archives → WAV + per-product metadata.json
 *   2. reorganize.ts          — sort WAVs into channel sub-folders
 *   3. enrich-metadata.ts     — backfill BPM / category / beats
 *   4. normalize.ts           — merge all products into a single category tree
 *   5. [promote _normalized]  — move the staged tree into the output/ root
 *   6. rename-samples.ts      — lowercase and tidy filenames
 *   7. extract-mix-metadata   — build data/mix-metadata.json
 *   8. build-index.ts         — build data/index.json
 *
 * After the script finishes, run `npm run serve`, then click
 * "Choose output folder" and point it at the output/ directory.
 *
 * Usage:
 *   npx tsx scripts/build-library.ts
 *   npx tsx scripts/build-library.ts --dry-run   # show commands, change nothing
 *   npx tsx scripts/build-library.ts --force     # re-extract already-done products
 */

import { cpSync, existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_DIR = join(ROOT, "archive");
const OUTPUT_DIR = join(ROOT, "output");
const NORMALIZED_DIR = join(OUTPUT_DIR, "_normalized");

const { values: opts } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

const DRY_RUN = opts["dry-run"] as boolean;
const FORCE = opts.force as boolean;
const IS_WINDOWS = process.platform === "win32";

// ── Product registry ──────────────────────────────────────────────────────────

interface ProductSpec {
  /** Folder id used under output/ */
  id: string;
  /** Human-readable product name */
  label: string;
  /** Path relative to archive/ that must exist for the product to be detected */
  archivePath: string;
  /** Source path to pass to pxd-parser.ts, relative to the repo root */
  parserSource: string;
}

export const PRODUCTS: readonly ProductSpec[] = [
  {
    id: "Dance_eJay1",
    label: "Dance eJay 1",
    archivePath: join("Dance_eJay1", "dance"),
    parserSource: join("archive", "Dance_eJay1", "dance"),
  },
  {
    id: "Dance_eJay2",
    label: "Dance eJay 2",
    archivePath: join("Dance_eJay2", "D_ejay2", "PXD", "DANCE20"),
    parserSource: join("archive", "Dance_eJay2", "D_ejay2", "PXD", "DANCE20"),
  },
  {
    id: "Dance_eJay3",
    label: "Dance eJay 3",
    archivePath: join("Dance_eJay3", "eJay", "pxd", "dance30"),
    parserSource: join("archive", "Dance_eJay3", "eJay", "pxd", "dance30"),
  },
  {
    id: "Dance_eJay4",
    label: "Dance eJay 4",
    archivePath: join("Dance_eJay4", "ejay", "PXD", "DANCE40"),
    parserSource: join("archive", "Dance_eJay4", "ejay", "PXD", "DANCE40"),
  },
  {
    id: "Dance_SuperPack",
    label: "Dance SuperPack",
    archivePath: join("Dance_SuperPack", "dance"),
    parserSource: join("archive", "Dance_SuperPack", "dance"),
  },
  {
    id: "GenerationPack1_Dance",
    label: "Generation Pack 1 (Dance)",
    archivePath: join("GenerationPack1", "Dance", "dance"),
    parserSource: join("archive", "GenerationPack1", "Dance", "dance"),
  },
  {
    id: "GenerationPack1_Rave",
    label: "Generation Pack 1 (Rave)",
    archivePath: join("GenerationPack1", "Rave", "RAVE"),
    parserSource: join("archive", "GenerationPack1", "Rave", "RAVE"),
  },
  {
    id: "GenerationPack1_HipHop",
    label: "Generation Pack 1 (HipHop)",
    archivePath: join("GenerationPack1", "HipHop", "HIPHOP"),
    parserSource: join("archive", "GenerationPack1", "HipHop", "HIPHOP"),
  },
  {
    id: "HipHop_eJay2",
    label: "HipHop eJay 2",
    archivePath: join("HipHop 2", "eJay", "pxd", "HipHop20"),
    parserSource: join("archive", "HipHop 2", "eJay", "pxd", "HipHop20"),
  },
  {
    id: "HipHop_eJay3",
    label: "HipHop eJay 3",
    archivePath: join("HipHop 3", "eJay", "pxd", "hiphop30"),
    parserSource: join("archive", "HipHop 3", "eJay", "pxd", "hiphop30"),
  },
  {
    id: "HipHop_eJay4",
    label: "HipHop eJay 4",
    archivePath: join("HipHop 4", "eJay", "pxd", "HipHop40"),
    parserSource: join("archive", "HipHop 4", "eJay", "pxd", "HipHop40"),
  },
  {
    id: "House_eJay",
    label: "House eJay",
    archivePath: join("House_eJay", "ejay", "PXD", "House10"),
    parserSource: join("archive", "House_eJay", "ejay", "PXD", "House10"),
  },
  {
    id: "Rave",
    label: "Rave eJay",
    archivePath: join("Rave", "RAVE"),
    parserSource: join("archive", "Rave", "RAVE"),
  },
  {
    id: "Techno_eJay",
    label: "Techno eJay",
    archivePath: join("TECHNO_EJAY", "EJAY", "PXD", "RAVE20"),
    parserSource: join("archive", "TECHNO_EJAY", "EJAY", "PXD", "RAVE20"),
  },
  {
    id: "Techno_eJay3",
    label: "Techno eJay 3",
    archivePath: join("Techno 3", "eJay", "pxd", "rave30"),
    parserSource: join("archive", "Techno 3", "eJay", "pxd", "rave30"),
  },
  {
    id: "Xtreme_eJay",
    label: "Xtreme eJay",
    archivePath: join("Xtreme_eJay", "eJay", "PXD", "xejay10"),
    parserSource: join("archive", "Xtreme_eJay", "eJay", "PXD", "xejay10"),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/* v8 ignore start */
function run(script: string, args: string[]): void {
  const display = ["npx", "tsx", script, ...args].join(" ");
  console.log(`\n  > ${display}`);
  if (DRY_RUN) return;

  const result = spawnSync("npx", ["tsx", script, ...args], {
    stdio: "inherit",
    cwd: ROOT,
    shell: IS_WINDOWS,
  });

  if (result.error) {
    console.error(`\nFailed to start: ${display}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nScript exited with code ${String(result.status)}: ${display}`);
    process.exit(result.status ?? 1);
  }
}

function runNpm(scriptName: string): void {
  console.log(`\n  > npm run ${scriptName}`);
  if (DRY_RUN) return;

  const result = spawnSync("npm", ["run", scriptName], {
    stdio: "inherit",
    cwd: ROOT,
    shell: IS_WINDOWS,
  });

  if (result.error) {
    console.error(`\nFailed to start: npm run ${scriptName}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nnpm run ${scriptName} exited with code ${String(result.status)}`);
    process.exit(result.status ?? 1);
  }
}

/** Copy output/_normalized/ into output/ then remove _normalized/. */
function promoteNormalized(): void {
  if (!existsSync(NORMALIZED_DIR)) return;
  console.log("\n  > Promoting output/_normalized/ → output/");
  if (DRY_RUN) return;
  cpSync(NORMALIZED_DIR, OUTPUT_DIR, { recursive: true, force: true });
  rmSync(NORMALIZED_DIR, { recursive: true, force: true });
}
/* v8 ignore stop */

/** Return all products that have an accessible archive subtree. */
export function detectProducts(archiveDir: string): ProductSpec[] {
  return PRODUCTS.filter((p) => existsSync(join(archiveDir, p.archivePath)));
}

// ── Main ──────────────────────────────────────────────────────────────────────

/* v8 ignore start */
function main(): void {
  if (DRY_RUN) console.log("[DRY RUN — no files will be written or moved]\n");

  const found = detectProducts(ARCHIVE_DIR);

  if (found.length === 0) {
    console.error(
      "No eJay product files found in archive/.\n\n" +
      "Copy the install folder from your eJay CD into the matching archive/ sub-folder.\n" +
      "See docs/rebuild-output.md for the expected layout for each product.\n",
    );
    process.exit(1);
  }

  console.log(
    `Found ${found.length} product(s):\n` + found.map((p) => `  • ${p.label}`).join("\n"),
  );

  // Steps 1+2: Per-product: extract → reorganise
  for (const spec of found) {
    const outMeta = join(OUTPUT_DIR, spec.id, "metadata.json");
    const alreadyExtracted = !FORCE && existsSync(outMeta);

    if (alreadyExtracted) {
      console.log(`\n  [skip] ${spec.label} already extracted  (--force to re-run)`);
      continue;
    }

    console.log(`\n── Steps 1+2: ${spec.label} ──`);
    run("scripts/pxd-parser.ts", [spec.parserSource, "--output", join("output", spec.id)]);
    run("scripts/reorganize.ts", [join("output", spec.id)]);
  }

  // Step 3: Enrich all products
  console.log("\n── Step 3: Enrich metadata ──");
  run("scripts/enrich-metadata.ts", []);

  // Step 4: Normalise into output/_normalized
  console.log("\n── Step 4: Normalise ──");
  run("scripts/normalize.ts", []);
  promoteNormalized();

  // Step 5: Tidy filenames
  console.log("\n── Step 5: Rename samples ──");
  run("scripts/rename-samples.ts", ["--apply"]);

  // Steps 6+7: Build browser data
  console.log("\n── Steps 6+7: Build browser data ──");
  runNpm("mix:meta");
  runNpm("build");

  console.log(
    "\n✓ Done!\n\n" +
    "Run `npm run serve` then click 'Choose output folder' and point it at output/\n",
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("build-library.ts") || process.argv[1].endsWith("build-library.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
