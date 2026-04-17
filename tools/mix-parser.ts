#!/usr/bin/env tsx

/**
 * mix-parser.ts — Universal MIX file parser for all four eJay format
 * families (A/B/C/D).
 *
 * Reads any `.mix` file and emits a normalised MixIR JSON object.
 *
 * Usage:
 *   tsx tools/mix-parser.ts --file <path>          # parse one file
 *   tsx tools/mix-parser.ts --dir <path>           # parse all .mix in dir
 *   tsx tools/mix-parser.ts --all                  # parse every archive .mix
 *   tsx tools/mix-parser.ts --all --out <path>     # write aggregate JSON
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parseArgs } from "util";

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

// ── Constants ────────────────────────────────────────────────

/** Minimum file size to attempt parsing (skip empty placeholders). */
export const MIN_FILE_SIZE = 4;

/** Gen 1 app signatures (uint16 LE at offset 0x00). */
export const APP_SIG_DANCE1 = 0x0a06;
export const APP_SIG_RAVE   = 0x0a07;
export const APP_SIG_HIPHOP1 = 0x0a08;

const FORMAT_A_SIGS = new Set([APP_SIG_DANCE1, APP_SIG_RAVE, APP_SIG_HIPHOP1]);

/** Format A grid layout. */
export const FA_HEADER_BYTES = 4;
export const FA_ROW_BYTES    = 16;
export const FA_CELL_BYTES   = 2;
export const FA_COLS         = FA_ROW_BYTES / FA_CELL_BYTES; // 8
export const FA_ZERO_GAP     = 32;

/** Implicit BPM per Gen 1 product (not stored in the file). */
const IMPLICIT_BPM: Record<number, number> = {
  [APP_SIG_DANCE1]:  140,
  [APP_SIG_RAVE]:    140,
  [APP_SIG_HIPHOP1]: 90,
};

/** Product labels per Gen 1 app signature. */
const FORMAT_A_PRODUCTS: Record<number, string> = {
  [APP_SIG_DANCE1]:  "Dance_eJay1",
  [APP_SIG_RAVE]:    "Rave_eJay",
  [APP_SIG_HIPHOP1]: "HipHop_eJay1",
};

/** Mixer state field separator: #°_# … %°_% (bytes 23 B0 5F 23 … 25 B0 5F 25). */
const MIXER_SEP_OPEN  = "#\xB0_#";
const MIXER_SEP_CLOSE = "%\xB0_%";

/** SKKENNUNG marker. */
const SKKENNUNG_PREFIX = "#SKKENNUNG#:";

// ── Format auto-detection ────────────────────────────────────

/**
 * Detect the format family of a .mix buffer.
 *
 * Returns null for files that are too small or unrecognised.
 */
export function detectFormat(buf: Buffer): MixFormat | null {
  if (buf.length < MIN_FILE_SIZE) return null;

  const appSig = buf.readUInt16LE(0);
  if (FORMAT_A_SIGS.has(appSig)) return "A";

  // Gen 2/3: scan for #SKKENNUNG# to confirm it's an eJay .mix
  const text = buf.toString("latin1");
  if (text.indexOf("#SKKENNUNG#") === -1) return null;

  // Distinguish D from C from B by mixer state markers
  if (text.indexOf("MixVolume") !== -1 || text.indexOf("DrumPan") !== -1) return "D";
  if (text.indexOf("BOOU") !== -1 || text.indexOf("DrumEQ") !== -1) return "C";
  return "B";
}

// ── Main entry point ─────────────────────────────────────────

/**
 * Parse any .mix file buffer into a normalised MixIR.
 *
 * @param buf         Raw file bytes.
 * @param productHint Product name override (needed for Format A which has
 *                    no embedded product string; optional for B/C/D).
 * @returns Parsed MixIR, or null if the file is too small / unrecognised.
 */
export function parseMix(buf: Buffer, productHint?: string): MixIR | null {
  const format = detectFormat(buf);
  if (!format) return null;

  switch (format) {
    case "A": return parseFormatA(buf, productHint);
    case "B": return parseFormatB(buf, productHint);
    case "C": return parseFormatC(buf, productHint);
    case "D": return parseFormatD(buf, productHint);
  }
}

// ── Format A parser ──────────────────────────────────────────

/**
 * Parse a Gen 1 Format A binary grid.
 *
 * Format A has no embedded text — only a 4-byte header and a uint16 LE
 * grid of sample IDs, optionally followed by a trailer after a ≥ 32-byte
 * zero gap.
 */
export function parseFormatA(buf: Buffer, productHint?: string): MixIR {
  const appSig = buf.readUInt16LE(0);
  const headerAux = buf.readUInt16LE(2);

  const product = productHint ?? FORMAT_A_PRODUCTS[appSig] ?? "Unknown_Gen1";
  const bpm = IMPLICIT_BPM[appSig] ?? 140;

  // Locate grid / trailer boundary via forward-scan for first ≥ 32-byte
  // zero run (same logic as mix-grid-analyzer.ts).
  const { gridEnd, trailerStart } = locateGridTrailer(buf, FA_HEADER_BYTES, FA_ZERO_GAP);

  // Extract grid cells
  const tracks: TrackPlacement[] = [];
  const cellUpperBound = gridEnd >= FA_HEADER_BYTES
    ? gridEnd + 1 - ((gridEnd + 1 - FA_HEADER_BYTES) % FA_CELL_BYTES)
    : FA_HEADER_BYTES;

  for (let off = FA_HEADER_BYTES; off + FA_CELL_BYTES <= cellUpperBound; off += FA_CELL_BYTES) {
    const id = buf.readUInt16LE(off);
    if (id === 0) continue;
    const localOffset = off - FA_HEADER_BYTES;
    const row = Math.floor(localOffset / FA_ROW_BYTES);
    const col = (localOffset % FA_ROW_BYTES) / FA_CELL_BYTES;
    tracks.push({
      beat: row,
      channel: col,
      sampleRef: {
        rawId: id,
        internalName: null,
        displayName: null,
        resolvedPath: null,
        dataLength: null,
      },
    });
  }

  // Extract trailer strings (informational — product sig, sample-pack labels)
  const trailerStrings = trailerStart < buf.length
    ? extractAsciiStrings(buf.subarray(trailerStart))
    : [];

  return {
    format: "A",
    product,
    appId: (headerAux << 16) | appSig,
    bpm,
    bpmAdjusted: null,
    author: null,
    title: null,
    registration: null,
    tracks,
    mixer: emptyMixer(),
    drumMachine: null,
    tickerText: [],
    catalogs: [],
  };
}

// ── Gen 2/3 shared header parser ─────────────────────────────

interface Gen23Header {
  appId: number;
  entryCount: number;
  bpm: number;
  bpm2: number;
  unknown0C: number;
  metadataLen: number;
  author: string | null;
  registration: string | null;
  titleSectionOffset: number;   // byte offset of the 0x01 tag before title
}

/**
 * Parse the 16-byte fixed header and variable-length metadata block
 * shared by Formats B, C, and D.
 */
function parseGen23Header(buf: Buffer): Gen23Header {
  const appId = buf.readUInt32LE(0);
  const entryCount = buf.readUInt32LE(4);
  const bpm = buf.readUInt16LE(8);
  const bpm2 = buf.readUInt16LE(0x0a);
  const unknown0C = buf.readUInt16LE(0x0c);
  const metadataLen = buf.readUInt16LE(0x0e);

  // Metadata block starts at 0x10, contains null-terminated author + SKKENNUNG
  const metaStart = 0x10;
  const metaEnd = metaStart + metadataLen;

  let author: string | null = null;
  let registration: string | null = null;

  if (metaEnd <= buf.length) {
    const metaText = buf.toString("latin1", metaStart, metaEnd);
    const parts = metaText.split("\0").filter(s => s.length > 0);

    for (const p of parts) {
      if (p.startsWith(SKKENNUNG_PREFIX)) {
        registration = p.slice(SKKENNUNG_PREFIX.length);
      } else if (author === null) {
        author = p;
      }
    }
  }

  // The 0x01 tag immediately follows the metadata block
  const titleSectionOffset = metaEnd;

  return {
    appId,
    entryCount,
    bpm,
    bpm2,
    unknown0C,
    metadataLen,
    author,
    registration,
    titleSectionOffset,
  };
}

/**
 * Read the title string from the title section.
 *
 * The metadata block (metadataLen bytes starting at 0x10) includes a
 * trailing 0x01 tag as its last byte. Immediately after the metadata
 * block the title section begins with `<uint16 LE sectionLen>` followed
 * by a null-terminated title string. In Format C/D the sectionLen
 * encompasses the title, the mixer state block, AND a trailing 0x01 tag
 * that marks the section boundary.
 *
 * Returns { title, afterTitle, sectionEnd }.
 */
