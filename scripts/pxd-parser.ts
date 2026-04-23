#!/usr/bin/env tsx

/**
 * PXD Parser — Extract audio samples from eJay PXD files and packed archives.
 *
 * Decodes the proprietary PXD compression format used by eJay music software
 * (late 1990s / early 2000s) and writes standard WAV files + a metadata catalog.
 * Optionally enriches samples with category data from a Pxddance catalog and
 * organizes output into named subdirectories.
 *
 * Usage:
 *   tsx scripts/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1
 *   tsx scripts/pxd-parser.ts archive/Dance_eJay2/D_ejay2/PXD/DANCE20 --output output/Dance_eJay2
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { parseArgs } from "util";

import { readWavInfo } from "./wav-decode.js";

// --- PXD Format Constants ---

export const PXD_MAGIC = Buffer.from("tPxD", "ascii");
export const WAV_MAGIC = Buffer.from("RIFF", "ascii");
const AUDIO_MARKER = 0x54; // 'T'

/** Dictionary-define opcodes: byte value → snippet length */
export const OPCODES: Record<number, number> = { 0xf4: 1, 0xf5: 2, 0xf6: 3, 0xf7: 4, 0xf8: 5 };

const LITERAL_ESCAPE = 0xff;
const SILENCE_BYTE = 0x00;
const SILENCE_FILL = Buffer.alloc(5, 0x80);
const INF_REQUIRED_FIELDS = 7;
const INF_DEFAULT_RECORD_STRIDE = 12;

const PRODUCT_BPM: Record<string, number> = {
  dance_ejay1: 140,
  dance_ejay2: 140,
  dance_ejay3: 140,
  dance_ejay4: 140,
  dance_superpack: 140,
  generationpack1_dance: 140,
  generationpack1_rave: 180,
  generationpack1_hiphop: 90,
  hiphop_2: 90,
  hiphop_3: 90,
  hiphop_4: 90,
  hiphop_ejay2: 90,
  hiphop_ejay3: 90,
  hiphop_ejay4: 90,
  house_ejay: 125,
  rave: 180,
  samplekit_dmkit1: 140,
  samplekit_dmkit2: 140,
  samplekit_dmkit3: 140,
  techno_3: 140,
  techno_ejay: 140,
  techno_ejay3: 140,
  xtreme_ejay: 160,
};

// WAV output parameters
export const SAMPLE_RATE = 44100;
export const NUM_CHANNELS = 1;
export const SAMPLE_WIDTH = 2; // 16-bit signed PCM

// DPCM step table — maps decoded byte values (0x01–0xF3) to 16-bit accumulation
// deltas. Extracted from PXD32R4.DLL (Gen 2); Gen 3 DLLs use 2× these values.
// prettier-ignore
export const DPCM_STEP_TABLE: readonly number[] = [
  // 0x00 placeholder (silence opcode, not a delta)
  0,
  // 0x01–0x10
  -25266, -24412, -23582, -22776, -21992, -21232, -20494, -19778,
  -19082, -18406, -17752, -17116, -16500, -15904, -15326, -14766,
  // 0x11–0x20
  -14222, -13696, -13186, -12692, -12214, -11752, -11304, -10872,
  -10454, -10050,  -9660,  -9282,  -8916,  -8564,  -8224,  -7896,
  // 0x21–0x30
   -7578,  -7272,  -6976,  -6690,  -6414,  -6148,  -5892,  -5646,
   -5408,  -5178,  -4958,  -4746,  -4542,  -4346,  -4156,  -3974,
  // 0x31–0x40
   -3798,  -3630,  -3468,  -3312,  -3162,  -3018,  -2880,  -2748,
   -2620,  -2498,  -2380,  -2268,  -2160,  -2056,  -1956,  -1860,
  // 0x41–0x50
   -1768,  -1680,  -1596,  -1516,  -1440,  -1366,  -1296,  -1228,
   -1164,  -1102,  -1044,   -988,   -934,   -882,   -834,   -788,
  // 0x51–0x60
    -744,   -702,   -662,   -624,   -588,   -554,   -520,   -488,
    -458,   -430,   -402,   -376,   -352,   -328,   -306,   -286,
  // 0x61–0x70
    -266,   -248,   -230,   -214,   -198,   -182,   -168,   -154,
    -142,   -130,   -118,   -108,    -98,    -88,    -80,    -72,
  // 0x71–0x80
     -64,    -56,    -50,    -44,    -38,    -32,    -26,    -22,
     -18,    -14,    -10,     -8,     -6,     -4,     -2,      0,
  // 0x81–0x90
       2,      4,      6,      8,     10,     14,     18,     22,
      26,     32,     38,     44,     50,     56,     64,     72,
  // 0x91–0xA0
      80,     88,     98,    108,    118,    130,    142,    154,
     168,    182,    198,    214,    230,    248,    266,    286,
  // 0xA1–0xB0
     306,    328,    352,    376,    402,    430,    458,    488,
     520,    554,    588,    624,    662,    702,    744,    788,
  // 0xB1–0xC0
     834,    882,    934,    988,   1044,   1102,   1164,   1228,
    1296,   1366,   1440,   1516,   1596,   1680,   1768,   1860,
  // 0xC1–0xD0
    1956,   2056,   2160,   2268,   2380,   2498,   2620,   2748,
    2880,   3018,   3162,   3312,   3468,   3630,   3798,   3974,
  // 0xD1–0xE0
    4156,   4346,   4542,   4746,   4958,   5178,   5408,   5646,
    5892,   6148,   6414,   6690,   6976,   7272,   7578,   7896,
  // 0xE1–0xF0
    8224,   8564,   8916,   9282,   9660,  10050,  10454,  10872,
   11304,  11752,  12214,  12692,  13186,  13696,  14222,  14766,
  // 0xF1–0xF3
   15326,  15904,  16500,
];

// --- PXD Decoding ---

/**
 * Decode PXD-compressed audio data to raw 8-bit unsigned PCM.
 *
 * The PXD codec uses dictionary-based compression:
 *   - 0xF4..0xF8 NN D1..Dn — define dict[NN] = n data bytes, emit them
 *   - 0xFF DD              — literal escape, emit byte DD
 *   - 0x00                 — emit 5 silence samples (0x80)
 *   - NN (if in dict)      — back-reference, emit dict[NN]
 *   - NN (if not in dict)  — literal, emit byte NN
 */
export function decodePxdAudio(compressed: Buffer, decodedSize: number): Buffer {
  const dictionary = new Map<number, Buffer>();
  const output = Buffer.alloc(decodedSize, 0x80);
  let writeOffset = 0;
  let pos = 0;
  const length = compressed.length;

  const writeBytes = (bytes: Buffer): void => {
    const remaining = output.length - writeOffset;
    if (remaining <= 0) return;

    const bytesToCopy = Math.min(remaining, bytes.length);
    bytes.copy(output, writeOffset, 0, bytesToCopy);
    writeOffset += bytesToCopy;
  };

  while (pos < length && writeOffset < decodedSize) {
    const b = compressed[pos];

    if (b in OPCODES) {
      const snippetLen = OPCODES[b];
      if (pos + 2 + snippetLen > length) break;
      const key = compressed[pos + 1];
      const payload = compressed.subarray(pos + 2, pos + 2 + snippetLen);
      dictionary.set(key, Buffer.from(payload));
      writeBytes(payload);
      pos += 2 + snippetLen;
    } else if (b === LITERAL_ESCAPE) {
      if (pos + 1 >= length) break;
      output[writeOffset] = compressed[pos + 1];
      writeOffset++;
      pos += 2;
    } else if (b === SILENCE_BYTE) {
      writeBytes(SILENCE_FILL);
      pos += 1;
    } else if (dictionary.has(b)) {
      writeBytes(dictionary.get(b)!);
      pos += 1;
    } else {
      output[writeOffset] = b;
      writeOffset++;
      pos += 1;
    }
  }

  return output;
}

/**
 * Convert 8-bit DPCM delta codes to 16-bit signed PCM via accumulation.
 */
export function applyDpcm(decodedBytes: Buffer, scale = 1): Buffer {
  let accum = 0;
  const out = Buffer.alloc(decodedBytes.length * 2);

  for (let i = 0; i < decodedBytes.length; i++) {
    const b = decodedBytes[i];
    if (b < DPCM_STEP_TABLE.length) {
      accum += DPCM_STEP_TABLE[b] * scale;
    }
    if (accum > 32767) accum = 32767;
    else if (accum < -32768) accum = -32768;
    out.writeInt16LE(accum, i * 2);
  }

  return out;
}

export interface PxdHeader {
  metadataText: string;
  decodedSize: number;
  unknownField: number;
  audioOffset: number;
}

/**
 * Parse a PXD file header. Returns null if the data is not a valid PXD file.
 */
export function parsePxdHeader(data: Buffer): PxdHeader | null {
  if (data.length < 12) return null;

  const magic = data.subarray(0, 4);
  if (magic.equals(WAV_MAGIC)) return null; // plain WAV disguised as .pxd

  if (!magic.equals(PXD_MAGIC)) return null;

  const metaLen = data[4];
  const metaEnd = 5 + metaLen;
  if (metaEnd + 7 > data.length) return null;

  const metadataRaw = data.subarray(5, metaEnd);
  // Strip trailing nulls
  let trimEnd = metadataRaw.length;
  while (trimEnd > 0 && metadataRaw[trimEnd - 1] === 0) trimEnd--;
  const metadataText = metadataRaw.subarray(0, trimEnd).toString("latin1");

  const marker = data[metaEnd];
  if (marker !== AUDIO_MARKER) return null;

  const decodedSize = data.readUInt32LE(metaEnd + 1);
  const unknownField = data.readUInt16LE(metaEnd + 5);
  const audioOffset = metaEnd + 7;

  return { metadataText, decodedSize, unknownField, audioOffset };
}

export interface PxdDecodeResult {
  pcm: Buffer;
  metadataText: string;
  decodedSize: number;
  unknownField: number;
}

/**
 * Decode a complete PXD file.
 * Returns null for WAV/invalid files.
 */
export function decodePxdFile(data: Buffer): PxdDecodeResult | null {
  const header = parsePxdHeader(data);
  if (!header) return null;

  const compressed = data.subarray(header.audioOffset);
  const pcm = decodePxdAudio(compressed, header.decodedSize);
  return {
    pcm,
    metadataText: header.metadataText,
    decodedSize: header.decodedSize,
    unknownField: header.unknownField,
  };
}

/**
 * Write raw PCM data as a WAV file.
 */
export function writeWav(
  path: string,
  pcmData: Buffer,
  sampleRate = SAMPLE_RATE,
  numChannels = NUM_CHANNELS,
  sampleWidth = SAMPLE_WIDTH,
): void {
  const dir = dirname(path);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });

  const dataSize = pcmData.length;
  const byteRate = sampleRate * numChannels * sampleWidth;
  const blockAlign = numChannels * sampleWidth;
  const bitsPerSample = sampleWidth * 8;

  // WAV header: 44 bytes
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  writeFileSync(path, Buffer.concat([header, pcmData]));
}

// --- Metadata Parsing ---

export interface MetadataFields {
  raw: string;
  alias?: string;
  detail?: string;
  category?: string;
}

/**
 * Parse CRLF-separated PXD metadata into structured fields.
 */
export function parseMetadataFields(text: string): MetadataFields {
  const fields = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  const result: MetadataFields = { raw: text };
  if (fields.length >= 1) result.alias = fields[0];
  if (fields.length >= 2) result.detail = fields[1];
  if (fields.length >= 5) result.category = fields[4];

  return result;
}

// --- INF Catalog Parsing ---

export interface InfEntry {
  sample_id: number;
  filename: string;
  offset: number;
  size: number;
  category: string;
  alias: string;
}

/**
 * Parse an INF catalog file describing a packed archive.
 */
export function parseInfCatalog(infPath: string): InfEntry[] {
  const text = readFileSync(infPath, "ascii");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries: InfEntry[] = [];
  let i = 0;

  // Find [SAMPLES] section
  while (i < lines.length) {
    if (lines[i].trim() === "[SAMPLES]") {
      i++;
      break;
    }
    i++;
  }

  const looksLikeEntryStart = (index: number): boolean => {
    if (index + INF_REQUIRED_FIELDS - 1 >= lines.length) return false;
    const sampleId = parseInt(lines[index].trim(), 10);
    const offset = parseInt(lines[index + 3].trim(), 10);
    const size = parseInt(lines[index + 4].trim(), 10);
    return !isNaN(sampleId) && !isNaN(offset) && !isNaN(size);
  };

  // Parse entries, tolerating extra tail fields between records.
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("[")) break; // next section
    if (!line) {
      i++;
      continue;
    }

    try {
      if (i + INF_REQUIRED_FIELDS - 1 >= lines.length) break; // truncated INF — stop parsing
      const sampleId = parseInt(lines[i].trim(), 10);
      // _flag = lines[i + 1]
      const filename = lines[i + 2].trim().replace(/^"|"$/g, "");
      const offset = parseInt(lines[i + 3].trim(), 10);
      const size = parseInt(lines[i + 4].trim(), 10);
      const category = lines[i + 5].trim().replace(/^"|"$/g, "");
      const alias = lines[i + 6].trim().replace(/^"|"$/g, "");

      if (!isNaN(sampleId) && !isNaN(offset) && !isNaN(size)) {
        entries.push({ sample_id: sampleId, filename, offset, size, category, alias });
      }

      let nextIndex = i + INF_DEFAULT_RECORD_STRIDE;
      while (nextIndex < lines.length && !looksLikeEntryStart(nextIndex)) {
        if (lines[nextIndex].trim().startsWith("[")) break;
        nextIndex++;
      }
      i = nextIndex;
    } catch {
      i++;
    }
  }

  return entries;
}

interface ArchivePart {
  path: string;
  data: Buffer;
}

function loadArchiveParts(archivePath: string): ArchivePart[] {
  const parts: ArchivePart[] = [{ path: archivePath, data: readFileSync(archivePath) }];

  for (let suffixCode = 97; suffixCode <= 122; suffixCode++) {
    const suffix = String.fromCharCode(suffixCode);
    const candidate = `${archivePath}${suffix}`;
    if (existsSync(candidate)) {
      parts.push({ path: candidate, data: readFileSync(candidate) });
    }
  }

  return parts;
}

function assignArchivePartIndices(entries: readonly InfEntry[], partCount: number): number[] {
  const partIndices: number[] = [];
  let currentPartIndex = 0;
  let previousOffset = -1;

  for (const entry of entries) {
    const repeatedZero = previousOffset === 0 && entry.offset === 0 && partIndices.length > 0;
    const wrapped = previousOffset >= 0 && (
      entry.offset < previousOffset ||
      (entry.offset === 0 && previousOffset > 0) ||
      repeatedZero
    );
    if (wrapped && currentPartIndex + 1 < partCount) {
      currentPartIndex++;
    }
    partIndices.push(currentPartIndex);
    previousOffset = entry.offset;
  }

  return partIndices;
}

function sliceArchiveEntry(part: ArchivePart, entry: InfEntry): Buffer | null {
  const start = entry.offset;
  const end = start + entry.size;
  if (start < 0 || end > part.data.length) return null;

  const entryData = part.data.subarray(start, end);
  return entryData.length >= 10 ? entryData : null;
}

type StereoChannel = "L" | "R";

function parseStereoFilename(name: string): { base: string; channel: StereoChannel } | null {
  const match = name.match(/^(.*?)([LR])$/i);
  if (!match || !match[1]) return null;
  return {
    base: match[1],
    channel: match[2].toUpperCase() as StereoChannel,
  };
}

function parseStereoAlias(alias: string): { base: string; channel: StereoChannel } | null {
  const match = alias.trim().match(/^(.*)\s+\(([LR])\)$/i);
  if (!match || !match[1]) return null;
  return {
    base: match[1].trim(),
    channel: match[2].toUpperCase() as StereoChannel,
  };
}

function isStereoPair(left: InfEntry, right: InfEntry): boolean {
  const leftName = parseStereoFilename(left.filename);
  const rightName = parseStereoFilename(right.filename);
  if (
    leftName &&
    rightName &&
    leftName.base === rightName.base &&
    leftName.channel === "L" &&
    rightName.channel === "R"
  ) {
    return true;
  }

  const leftAlias = parseStereoAlias(left.alias);
  const rightAlias = parseStereoAlias(right.alias);
  return !!(
    leftAlias &&
    rightAlias &&
    leftAlias.base === rightAlias.base &&
    leftAlias.channel === "L" &&
    rightAlias.channel === "R"
  );
}

function stripStereoInfo(entry: InfEntry): { filenameBase: string; aliasBase: string } {
  return {
    filenameBase: parseStereoFilename(entry.filename)?.base ?? entry.filename,
    aliasBase: parseStereoAlias(entry.alias)?.base ?? entry.alias.trim(),
  };
}

interface PackedEntryAudio {
  pcmData: Buffer;
  decodedSamples: number;
  detail?: string;
}

function decodePackedEntryAudio(entryData: Buffer, use16bit: boolean): PackedEntryAudio | null {
  const result = decodePxdFile(entryData);
  if (!result) return null;

  const meta = parseMetadataFields(result.metadataText);
  return {
    pcmData: use16bit ? applyDpcm(result.pcm) : result.pcm,
    decodedSamples: result.decodedSize,
    detail: meta.detail,
  };
}

function interleaveStereoChannels(left: Buffer, right: Buffer, sampleWidth: number): Buffer {
  const silenceByte = sampleWidth === 1 ? 0x80 : 0x00;
  const silenceSample = Buffer.alloc(sampleWidth, silenceByte);
  const frameCount = Math.max(left.length / sampleWidth, right.length / sampleWidth);
  const interleaved = Buffer.alloc(frameCount * sampleWidth * 2);

  for (let frame = 0; frame < frameCount; frame++) {
    const sourceOffset = frame * sampleWidth;
    const targetOffset = frame * sampleWidth * 2;

    if (sourceOffset + sampleWidth <= left.length) {
      left.copy(interleaved, targetOffset, sourceOffset, sourceOffset + sampleWidth);
    } else {
      silenceSample.copy(interleaved, targetOffset);
    }

    if (sourceOffset + sampleWidth <= right.length) {
      right.copy(interleaved, targetOffset + sampleWidth, sourceOffset, sourceOffset + sampleWidth);
    } else {
      silenceSample.copy(interleaved, targetOffset + sampleWidth);
    }
  }

  return interleaved;
}

// --- Extraction Modes ---

export interface CatalogEntry {
  filename: string;
  source?: string;
  source_archive?: string;
  internal_name?: string;
  bank?: string;
  alias?: string;
  category?: string;
  detail?: string;
  duration_sec?: number;
  beats?: number;
  decoded_size?: number;
  sample_rate?: number;
  bit_depth?: number;
  channels?: number;
  format?: string;
  sample_id?: number;
  stereo_pair?: string;
  stereo_channel?: string;
}

function inferProductBpm(pathHint: string): number {
  const normalized = pathHint.replace(/\\/g, "/").toLowerCase();
  for (const [token, bpm] of Object.entries(PRODUCT_BPM)) {
    if (normalized.includes(token)) return bpm;
  }
  return 140;
}

function beatsFromDuration(durationSec: number, bpm: number): number {
  return Math.round((durationSec * bpm) / 60);
}

function summariseChannels(catalog: CatalogEntry[]): number {
  return catalog.reduce((maxChannels, entry) => Math.max(maxChannels, entry.channels ?? 1), 1);
}

