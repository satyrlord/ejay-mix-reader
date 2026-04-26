#!/usr/bin/env tsx

/**
 * mix-parser.ts — Node.js entry point for the MIX file parser.
 *
 * All parsing logic lives in the browser-compatible canonical parser at
 * `src/mix-parser.ts` (operates on `MixBuffer`).  This shim re-exports
 * every public symbol and provides thin `Buffer`-accepting wrappers so
 * that existing Node scripts can continue to call the parser with plain
 * Node `Buffer` objects (Node's `Buffer` extends `Uint8Array`, which
 * `MixBuffer` accepts directly).
 *
 * Usage:
 *   tsx scripts/mix-parser.ts --file <path>          # parse one file
 *   tsx scripts/mix-parser.ts --dir <path>           # parse all .mix in dir
 *   tsx scripts/mix-parser.ts --all                  # parse every archive .mix
 *   tsx scripts/mix-parser.ts --all --out <path>     # write aggregate JSON
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parseArgs } from "util";

import {
  MixBuffer,
  detectFormat as _detectFormat,
  parseMixBrowser,
  parseFormatA as _parseFormatA,
  parseFormatB as _parseFormatB,
  parseFormatC as _parseFormatC,
  parseFormatD as _parseFormatD,
  parseMixerKV,
  parseCatalogs as _parseCatalogs,
  locateGridTrailer as _locateGridTrailer,
  extractAsciiStrings as _extractAsciiStrings,
  MIN_FILE_SIZE,
  APP_SIG_DANCE1,
  APP_SIG_RAVE,
  APP_SIG_HIPHOP1,
  FA_HEADER_BYTES,
  FA_ROW_BYTES,
  FA_CELL_BYTES,
  FA_COLS,
  FA_ZERO_GAP,
} from "../src/mix-parser.js";

import type {
  MixFormat,
  MixIR,
  CatalogEntry,
  TrackPlacement,
  SampleRef,
  MixerState,
  ChannelState,
  CompressorState,
  DrumMachineState,
  DrumPad,
  DrumEffectsChain,
} from "./mix-types.js";

// ── Re-export the browser parser's public surface ────────────────────────

export { MixBuffer } from "../src/mix-parser.js";

export {
  MIN_FILE_SIZE,
  APP_SIG_DANCE1,
  APP_SIG_RAVE,
  APP_SIG_HIPHOP1,
  FA_HEADER_BYTES,
  FA_ROW_BYTES,
  FA_CELL_BYTES,
  FA_COLS,
  FA_ZERO_GAP,
  parseMixerKV,
} from "../src/mix-parser.js";

// Re-export types for convenience
export type {
  MixFormat,
  MixIR,
  CatalogEntry,
  TrackPlacement,
  SampleRef,
  MixerState,
  ChannelState,
  CompressorState,
  DrumMachineState,
  DrumPad,
  DrumEffectsChain,
};

// ── Buffer-compatible wrappers ────────────────────────────────────────────
// Node's `Buffer` extends `Uint8Array`, so `new MixBuffer(buf)` accepts it
// directly.  These thin shims preserve the existing `Buffer`-typed API used
// by all Node scripts and unit tests.

export function detectFormat(buf: Buffer): MixFormat | null {
  return _detectFormat(new MixBuffer(buf));
}

/** Parse any .mix file buffer into a normalised MixIR. */
export function parseMix(buf: Buffer, productHint?: string): MixIR | null {
  // parseMixBrowser accepts ArrayBuffer | Uint8Array; Buffer extends Uint8Array.
  return parseMixBrowser(buf, productHint);
}

export function parseFormatA(buf: Buffer, productHint?: string): MixIR {
  return _parseFormatA(new MixBuffer(buf), productHint);
}

export function parseFormatB(buf: Buffer, productHint?: string): MixIR {
  return _parseFormatB(new MixBuffer(buf), productHint);
}

export function parseFormatC(buf: Buffer, productHint?: string): MixIR {
  return _parseFormatC(new MixBuffer(buf), productHint);
}

export function parseFormatD(buf: Buffer, productHint?: string): MixIR {
  return _parseFormatD(new MixBuffer(buf), productHint);
}