function readTitleSection(buf: Buffer, offset: number): {
  title: string | null;
  afterTitle: number;   // byte after the title's null terminator
  sectionEnd: number;   // byte after the full section (offset + 2 + sectionLen)
} {
  if (offset + 2 > buf.length) {
    return { title: null, afterTitle: offset, sectionEnd: offset };
  }

  const sectionLen = buf.readUInt16LE(offset);
  const sectionEnd = offset + 2 + sectionLen;
  const titleStart = offset + 2;

  // Read null-terminated title
  let titleEnd = titleStart;
  while (titleEnd < buf.length && titleEnd < sectionEnd && buf[titleEnd] !== 0x00) {
    titleEnd++;
  }

  const title = titleEnd > titleStart ? buf.toString("latin1", titleStart, titleEnd) : null;
  const afterTitle = titleEnd < buf.length ? titleEnd + 1 : titleEnd; // skip null

  return { title, afterTitle, sectionEnd };
}

// ── Mixer state parser (Format C/D) ─────────────────────────

/**
 * Parse the `Key#°_#Value%°_%` mixer state text block.
 *
 * Returns a map of control-name → raw-value strings.
 */
export function parseMixerKV(text: string): Record<string, string> {
  const kv: Record<string, string> = {};
  // Pattern: ControlName#°_#Value%°_%
  // Where °_ is 0xB0 0x5F in latin1
  const regex = /([^#%]+)#\xB0_#([^%]*)%\xB0_%/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    kv[m[1]] = m[2];
  }
  return kv;
}

function stripVideoOnlyMixerData(kv: Record<string, string>): Record<string, string> {
  if (kv.VideoMix === undefined) {
    return kv;
  }

  const audioOnlyKV = { ...kv };
  delete audioOnlyKV.VideoMix;
  return audioOnlyKV;
}

/**
 * Build a MixerState from raw key-value pairs.
 */
function buildMixerState(kv: Record<string, string>, format: MixFormat): MixerState {
  const channels: ChannelState[] = [];
  const eq: number[] = [];

  if (format === "D") {
    // Format D: MixVolume{N}, MixPan{N}, MixMute{N}, MixSolo{N}
    for (let i = 1; i <= 49; i++) {
      const vol = kv[`MixVolume${i}`];
      const pan = kv[`MixPan${i}`];
      const mute = kv[`MixMute${i}`];
      const solo = kv[`MixSolo${i}`];
      if (vol !== undefined || pan !== undefined) {
        channels.push({
          index: i - 1,
          volume1: vol !== undefined ? parseInt(vol, 10) : null,
          volume2: null,
          pan: pan !== undefined ? parseInt(pan, 10) : null,
          eq: null,
          muted: mute === "active" || mute === "1",
          solo: solo === "active" || solo === "1",
        });
      }
    }
    // 10-band EQ: BO_Equalizer{0..9} or DP_Equalizer{0..9}
    for (let i = 0; i < 10; i++) {
      const v = kv[`BO_Equalizer${i}`] ?? kv[`BOequ${i}`] ?? kv[`BoostEQ_${i}`];
      eq.push(v !== undefined ? parseInt(v, 10) : 50);
    }
  } else {
    // Format C: BOOU1_{N}, BOOU2_{N}, DrumEQ{N}
    for (let i = 0; i < 13; i++) {
      const v1 = kv[`BOOU1_${i}`];
      const v2 = kv[`BOOU2_${i}`];
      const deq = kv[`DrumEQ${i}`];
      if (v1 !== undefined || v2 !== undefined || deq !== undefined) {
        channels.push({
          index: i,
          volume1: v1 !== undefined ? parseInt(v1, 10) : null,
          volume2: v2 !== undefined ? parseInt(v2, 10) : null,
          pan: null,
          eq: deq !== undefined ? parseInt(deq, 10) : null,
          muted: false,
          solo: false,
        });
      }
    }
    // 10-band EQ: BoostEQ_{0..9}
    for (let i = 0; i < 10; i++) {
      const v = kv[`BoostEQ_${i}`];
      eq.push(v !== undefined ? parseInt(v, 10) : 50);
    }
  }

  // Compressor
  let compressor: CompressorState | null = null;
  const cDrive = kv["BoostCompressorDrive"] ?? kv["BO_COMP_DRIVE_SCROLL"] ?? kv["BOcomDri"];
  const cGain  = kv["BoostCompressorGain"]  ?? kv["BO_COMP_GAIN_SCROLL"]  ?? kv["BOcomGai"];
  const cSpeed = kv["BoostCompressorSpeed"] ?? kv["BO_COMP_SPEED_SCROLL"] ?? kv["BOcomSpe"];
  const cLed   = kv["BoostCompressorLED"]   ?? kv["BO_COMP_LED"]          ?? kv["BOcomLED"];
  if (cDrive !== undefined || cGain !== undefined || cSpeed !== undefined) {
    compressor = {
      drive: cDrive !== undefined ? parseInt(cDrive, 10) : 0,
      gain:  cGain  !== undefined ? parseInt(cGain, 10)  : 0,
      speed: cSpeed !== undefined ? parseInt(cSpeed, 10) : 0,
      enabled: cLed === "active" || cLed === "1",
    };
  }

  // Stereo wide
  const sw = kv["BoostStereoWide"] ?? kv["BO_STEREOWIDE_SPREAD_SCROLL"] ?? kv["BOsteSpr"];

  return {
    channels,
    eq,
    compressor,
    stereoWide: sw !== undefined ? parseInt(sw, 10) : null,
    raw: kv,
  };
}

/**
 * Build DrumMachineState from raw key-value pairs (Format D only).
 */
function buildDrumMachine(kv: Record<string, string>): DrumMachineState | null {
  const pads: DrumPad[] = [];
  let maxPad = 0;

  // Detect pad count (16 for HipHop 4, 10 for House)
  for (let i = 1; i <= 16; i++) {
    if (kv[`DrumName${i}`] !== undefined || kv[`DrumVolume${i}`] !== undefined) {
      maxPad = i;
    }
  }
  if (maxPad === 0) return null;

  for (let i = 1; i <= maxPad; i++) {
    pads.push({
      index: i,
      name: kv[`DrumName${i}`] ?? "",
      volume: parseInt(kv[`DrumVolume${i}`] ?? "500", 10),
      pan: parseInt(kv[`DrumPan${i}`] ?? "50", 10),
      pitch: parseInt(kv[`DrumPitch${i}`] ?? "0", 10),
      reversed: kv[`DrumReverse${i}`] === "active",
      fx: kv[`DrumFX${i}`] ?? "passive",
    });
  }

  const effects = buildDrumEffects(kv);
  const masterVol = parseInt(kv["DRUMvolume"] ?? "500", 10);

  return { pads, effects, masterVolume: masterVol };
}

function buildDrumEffects(kv: Record<string, string>): DrumEffectsChain {
  return {
    chorus: {
      drive: parseInt(kv["DRUMchoDri"] ?? "0", 10),
      speed: parseInt(kv["DRUMchoSpe"] ?? "0", 10),
      enabled: kv["DRUMchoLED"] === "active",
    },
    echo: {
      time: parseInt(kv["DRUMechTim"] ?? "0", 10),
      feedback: parseInt(kv["DRUMechFee"] ?? "0", 10),
      volume: parseInt(kv["DRUMechVol"] ?? "0", 10),
      enabled: kv["DRUMechLED"] === "active",
    },
    eq: {
      low: parseInt(kv["DRUMequ1"] ?? "50", 10),
      mid: parseInt(kv["DRUMequ2"] ?? "50", 10),
      high: parseInt(kv["DRUMequ3"] ?? "50", 10),
      enabled: kv["DRUMequLED"] === "active",
    },
    overdrive: {
      drive: parseInt(kv["DRUMoveDri"] ?? "0", 10),
      filter: parseInt(kv["DRUMoveFil"] ?? "0", 10),
      enabled: kv["DRUMoveLED"] === "active",
    },
    reverb: {
      preDelay: parseInt(kv["DRUMrevPre"] ?? "0", 10),
      time: parseInt(kv["DRUMrevtim"] ?? "0", 10),
      volume: parseInt(kv["DRUMrevVol"] ?? "0", 10),
      enabled: kv["DRUMrevLED"] === "active",
    },
  };
}

// ── Catalog parser (Format B/C/D) ────────────────────────────

/**
 * Parse the sample catalog section.
 *
 * Each catalog entry is:
 *   <u16 nameLen> <nameBytes>   where nameBytes = name\0 + 0x01 (nameLen bytes)
 *   [<u16 unknown=0x0009>]      only for the first catalog (product header)
 *   <u32 idStart> <u32 idEnd>
 *
 * The structure terminates when the next u16 is out-of-range (>200)
 * or when we reach a track-entry marker (0x02 0x00 0x00 0x01).
 *
 * Returns { catalogs, endOffset }.
 */
export function parseCatalogs(buf: Buffer, startOffset: number): {
  catalogs: CatalogEntry[];
  endOffset: number;
} {
  const catalogs: CatalogEntry[] = [];
  let offset = startOffset;

  // Skip any leading padding (0x00 bytes)
  while (offset < buf.length && buf[offset] === 0x00) offset++;

  while (offset + 12 <= buf.length) {
    // Stop at track-entry marker: 02 00 00 01 (non-empty)
    if (buf[offset] === 0x02 && buf[offset + 1] === 0x00 &&
        buf[offset + 2] === 0x00 && buf[offset + 3] === 0x01) break;

    // Read u16 nameLen (must include the trailing \0 + 0x01 tag)
    const nameLen = buf.readUInt16LE(offset);
    if (nameLen < 2 || nameLen > 200) break;
    if (offset + 2 + nameLen + 8 > buf.length) break;

    // Last byte of name block must be 0x01, second-to-last must be \0
    const nameBlockEnd = offset + 2 + nameLen;
    if (buf[nameBlockEnd - 1] !== 0x01) break;
    if (buf[nameBlockEnd - 2] !== 0x00) break;

    const name = buf.toString("latin1", offset + 2, nameBlockEnd - 2);

    // Validate name is printable ASCII
    let printable = true;
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) { printable = false; break; }
    }
    if (!printable) break;

    offset = nameBlockEnd;

    // Peek: if the next u32 is implausibly large, there's a 2-byte
    // "unknown" field before idStart (observed only for the first
    // catalog, value 0x0009).
    if (offset + 10 <= buf.length) {
      const peekU32 = buf.readUInt32LE(offset);
      if (peekU32 > 100_000) {
        offset += 2;
      }
    }

    if (offset + 8 > buf.length) break;
    const idStart = buf.readUInt32LE(offset);
    offset += 4;
    const idEnd = buf.readUInt32LE(offset);
    offset += 4;

    catalogs.push({ name, idRangeStart: idStart, idRangeEnd: idEnd });
  }

  return { catalogs, endOffset: offset };
}