/** Recursively glob for files matching a pattern (case-insensitive). */
function globFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const lowerExt = ext.toLowerCase();

  function walk(currentDir: string): void {
    try {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(lowerExt)) {
          results.push(fullPath);
        }
      }
    } catch {
      return;
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Extract all individual PXD files from a directory tree.
 */
export function extractIndividualPxds(
  sourceDir: string,
  outputDir: string,
  use16bit = false,
): CatalogEntry[] {
  const catalog: CatalogEntry[] = [];
  const source = resolve(sourceDir);
  const bpm = inferProductBpm(source);

  const pxdFiles = globFiles(source, ".pxd");
  // Deduplicate on case-insensitive systems
  const seenPaths = new Set<string>();
  const uniqueFiles: string[] = [];
  for (const p of pxdFiles) {
    const key = p.toLowerCase();
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      uniqueFiles.push(p);
    }
  }
  // Also pick up stand-alone WAV files (e.g. eJay Studio sample libraries)
  for (const p of globFiles(source, ".wav")) {
    const key = p.toLowerCase();
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      uniqueFiles.push(p);
    }
  }

  let decodedCount = 0;
  let wavCount = 0;
  let skipped = 0;

  for (const pxdPath of uniqueFiles) {
    const data = readFileSync(pxdPath);
    const relPath = relative(source, pxdPath).replace(/\\/g, "/");
    const parts = relPath.split("/");
    const bank = parts.length > 1 ? parts[0] : "";
    const stem = basename(pxdPath, extname(pxdPath));

    // Check for plain WAV
    if (data.subarray(0, 4).equals(WAV_MAGIC)) {
      const wavName = bank ? `${bank}_${stem}.wav` : `${stem}.wav`;
      const wavOut = join(outputDir, wavName);
      mkdirSync(dirname(wavOut), { recursive: true });
      writeFileSync(wavOut, data);
      wavCount++;

      const entry: CatalogEntry = {
        filename: wavName,
        source: relPath,
        bank,
        alias: stem,
        format: "wav",
      };

      try {
        const info = readWavInfo(data);
        entry.sample_rate = info.sampleRate;
        entry.channels = info.channels;
        entry.bit_depth = info.bitDepth;
        entry.decoded_size = info.dataSize;
        entry.duration_sec = Math.round(info.duration * 10000) / 10000;
        entry.beats = beatsFromDuration(info.duration, bpm);
      } catch {
        // WAV header unreadable — leave audio fields unpopulated
      }

      catalog.push(entry);
      continue;
    }

    const result = decodePxdFile(data);
    if (!result) {
      skipped++;
      continue;
    }

    const { pcm, metadataText: metaText, decodedSize, unknownField: _ } = result;
    const meta = parseMetadataFields(metaText);

    const wavName = bank ? `${bank}_${stem}.wav` : `${stem}.wav`;
    const wavOut = join(outputDir, wavName);

    let pcmData: Buffer;
    if (use16bit) {
      pcmData = applyDpcm(pcm);
      writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 2);
    } else {
      pcmData = pcm;
      writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 1);
    }
    decodedCount++;

    const durationSec = decodedSize / SAMPLE_RATE;
    const beats = beatsFromDuration(durationSec, bpm);
    const bitDepth = use16bit ? 16 : 8;

    const entry: CatalogEntry = {
      filename: wavName,
      source: relPath,
      bank,
      alias: meta.alias ?? stem,
      duration_sec: Math.round(durationSec * 10000) / 10000,
      beats,
      decoded_size: decodedSize,
      sample_rate: SAMPLE_RATE,
      bit_depth: bitDepth,
      channels: 1,
    };
    if (meta.category) entry.category = meta.category;
    if (meta.detail) entry.detail = meta.detail;

    catalog.push(entry);
  }

  console.log(`  Decoded: ${decodedCount} PXD files`);
  if (wavCount) console.log(`  Copied:  ${wavCount} plain WAV files`);
  if (skipped) console.log(`  Skipped: ${skipped} unrecognized files`);

  return catalog;
}

/**
 * Extract PXD samples from a packed archive using its INF catalog.
 */