export function parseCatalogs(buf: Buffer, startOffset: number): {
  catalogs: CatalogEntry[];
  endOffset: number;
} {
  return _parseCatalogs(new MixBuffer(buf), startOffset);
}

export function locateGridTrailer(
  buf: Buffer,
  headerBytes: number,
  threshold: number,
): { gridEnd: number; trailerStart: number } {
  return _locateGridTrailer(new MixBuffer(buf), headerBytes, threshold);
}

export function extractAsciiStrings(buf: Buffer, minLength = 4): string[] {
  return _extractAsciiStrings(new MixBuffer(buf), minLength);
}

// ── File-level convenience ────────────────────────────────────────────────

/** Read and parse a .mix file from disk. */
export function parseFile(filePath: string, productHint?: string): MixIR | null {
  const buf = readFileSync(filePath);
  return parseMixBrowser(buf, productHint);
}

/** List .mix files in a directory (case-insensitive). */
export function listMixFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => /\.mix$/i.test(f))
      .sort()
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function discoverMixDirs(rootDir: string, maxDepth = 4): string[] {
  const dirs: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(current.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current.path, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;
      if (entry.toLowerCase() === "mix") {
        dirs.push(fullPath);
      }
      if (current.depth + 1 < maxDepth) {
        queue.push({ path: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return dirs.sort();
}

export function main(args: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      dir: { type: "string" },
      all: { type: "boolean", default: false },
      out: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const results: Array<{ path: string; mix: MixIR | null; error?: string }> = [];

  if (values.file) {
    const mixPath = resolve(values.file);
    try {
      const mix = parseFile(mixPath);
      results.push({ path: mixPath, mix });
    } catch (err) {
      results.push({ path: mixPath, mix: null, error: String(err) });
    }
  } else if (values.dir) {
    const dirPath = resolve(values.dir);
    for (const f of listMixFiles(dirPath)) {
      try {
        const mix = parseFile(f);
        results.push({ path: f, mix });
      } catch (err) {
        results.push({ path: f, mix: null, error: String(err) });
      }
    }
  } else if (values.all) {
    for (const absDir of discoverMixDirs(resolve("archive"))) {
      for (const f of listMixFiles(absDir)) {
        try {
          const mix = parseFile(f);
          results.push({ path: f, mix });
        } catch (err) {
          results.push({ path: f, mix: null, error: String(err) });
        }
      }
    }
  } else {
    console.error("Usage: tsx scripts/mix-parser.ts --file <path> | --dir <path> | --all [--out <path>]");
    return 1;
  }

  const summary = results.map(r => ({
    path: r.path,
    format: r.mix?.format ?? null,
    product: r.mix?.product ?? null,
    bpm: r.mix?.bpm ?? null,
    author: r.mix?.author ?? null,
    title: r.mix?.title ?? null,
    trackCount: r.mix?.tracks.length ?? 0,
    catalogCount: r.mix?.catalogs.length ?? 0,
    mixerControlCount: r.mix ? countMixerControls(r.mix.mixer.raw) : 0,
    error: r.error ?? null,
  }));

  if (values.out) {
    const outPath = resolve(values.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(values.json ? results : summary, null, 2));
    console.log(`Wrote ${results.length} results to ${outPath}`);
  } else {
    for (const s of summary) {
      const fmt = s.format ?? "?";
      const trk = String(s.trackCount).padStart(4);
      const cat = String(s.catalogCount).padStart(2);
      const mix = String(s.mixerControlCount).padStart(3);
      const err = s.error ? ` ERROR: ${s.error}` : "";
      console.log(
        `[${fmt}] ${basename(s.path).padEnd(20)} ` +
        `BPM=${s.bpm ?? "?"} tracks=${trk} catalogs=${cat} mixer=${mix}` +
        (s.author ? ` by "${s.author}"` : "") +
        (s.title ? ` "${s.title}"` : "") +
        err,
      );
    }
    console.log(`\nTotal: ${results.length} files, ${results.filter(r => r.mix).length} parsed`);
  }

  return results.some(r => r.error) ? 1 : 0;
}

function countMixerControls(raw: Record<string, string>): number {
  return Object.keys(raw).length;
}

// Direct execution
const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, "/").endsWith("scripts/mix-parser.ts");
if (isDirectRun) {
  process.exit(main());
}