// ── Format B parser ──────────────────────────────────────────

/**
 * Parse a Gen 2 Format B file.
 *
 * Structure: 16-byte header → metadata → title → volume grid →
 * catalog entries → track entries (with PXD filenames).
 */
export function parseFormatB(buf: Buffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  // After the title section, scan for the catalog region.
  // The catalog is preceded by a volume grid of variable length.
  // We locate catalogs by scanning for a name-length + recognisable
  // product name pattern.
  const catalogStart = findCatalogStart(buf, sectionEnd);
  const { catalogs, endOffset: afterCatalogs } = parseCatalogs(buf, catalogStart);

  // Parse track entries after the catalogs
  const tracks = parseFormatBTracks(buf, afterCatalogs);

  // Extract ticker text from the later part of the file
  const tickerText = extractTickerText(buf, afterCatalogs);

  const product = productHint ?? inferProduct(catalogs, header.appId) ?? "Unknown_Gen2";

  return {
    format: "B",
    product,
    appId: header.appId,
    bpm: header.bpm,
    bpmAdjusted: header.bpm2 !== header.bpm ? header.bpm2 : null,
    author: header.author,
    title,
    registration: header.registration,
    tracks,
    mixer: emptyMixer(),
    drumMachine: null,
    tickerText,
    catalogs,
  };
}

/**
 * Scan for the catalog start position.
 *
 * Looks for a <u16 nameLen> block where the last byte of the name
 * region is 0x01 and the second-to-last is 0x00 (the catalog tag
 * pattern), with all name bytes printable ASCII.
 */
function findCatalogStart(buf: Buffer, searchFrom: number): number {
  for (let i = Math.max(0, searchFrom); i + 20 < buf.length; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 4 || len > 80) continue;
    const nameBlockEnd = i + 2 + len;
    if (nameBlockEnd + 8 > buf.length) continue;

    // Last two bytes of the name block must be \0 then 0x01
    if (buf[nameBlockEnd - 1] !== 0x01) continue;
    if (buf[nameBlockEnd - 2] !== 0x00) continue;

    // Middle bytes (excluding the \0\x01 terminator) must be printable
    let printable = true;
    for (let j = 0; j < len - 2; j++) {
      const b = buf[i + 2 + j];
      if (b < 0x20 || b > 0x7e) { printable = false; break; }
    }
    if (!printable) continue;

    return i;
  }

  return buf.length; // not found
}

/**
 * Parse Format B track entries.
 *
 * Track entries follow the pattern:
 *   02 00 00 01 <sampleId:u16> <byte> <byte> <pxdName\0> 01 <beat:i16> <flags:u16> <dataLen:u32>
 */
function parseFormatBTracks(buf: Buffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  let offset = startOffset;

  while (offset + 4 < buf.length) {
    // Look for the 02 00 00 01 prefix
    if (buf[offset] !== 0x02) { offset++; continue; }
    if (offset + 3 >= buf.length) break;
    if (buf[offset + 1] !== 0x00 || buf[offset + 2] !== 0x00 || buf[offset + 3] !== 0x01) {
      offset++;
      continue;
    }

    offset += 4;
    if (offset + 4 > buf.length) break;

    const sampleId = buf.readUInt16LE(offset);
    offset += 2;

    // Two bytes (channel/flags)
    const channelByte = buf[offset];
    offset += 2;

    // Read null-terminated PXD filename
    const nameStart = offset;
    while (offset < buf.length && buf[offset] !== 0x00) offset++;
    if (offset >= buf.length) break;

    const name = buf.toString("latin1", nameStart, offset);
    offset++; // skip null

    // If name is empty, this was an empty catalog slot → skip
    if (name.length === 0) continue;

    // Expect 0x01 tag
    if (offset >= buf.length || buf[offset] !== 0x01) continue;
    offset++;

    if (offset + 8 > buf.length) break;

    // Beat position (int16 LE, can be negative)
    const beat = buf.readInt16LE(offset);
    offset += 2;

    // Flags (uint16 LE)
    offset += 2;

    // Sample data length (uint32 LE)
    const dataLen = buf.readUInt32LE(offset);
    offset += 4;

    tracks.push({
      beat,
      channel: channelByte,
      sampleRef: {
        rawId: sampleId,
        internalName: name,
        displayName: null,
        resolvedPath: null,
        dataLength: dataLen > 0 ? dataLen : null,
      },
    });
  }

  return tracks;
}

/**
 * Extract ticker text strings from Format B files.
 *
 * Ticker entries appear after regular track entries and contain short
 * text strings (display words for the scrolling ticker).
 */
function extractTickerText(buf: Buffer, searchFrom: number): string[] {
  const text: string[] = [];
  const fileText = buf.toString("latin1", searchFrom);

  // Look for short null-terminated strings that follow a length prefix
  // Pattern: <len:u16> <text\0> 0x01
  let offset = 0;
  while (offset < fileText.length - 4) {
    // Heuristic: ticker entries follow a recognisable pattern with
    // short (1-20 char) strings. We look for length-prefixed strings.
    const code = fileText.charCodeAt(offset);
    if (code >= 3 && code <= 30) {
      const strStart = offset + 2;
      const strEnd = fileText.indexOf("\0", strStart);
      if (strEnd > strStart && strEnd - strStart < 30) {
        const candidate = fileText.slice(strStart, strEnd);
        // Only include strings that look like words (printable, no control chars)
        if (/^[\x20-\x7e]+$/.test(candidate) && candidate.length >= 1) {
          // Verify the 0x01 tag follows
          if (strEnd + 1 < fileText.length && fileText.charCodeAt(strEnd + 1) === 0x01) {
            text.push(candidate);
            offset = strEnd + 2;
            continue;
          }
        }
      }
    }
    offset++;
  }

  return text;
}

// ── Format C parser ──────────────────────────────────────────

/**
 * Parse a Gen 3 early (Format C) file.
 *
 * Structure: header → metadata → title + mixer state block → volume grid →
 * catalog entries → track entries (with display names + temp paths).
 */
export function parseFormatC(buf: Buffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, afterTitle, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  // Parse mixer state from the text between the title and the section end
  let mixerKV: Record<string, string> = {};
  if (afterTitle < sectionEnd) {
    const mixerText = buf.toString("latin1", afterTitle, sectionEnd);
    mixerKV = stripVideoOnlyMixerData(parseMixerKV(mixerText));
  }

  const mixer = buildMixerState(mixerKV, "C");

  // After the title+mixer section, there's a volume grid section
  // followed by catalogs and track entries.
  // Scan forward from sectionEnd for the catalog start.
  const catalogStart = findCatalogStart(buf, sectionEnd);
  const { catalogs, endOffset: afterCatalogs } = parseCatalogs(buf, catalogStart);

  // Parse audio track entries only. Any Xtreme video payloads were already
  // dropped from mixerKV and are intentionally ignored by the audio player.
  const tracks = parseFormatCTracks(buf, afterCatalogs);

  const product = productHint ?? inferProduct(catalogs, header.appId) ?? "Unknown_Gen3";

  return {
    format: "C",
    product,
    appId: header.appId,
    bpm: header.bpm,
    bpmAdjusted: header.bpm2 !== header.bpm ? header.bpm2 : null,
    author: header.author,
    title,
    registration: header.registration,
    tracks,
    mixer,
    drumMachine: null,
    tickerText: [],
    catalogs,
  };
}

/**
 * Parse Format C track entries.
 *
 * Early Gen 3 records store two temp paths per placement. We walk those
 * path pairs directly so each placement is emitted once instead of once per
 * path string.
 */
function parseFormatCTracks(buf: Buffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  const text = buf.toString("latin1");

  const pathMatches: Array<{ index: number; path: string }> = [];
  const tempPathPattern = /[A-Z]:\\[^\x00\xff]{0,120}?pxd32p[a-z]\.tmp\.?/gi;
  let match: RegExpExecArray | null;
  while ((match = tempPathPattern.exec(text)) !== null) {
    if (match.index >= startOffset) {
      pathMatches.push({ index: match.index, path: match[0] });
    }
  }

  for (let i = 0; i < pathMatches.length; i++) {
    const first = pathMatches[i];
    const second = pathMatches[i + 1];
    if (second) {
      const gap = second.index - (first.index + first.path.length);
      if (gap >= 0 && gap <= 4) {
        i++;
      }
    }

    const nameField = findFormatCDNameField(buf, startOffset, first.index);

    tracks.push({
      beat: 0,
      channel: tracks.length,
      sampleRef: {
        rawId: 0,
        internalName: null,
        displayName: nameField?.name ?? null,
        resolvedPath: null,
        dataLength: null,
      },
    });
  }

  return tracks;
}

function parseFormatDTracks(buf: Buffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  let offset = startOffset;

  while (offset + 6 < buf.length) {
    const left = readLengthPrefixedTempPath(buf, offset);
    if (!left) {
      offset++;
      continue;
    }

    const right = readLengthPrefixedTempPath(buf, left.nextOffset);
    if (!right) {
      offset++;
      continue;
    }

    const nameField = findFormatCDNameField(buf, Math.max(startOffset, offset - 96), left.pathStart);

    tracks.push({
      beat: 0,
      channel: tracks.length,
      sampleRef: {
        rawId: 0,
        internalName: null,
        displayName: nameField?.name ?? null,
        resolvedPath: null,
        dataLength: null,
      },
    });

    offset = right.nextOffset;
  }

  return tracks;
}

function readLengthPrefixedTempPath(
  buf: Buffer,
  lengthOffset: number,
): { pathStart: number; nextOffset: number } | null {
  if (lengthOffset + 4 > buf.length) {
    return null;
  }

  const pathLength = buf.readUInt16LE(lengthOffset);
  if (pathLength < 12 || pathLength > 128) {
    return null;
  }

  const pathStart = lengthOffset + 2;
  const pathEnd = pathStart + pathLength;
  if (pathEnd > buf.length) {
    return null;
  }

  const path = buf.toString("latin1", pathStart, pathEnd);
  if (!isTempPath(path)) {
    return null;
  }

  return {
    pathStart,
    nextOffset: pathEnd,
  };
}

function isTempPath(value: string): boolean {
  return /^[A-Z]:\\.*pxd32p[a-z]\.tmp[.,]?$/i.test(value);
}

function findFormatCDNameField(
  buf: Buffer,
  lowerBound: number,
  pathStart: number,
): { offset: number; name: string } | null {
  const minOffset = Math.max(lowerBound, pathStart - 64);
  for (let offset = pathStart - 2; offset >= minOffset; offset--) {
    if (offset + 2 > buf.length) continue;
    const nameLen = buf.readUInt16LE(offset);
    if (nameLen < 2 || nameLen > 32) continue;

    const nameStart = offset + 2;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > pathStart) continue;

    // In the observed C/D layout the name field ends 8-12 bytes before the
    // first temp path (flags + small metadata + dataLength).
    const gap = pathStart - nameEnd;
    if (gap < 8 || gap > 12) continue;

    const name = buf.toString("latin1", nameStart, nameEnd);
    if (!/^[A-Za-z0-9_ -]+$/.test(name)) continue;

    return { offset, name };
  }

  return null;
}

// ── Format D parser ──────────────────────────────────────────

/**
 * Parse a Gen 3 late (Format D) file.
 *
 * Same as Format C, but with full mixer state (MixVolume/Pan/Mute/Solo)
 * and drum machine parameters (DrumName/Volume/Pan/Pitch/Reverse/FX).
 */
export function parseFormatD(buf: Buffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, afterTitle, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  // Parse mixer state (same as C, but richer)
  let mixerKV: Record<string, string> = {};
  if (afterTitle < sectionEnd) {
    const mixerText = buf.toString("latin1", afterTitle, sectionEnd);
    mixerKV = parseMixerKV(mixerText);
  }

  const mixer = buildMixerState(mixerKV, "D");
  const drumMachine = buildDrumMachine(mixerKV);

  // Catalogs share the same structure as Format C, but the placement records
  // are length-prefixed path pairs rather than null-terminated path strings.
  const catalogStart = findCatalogStart(buf, sectionEnd);
  const { catalogs, endOffset: afterCatalogs } = parseCatalogs(buf, catalogStart);

  const tracks = parseFormatDTracks(buf, afterCatalogs);

  const product = productHint ?? inferProduct(catalogs, header.appId) ?? "Unknown_Gen3";

  return {
    format: "D",
    product,
    appId: header.appId,
    bpm: header.bpm,
    bpmAdjusted: header.bpm2 !== header.bpm ? header.bpm2 : null,
    author: header.author,
    title,
    registration: header.registration,
    tracks,
    mixer,
    drumMachine,
    tickerText: [],
    catalogs,
  };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Locate the grid / trailer boundary via forward-scan for first
 * ≥ threshold-byte zero run (reused from mix-grid-analyzer logic).
 */
export function locateGridTrailer(
  buf: Buffer,
  headerBytes: number,
  threshold: number,
): { gridEnd: number; trailerStart: number } {
  let lastNonZero = -1;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] !== 0) { lastNonZero = i; break; }
  }
  if (lastNonZero < headerBytes) {
    return { gridEnd: lastNonZero, trailerStart: lastNonZero + 1 };
  }

  let zeroRun = 0;
  let runStart = -1;
  for (let i = headerBytes; i <= lastNonZero; i++) {
    if (buf[i] === 0) {
      if (zeroRun === 0) runStart = i;
      zeroRun++;
      continue;
    }
    if (zeroRun >= threshold) {
      return { gridEnd: runStart - 1, trailerStart: i };
    }
    zeroRun = 0;
    runStart = -1;
  }

  return { gridEnd: lastNonZero, trailerStart: lastNonZero + 1 };
}

/** Extract printable ASCII substrings ≥ minLength from a buffer. */
export function extractAsciiStrings(buf: Buffer, minLength: number = 4): string[] {
  const out: string[] = [];
  let current = "";
  for (const b of buf) {
    if (b >= 0x20 && b < 0x7f) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= minLength) out.push(current);
      current = "";
    }
  }
  if (current.length >= minLength) out.push(current);
  return out;
}

/** Infer a product name from catalog entries or app ID. */
function inferProduct(catalogs: CatalogEntry[], appId: number): string | null {
  // The first catalog entry usually names the main product
  if (catalogs.length > 0) {
    const name = catalogs[0].name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
    return name || null;
  }
  return null;
}

/** Create an empty MixerState (for Format A/B). */
function emptyMixer(): MixerState {
  return {
    channels: [],
    eq: [],
    compressor: null,
    stereoWide: null,
    raw: {},
  };
}

// ── File-level convenience ───────────────────────────────────

/**
 * Read and parse a .mix file from disk.
 */
export function parseFile(filePath: string, productHint?: string): MixIR | null {
  const buf = readFileSync(filePath);
  return parseMix(Buffer.from(buf), productHint);
}

/**
 * List .mix files in a directory (case-insensitive).
 */
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

// ── CLI ──────────────────────────────────────────────────────

const KNOWN_MIX_DIRS = [
  "archive/Dance_eJay1/MIX",
  "archive/Dance_eJay2/MIX",
  "archive/Dance_eJay3/MIX",
  "archive/Dance_eJay4/Mix",
  "archive/Dance_SuperPack/MIX",
  "archive/GenerationPack1/Dance/MIX",
  "archive/GenerationPack1/HipHop/MIX",
  "archive/GenerationPack1/Rave/MIX",
  "archive/HipHop 2/MIX",
  "archive/HipHop 3/MIX",
  "archive/HipHop 4/MIX",
  "archive/House_eJay/Mix",
  "archive/Rave/MIX",
  "archive/TECHNO_EJAY/MIX",
  "archive/Techno 3/MIX",
  "archive/Xtreme_eJay/mix",
];

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
    for (const relDir of KNOWN_MIX_DIRS) {
      const absDir = resolve(relDir);
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
    console.error("Usage: tsx tools/mix-parser.ts --file <path> | --dir <path> | --all [--out <path>]");
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
    mixerControlCount: r.mix ? Object.keys(r.mix.mixer.raw).length : 0,
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
        err
      );
    }
    console.log(`\nTotal: ${results.length} files, ${results.filter(r => r.mix).length} parsed`);
  }

  return results.some(r => r.error) ? 1 : 0;
}

// Direct execution
const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, "/").endsWith("tools/mix-parser.ts");
if (isDirectRun) {
  process.exit(main());
}