export function extractPackedArchive(
  archivePath: string,
  outputDir: string,
  infPath: string | null = null,
  use16bit = false,
): CatalogEntry[] {
  archivePath = resolve(archivePath);
  const bpm = inferProductBpm(archivePath);

  // Auto-detect INF file
  if (!infPath) {
    for (const ext of [".inf", ".INF", ".Inf"]) {
      const candidate = archivePath + ext;
      if (existsSync(candidate)) {
        infPath = candidate;
        break;
      }
    }
    if (!infPath) {
      console.error(`  ERROR: No INF catalog found for ${archivePath}`);
      return [];
    }
  }

  const entries = parseInfCatalog(infPath);
  if (entries.length === 0) {
    console.warn(`  WARNING: No sample entries found in ${infPath}`);
    return [];
  }

  const archiveParts = loadArchiveParts(archivePath);
  const partIndices = assignArchivePartIndices(entries, archiveParts.length);
  const catalog: CatalogEntry[] = [];
  let decodedCount = 0;
  let wavCount = 0;
  let skipped = 0;

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    const part = archiveParts[partIndices[entryIndex]];
    const pxdData = sliceArchiveEntry(part, entry);

    if (!pxdData) {
      skipped++;
      continue;
    }

    const nextEntry = entryIndex + 1 < entries.length ? entries[entryIndex + 1] : null;
    if (nextEntry && isStereoPair(entry, nextEntry)) {
      const nextPart = archiveParts[partIndices[entryIndex + 1]];
      const nextData = sliceArchiveEntry(nextPart, nextEntry);
      const leftAudio = nextData ? decodePackedEntryAudio(pxdData, use16bit) : null;
      const rightAudio = nextData ? decodePackedEntryAudio(nextData, use16bit) : null;

      if (leftAudio && rightAudio) {
        const { filenameBase, aliasBase } = stripStereoInfo(entry);
        const safeName = filenameBase.replace(/[/\\]/g, "_");
        const wavName = `${safeName}.wav`;
        const wavOut = join(outputDir, wavName);
        const sampleWidth = use16bit ? 2 : 1;
        const interleaved = interleaveStereoChannels(leftAudio.pcmData, rightAudio.pcmData, sampleWidth);
        writeWav(wavOut, interleaved, SAMPLE_RATE, 2, sampleWidth);
        decodedCount++;

        const durationSec = Math.max(leftAudio.decodedSamples, rightAudio.decodedSamples) / SAMPLE_RATE;
        const beats = beatsFromDuration(durationSec, bpm);
        const detail = leftAudio.detail ?? rightAudio.detail;

        const stereoEntry: CatalogEntry = {
          filename: wavName,
          source_archive: basename(archivePath),
          internal_name: filenameBase,
          sample_id: entry.sample_id,
          alias: aliasBase || entry.alias || filenameBase,
          category: entry.category || nextEntry.category,
          duration_sec: Math.round(durationSec * 10000) / 10000,
          beats,
          decoded_size: interleaved.length,
          sample_rate: SAMPLE_RATE,
          bit_depth: use16bit ? 16 : 8,
          channels: 2,
        };
        if (detail) stereoEntry.detail = detail;

        catalog.push(stereoEntry);
        entryIndex++;
        continue;
      }
    }

    const { filename, category, alias } = entry;
    const safeName = filename.replace(/[/\\]/g, "_");
    const wavName = `${safeName}.wav`;
    const wavOut = join(outputDir, wavName);

    // Check for plain WAV
    if (pxdData.subarray(0, 4).equals(WAV_MAGIC)) {
      mkdirSync(dirname(wavOut), { recursive: true });
      writeFileSync(wavOut, pxdData);
      wavCount++;
      catalog.push({
        filename: wavName,
        source_archive: basename(archivePath),
        internal_name: filename,
        alias,
        category,
        format: "wav",
      });
      continue;
    }

    const result = decodePxdFile(pxdData);
    if (!result) {
      skipped++;
      continue;
    }

    const { pcm, metadataText: metaText, decodedSize } = result;

    let pcmData: Buffer;
    if (use16bit) {
      pcmData = applyDpcm(pcm);
      writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 2);
    } else {
      pcmData = pcm;
      writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 1);
    }
    decodedCount++;

    const durationSec = decodedSize / SAMPLE_RATE;
    const beats = beatsFromDuration(durationSec, bpm);
    const bitDepth = use16bit ? 16 : 8;

    const catEntry: CatalogEntry = {
      filename: wavName,
      source_archive: basename(archivePath),
      internal_name: filename,
      sample_id: entry.sample_id,
      alias,
      category,
      duration_sec: Math.round(durationSec * 10000) / 10000,
      beats,
      decoded_size: decodedSize,
      sample_rate: SAMPLE_RATE,
      bit_depth: bitDepth,
      channels: 1,
    };

    if (metaText) {
      const meta = parseMetadataFields(metaText);
      if (meta.detail) catEntry.detail = meta.detail;
    }

    catalog.push(catEntry);
  }

  console.log(`  Decoded: ${decodedCount} samples from packed archive`);
  if (wavCount) console.log(`  Copied:  ${wavCount} embedded WAV files`);
  if (skipped) console.log(`  Skipped: ${skipped} unrecognized entries`);

  return catalog;
}

/**
 * Identify stereo L/R pairs in the catalog and mark them.
 */
export function mergeStereoPairs(catalog: CatalogEntry[]): CatalogEntry[] {
  const byBase: Record<string, Record<string, CatalogEntry>> = {};

  for (const entry of catalog) {
    const alias = entry.alias ?? "";
    if (alias.endsWith(" L") || alias.endsWith(" R")) {
      const base = alias.slice(0, -2);
      const channel = alias.slice(-1);
      if (!byBase[base]) byBase[base] = {};
      byBase[base][channel] = entry;
    }
  }

  let paired = 0;
  for (const channels of Object.values(byBase)) {
    if (channels["L"] && channels["R"]) {
      channels["L"].stereo_pair = channels["R"].filename;
      channels["L"].stereo_channel = "L";
      channels["R"].stereo_pair = channels["L"].filename;
      channels["R"].stereo_channel = "R";
      paired++;
    }
  }

  if (paired) console.log(`  Stereo:  ${paired} L/R pairs identified`);
  return catalog;
}

// --- Pxddance Catalog Parsing ---

export interface PxddanceEntry {
  path: string;
  category: string;
  flag: string;
  group: string;
  version: string;
}

/**
 * Parse a Pxddance catalog file.
 */
export function parsePxddance(filepath: string): PxddanceEntry[] {
  const data = readFileSync(filepath);
  const text = data.toString("ascii");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const entries: PxddanceEntry[] = [];
  let i = 0;
  while (i + 5 < lines.length) {
    const line0 = lines[i].trim().replace(/^"|"$/g, "");
    const line2 = lines[i + 2].trim().replace(/^"|"$/g, "");
    const line3 = lines[i + 3].trim().replace(/^"|"$/g, "");
    const line4 = lines[i + 4].trim().replace(/^"|"$/g, "");
    const line5 = lines[i + 5].trim().replace(/^"|"$/g, "");

    if (line0.toLowerCase().endsWith(".pxd") || line0.includes("/") || line0.includes("\\")) {
      entries.push({
        path: line0.replace(/\\/g, "/"),
        category: line2,
        flag: line3,
        group: line4,
        version: line5,
      });
      i += 6;
    } else {
      i++;
    }
  }

  return entries;
}

/**
 * Build a lookup from normalized filename key to category info.
 */
export function buildCategoryMap(entries: PxddanceEntry[]): Record<string, PxddanceEntry> {
  const mapping: Record<string, PxddanceEntry> = {};
  for (const e of entries) {
    const pathNorm = e.path.toLowerCase().replace(/\\/g, "/");
    const parts = pathNorm.split("/");
    const bank = parts[0].toUpperCase();
    const filename = parts[parts.length - 1].toUpperCase().replace(/\.PXD$/i, "");
    const key = `${bank}_${filename}`;
    mapping[key] = e;
  }
  return mapping;
}

/**
 * Add category field to catalog entries using a Pxddance-derived map.
 * Returns the number of matched entries.
 */
export function enrichWithCategories(
  catalog: CatalogEntry[],
  categoryMap: Record<string, PxddanceEntry>,
): number {
  let matched = 0;
  for (const sample of catalog) {
    const key = sample.filename.replace(/\.wav$/i, "").toUpperCase();
    if (key in categoryMap) {
      sample.category = categoryMap[key].category;
      matched++;
    }
  }
  return matched;
}

// --- Output Organization ---

const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeFilename(name: string): string {
  let result = name.replace(UNSAFE_CHARS, "_");
  result = result.replace(/\s+/g, " ").trim();
  result = result.replace(/^[. ]+|[. ]+$/g, "");
  return result || "_";
}

function buildDisplayName(sample: CatalogEntry, fmt: string): string {
  const alias = sanitizeFilename((sample.alias ?? "").trim());
  const detail = sanitizeFilename((sample.detail ?? "").trim());
  const category = sanitizeFilename((sample.category ?? "unknown").trim());
  const bank = sanitizeFilename((sample.bank ?? "").trim());
  const channel = (sample.stereo_channel ?? "").trim();
  const beats = String(sample.beats ?? "");

  let result = fmt
    .replace(/\{alias\}/g, alias)
    .replace(/\{detail\}/g, detail)
    .replace(/\{category\}/g, category)
    .replace(/\{bank\}/g, bank)
    .replace(/\{stereo_channel\}/g, channel)
    .replace(/\{beats\}/g, beats);

  // Clean up dangling separators
  result = result.replace(/ -\s*$/, "");
  result = result.replace(/\s*-\s*-/g, " -");
  result = result.replace(/\(\s*\)/g, "");
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/**
 * Rename WAV files in outputDir according to the format template.
 */
export function organizeOutput(catalog: CatalogEntry[], outputDir: string, fmt: string): void {
  const usedNames = new Set<string>();
  const renameMap: Record<string, string> = {};

  for (const sample of catalog) {
    const oldName = sample.filename;
    const oldPath = join(outputDir, oldName);
    if (!existsSync(oldPath)) continue;

    const raw = buildDisplayName(sample, fmt);

    const parts = raw.split("/");
    let safe: string;
    if (parts.length > 1) {
      safe = parts.map(sanitizeFilename).join("/");
    } else {
      safe = sanitizeFilename(raw);
    }

    // Append stereo channel if not already in the alias
    const channel = sample.stereo_channel ?? "";
    if (channel && !fmt.includes("{stereo_channel}")) {
      const alias = sample.alias ?? "";
      if (!alias.endsWith(` ${channel}`)) {
        safe = `${safe} ${channel}`;
      }
    }

    let newName = `${safe}.wav`;

    // Deduplicate
    const key = newName.toLowerCase();
    if (
      usedNames.has(key) ||
      (existsSync(join(outputDir, newName)) &&
        resolve(join(outputDir, newName)) !== resolve(oldPath))
    ) {
      const dotIdx = newName.lastIndexOf(".");
      const base = newName.slice(0, dotIdx);
      const ext = newName.slice(dotIdx);
      let counter = 1;
      while (true) {
        counter++;
        const candidate = `${base} (${counter})${ext}`;
        const candidateKey = candidate.toLowerCase();
        const candidatePath = join(outputDir, candidate);
        if (
          !usedNames.has(candidateKey) &&
          (!existsSync(candidatePath) || resolve(candidatePath) === resolve(oldPath))
        ) {
          newName = candidate;
          break;
        }
      }
    }

    usedNames.add(newName.toLowerCase());
    const newPath = join(outputDir, newName);
    mkdirSync(dirname(newPath), { recursive: true });
    renameSync(oldPath, newPath);
    renameMap[oldName] = newName;
    sample.filename = newName;
  }

  // Fix up stereo_pair references
  for (const sample of catalog) {
    if (sample.stereo_pair && sample.stereo_pair in renameMap) {
      sample.stereo_pair = renameMap[sample.stereo_pair];
    }
  }
}

// --- Source Type Detection ---

export type SourceType = "directory" | "packed_archive" | "single_pxd";

export function detectSourceType(path: string): SourceType | null {
  if (!existsSync(path)) return null;

  const stat = statSync(path);
  if (stat.isDirectory()) return "directory";

  if (stat.isFile()) {
    // Check for INF companion BEFORE reading magic bytes
    for (const ext of [".inf", ".INF", ".Inf"]) {
      if (existsSync(path + ext)) return "packed_archive";
    }
    // Extension-less file with no INF — still likely a packed archive
    if (!basename(path).includes(".")) return "packed_archive";
    // Check magic bytes
    const fd = openSync(path, "r");
    try {
      const header = Buffer.alloc(4);
      const bytesRead = readSync(fd, header, 0, header.length, 0);
      if (bytesRead >= 4 && (header.equals(PXD_MAGIC) || header.equals(WAV_MAGIC))) {
        return "single_pxd";
      }
    } finally {
      closeSync(fd);
    }
    return "single_pxd";
  }

  return null;
}

// --- CLI ---

/* v8 ignore start */
function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o", default: "output" },
      inf: { type: "string" },
      catalog: { type: "string" },
      format: { type: "string", short: "f" },
      "8bit": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length === 0) {
    console.error("Usage: tsx scripts/pxd-parser.ts <source> [--output dir] [--inf path] [--catalog path] [--format template] [--8bit]");
    process.exit(1);
  }

  const source = resolve(positionals[0]);
  const outputDir = resolve(values.output ?? "output");

  const sourceType = detectSourceType(source);
  if (!sourceType) {
    console.error(`Error: ${source} not found`);
    process.exit(1);
  }

  console.log(`Source: ${source} (${sourceType})`);
  console.log(`Output: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true });

  const use16bit = !values["8bit"];
  let catalog: CatalogEntry[];
  const sourceBpm = inferProductBpm(source);

  if (sourceType === "directory") {
    catalog = extractIndividualPxds(source, outputDir, use16bit);
  } else if (sourceType === "packed_archive") {
    catalog = extractPackedArchive(source, outputDir, values.inf ?? null, use16bit);
  } else {
    // single_pxd
    const data = readFileSync(source);
    if (data.subarray(0, 4).equals(WAV_MAGIC)) {
      const wavOut = join(outputDir, basename(source, extname(source)) + ".wav");
      writeFileSync(wavOut, data);
      catalog = [{ filename: basename(wavOut), format: "wav" }];
      console.log("  Copied plain WAV file");
    } else {
      const result = decodePxdFile(data);
      if (!result) {
        console.error(`Error: could not decode ${source}`);
        process.exit(1);
      }
      const wavName = basename(source, extname(source)) + ".wav";
      const wavOut = join(outputDir, wavName);
      let pcmData: Buffer;
      if (use16bit) {
        pcmData = applyDpcm(result.pcm);
        writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 2);
      } else {
        pcmData = result.pcm;
        writeWav(wavOut, pcmData, SAMPLE_RATE, NUM_CHANNELS, 1);
      }
      const meta = parseMetadataFields(result.metadataText);
      const bitDepth = use16bit ? 16 : 8;
      catalog = [{
        filename: wavName,
        alias: meta.alias ?? basename(source, extname(source)),
        duration_sec: Math.round((result.decodedSize / SAMPLE_RATE) * 10000) / 10000,
        beats: beatsFromDuration(result.decodedSize / SAMPLE_RATE, sourceBpm),
        decoded_size: result.decodedSize,
        sample_rate: SAMPLE_RATE,
        bit_depth: bitDepth,
        channels: 1,
      }];
      console.log("  Decoded: 1 PXD file");
    }
  }

  // Identify stereo pairs
  catalog = mergeStereoPairs(catalog);

  // Enrich with category data
  if (values.catalog) {
    const catEntries = parsePxddance(values.catalog);
    const catMap = buildCategoryMap(catEntries);
    const matched = enrichWithCategories(catalog, catMap);
    console.log(`  Categories: ${matched}/${catalog.length} matched from ${values.catalog}`);
  }

  // Organize into named folders
  if (values.format) {
    organizeOutput(catalog, outputDir, values.format);
    console.log(`  Organized: ${catalog.length} files renamed`);
  }

  // Write metadata catalog
  const catalogPath = join(outputDir, "metadata.json");
  writeFileSync(
    catalogPath,
    JSON.stringify(
      {
        source,
        total_samples: catalog.length,
        format: {
          sample_rate: SAMPLE_RATE,
          bit_depth: use16bit ? 16 : 8,
          channels: summariseChannels(catalog),
          encoding: use16bit ? "signed_pcm" : "unsigned_pcm",
        },
        samples: catalog,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`  Catalog: ${catalogPath} (${catalog.length} entries)`);
  console.log("Done.");
}

// Run CLI when executed directly
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("pxd-parser.ts") || process.argv[1].endsWith("pxd-parser.js"));
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
