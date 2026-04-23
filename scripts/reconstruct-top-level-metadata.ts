#!/usr/bin/env tsx

/**
 * reconstruct-top-level-metadata.ts — Rebuild minimal top-level metadata.json
 * files from an existing WAV folder layout so rename-samples.ts can operate on
 * products that no longer have a root manifest.
 *
 * Usage:
 *   tsx scripts/reconstruct-top-level-metadata.ts --output-dir output
 *   tsx scripts/reconstruct-top-level-metadata.ts --output-dir output --apply
 *   tsx scripts/reconstruct-top-level-metadata.ts --output-dir output --product Dance_eJay2 --apply
 *   tsx scripts/reconstruct-top-level-metadata.ts --output-dir output --apply --overwrite
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, extname, join, relative } from "path";
import { parseArgs } from "util";
import { cleanName, type ConsolidatedMetadata, type SampleEntry } from "./rename-samples.js";

export interface ReconstructionResult {
  productDir: string;
  metadataPath: string;
  sampleCount: number;
  status: "written" | "dry-run" | "skipped-existing" | "skipped-empty";
  error?: string;
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function stemOf(filePath: string): string {
  const ext = extname(filePath);
  return ext ? basename(filePath, ext) : basename(filePath);
}

function findWavFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    try {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
          results.push(fullPath);
        }
      }
    } catch {
      return;
    }
  }

  walk(dir);
  return results.sort((a, b) => toPosixPath(relative(dir, a)).localeCompare(toPosixPath(relative(dir, b))));
}

function buildSampleEntry(productDir: string, wavPath: string): SampleEntry {
  const relPath = toPosixPath(relative(productDir, wavPath));
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Cannot infer channel folder for root-level WAV: ${wavPath}`);
  }

  const channel = parts[0];
  return {
    filename: relPath,
    alias: stemOf(wavPath),
    category: cleanName(channel),
    channel,
  };
}

export function buildTemporaryMetadata(productDir: string): ConsolidatedMetadata {
  const samples: SampleEntry[] = [];
  for (const wavPath of findWavFiles(productDir)) {
    try {
      samples.push(buildSampleEntry(productDir, wavPath));
    } catch (error) {
      console.warn((error as Error).message);
    }
  }
  return {
    samples,
  };
}

export function reconstructTopLevelMetadata(
  productDir: string,
  options: { apply?: boolean; overwrite?: boolean } = {},
): ReconstructionResult {
  const metadataPath = join(productDir, "metadata.json");
  const apply = options.apply ?? false;
  const overwrite = options.overwrite ?? false;

  if (existsSync(metadataPath) && !overwrite) {
    let existing: ConsolidatedMetadata;
    try {
      existing = JSON.parse(readFileSync(metadataPath, "utf-8")) as ConsolidatedMetadata;
    } catch (err) {
      return {
        productDir,
        metadataPath,
        sampleCount: 0,
        status: "skipped-existing",
        error: `cannot parse existing metadata.json: ${(err as Error).message}`,
      };
    }
    return {
      productDir,
      metadataPath,
      sampleCount: Array.isArray(existing.samples) ? existing.samples.length : 0,
      status: "skipped-existing",
    };
  }

  const meta = buildTemporaryMetadata(productDir);
  if (meta.samples.length === 0) {
    return {
      productDir,
      metadataPath,
      sampleCount: 0,
      status: "skipped-empty",
    };
  }

  if (apply) {
    writeFileSync(metadataPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  }

  return {
    productDir,
    metadataPath,
    sampleCount: meta.samples.length,
    status: apply ? "written" : "dry-run",
  };
}

/* v8 ignore start */
function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "output-dir": { type: "string", default: "output" },
      product: { type: "string" },
      apply: { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
    },
    strict: true,
  });

  const outputDir = values["output-dir"] ?? "output";
  if (!statSync(outputDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`ERROR: Output directory not found: ${outputDir}`);
    process.exit(1);
  }

  let products: string[];
  if (values.product) {
    const productDir = join(outputDir, values.product);
    if (!statSync(productDir, { throwIfNoEntry: false })?.isDirectory()) {
      console.error(`ERROR: Product directory not found: ${productDir}`);
      process.exit(1);
    }
    products = [productDir];
  } else {
    products = readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(outputDir, entry.name))
      .sort();
  }

  let written = 0;
  let dryRun = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;

  for (const productDir of products) {
    const result = reconstructTopLevelMetadata(productDir, {
      apply: values.apply,
      overwrite: values.overwrite,
    });

    const name = basename(productDir);
    switch (result.status) {
      case "written":
        written += 1;
        console.log(`${name}: wrote metadata.json (${result.sampleCount} samples)`);
        break;
      case "dry-run":
        dryRun += 1;
        console.log(`${name}: would write metadata.json (${result.sampleCount} samples)`);
        break;
      case "skipped-existing":
        skippedExisting += 1;
        console.log(`${name}: skipped (metadata.json already exists)`);
        break;
      case "skipped-empty":
        skippedEmpty += 1;
        console.log(`${name}: skipped (no WAV files found)`);
        break;
    }
  }

  console.log(
    `\nSummary: ${written} written, ${dryRun} dry-run, ${skippedExisting} skipped-existing, ${skippedEmpty} skipped-empty`,
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("reconstruct-top-level-metadata.ts") ||
    process.argv[1].endsWith("reconstruct-top-level-metadata.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */