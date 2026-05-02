/**
 * mix-parser.ts — Browser-compatible MIX file parser.
 *
 * A self-contained adaptation of `tools/mix-parser.ts` that replaces
 * Node's `Buffer` with `MixBuffer` (a `DataView`/`Uint8Array` wrapper).
 * Public API and output shape (`MixIR`) are identical to the Node version.
 *
 * This module has **no** Node.js dependencies and is safe to import from
 * browser code under `src/`.
 */

import { MixBuffer } from "./mix-buffer.js";
import type {
  CatalogEntry,
  ChannelState,
  CompressorState,
  DrumEffectsChain,
  DrumMachineState,
  DrumPad,
  MixerState,
  MixFormat,
  MixIR,
  TrackPlacement,
} from "./mix-types.js";

// Re-export MixBuffer so consumers can construct one if needed.
export { MixBuffer } from "./mix-buffer.js";

// ── Constants ────────────────────────────────────────────────

export const MIN_FILE_SIZE = 4;

export const APP_SIG_DANCE1  = 0x0a06;
export const APP_SIG_RAVE    = 0x0a07;
export const APP_SIG_HIPHOP1 = 0x0a08;

const FORMAT_A_SIGS = new Set([APP_SIG_DANCE1, APP_SIG_RAVE, APP_SIG_HIPHOP1]);

export const FA_HEADER_BYTES = 2;
export const FA_ROW_BYTES    = 16;
export const FA_CELL_BYTES   = 2;
export const FA_COLS         = FA_ROW_BYTES / FA_CELL_BYTES; // 8

/**
 * Universal Gen 1 grid row count, established empirically across all archived
 * Format A `.mix` files and confirmed against the decompiled VB6 source.
 * Both Grid 1 (placements) and Grid 2 (per-cell metadata) are exactly this
 * many rows, regardless of product.
 */
export const FA_NUM_ROWS     = 351;
export const FA_GRID_BYTES   = FA_ROW_BYTES * FA_NUM_ROWS;          // 5616
export const FA_GRID1_START  = FA_HEADER_BYTES;                     // 2
export const FA_GRID2_START  = FA_GRID1_START + FA_GRID_BYTES;      // 5618 (0x15F2)
export const FA_TRAILER_OFFSET = FA_GRID1_START + FA_GRID_BYTES * 2; // 11234 (0x2BE2)
export const FA_TRAILER_MARKER = 0x0a08;

/**
 * Legacy zero-gap heuristic threshold. The current parser only uses this for
 * short / synthetic buffers that do not contain the deterministic dual-grid
 * layout; full-size archive files are parsed by offset arithmetic instead.
 * Kept exported for the forensics tool (`scripts/mix-grid-analyzer.ts`) and
 * existing tests.
 *
 * @deprecated Prefer the deterministic `FA_TRAILER_OFFSET` constant.
 */
export const FA_ZERO_GAP     = 32;

const IMPLICIT_BPM: Record<number, number> = {
  [APP_SIG_DANCE1]:  140,
  [APP_SIG_RAVE]:    180,
  // HipHop eJay 1 uses a 96 BPM default in the original app transport.
  [APP_SIG_HIPHOP1]: 96,
};

const FORMAT_A_PRODUCTS: Record<number, string> = {
  [APP_SIG_DANCE1]:  "Dance_eJay1",
  [APP_SIG_RAVE]:    "Rave",
  [APP_SIG_HIPHOP1]: "HipHop_eJay1",
};

// Observed archive appIds differ from the early low-word placeholders the
// parser originally used for Gen 2/3. Keep both so catalog-less files can
// still infer a product whether they carry the archive-observed ids or the
// older low-word variants.
export const APP_ID_PRODUCTS: Record<number, string> = {
  0x00000889: "Techno_eJay",
  0x00000a06: "Dance_eJay1",
  0x00000a07: "Rave",
  0x00000a08: "HipHop_eJay1",
  0x00000a19: "Dance_eJay2",
  0x000011d6: "House_eJay",
  0x000011e9: "HipHop_eJay2",
  0x000015dc: "HipHop_eJay4",
  0x00002571: "Dance_eJay3",
  0x00002572: "Techno_eJay3",
  0x00002573: "HipHop_eJay3",
  0x00002964: "Xtreme_eJay",
  0x00002d41: "Dance_eJay4",
  0x00000a09: "Dance_eJay2",
  0x00000a0a: "Dance_eJay3",
  0x00000a0b: "Techno_eJay",
  0x00000a0c: "HipHop_eJay2",
  0x00000a0d: "House_eJay",
  0x00000a0e: "Dance_eJay4",
  0x00000a0f: "Techno_eJay3",
  0x00000a10: "HipHop_eJay3",
  0x00000a11: "HipHop_eJay4",
  0x00000a12: "Xtreme_eJay",
};

const SKKENNUNG_PREFIX = "#SKKENNUNG#:";
const DEFAULT_GEN23_BPM = 120;
const MAX_REASONABLE_MIX_BPM = 400;
const MAX_RECOVERED_FORMAT_CD_BEAT = 16_384;
const FORMAT_B_TIMELINE_SENTINEL = 0x018a7aa9;
const FORMAT_B_TIMELINE_CHANNEL_COUNT = 17;
const FORMAT_B_TIMELINE_POS_DIVISOR = 128;
const FORMAT_B_TIMELINE_MIN_CHUNK_LEN = 4 + FORMAT_B_TIMELINE_CHANNEL_COUNT * 5;
const FORMAT_B_USER_PERC_LANE_CLASS = 2;
const FORMAT_B_USER_PERC_EXTENSION_BYTES = 34;
const FORMAT_B_CORE_EVENT_TAIL_BYTES = 10;

function isValidMixBpm(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_REASONABLE_MIX_BPM;
}

// Latin1 text cache (same purpose as the Node version's WeakMap).
const latin1Cache = new WeakMap<MixBuffer, string>();
function bufLatin1(buf: MixBuffer): string {
  let cached = latin1Cache.get(buf);
  if (cached === undefined) {
    cached = buf.toString("latin1");
    latin1Cache.set(buf, cached);
  }
  return cached;
}

// ── Format auto-detection ────────────────────────────────────

export function detectFormat(buf: MixBuffer): MixFormat | null {
  if (buf.length < MIN_FILE_SIZE) return null;

  const appSig = buf.readUInt16LE(0);
  if (FORMAT_A_SIGS.has(appSig)) return "A";

  const text = bufLatin1(buf);
  if (text.indexOf("#SKKENNUNG#") === -1) return null;

  if (text.indexOf("MixVolume") !== -1 || text.indexOf("DrumPan") !== -1) return "D";
  if (text.indexOf("BOOU") !== -1 || text.indexOf("DrumEQ") !== -1) return "C";
  return "B";
}

// ── Main entry point ─────────────────────────────────────────

/**
 * Parse any `.mix` file from an `ArrayBuffer` (browser fetch) or
 * `Uint8Array` into a normalised `MixIR`.
 */
export function parseMixBrowser(
  data: ArrayBuffer | Uint8Array,
  productHint?: string,
): MixIR | null {
  const buf = new MixBuffer(data);
  return parseMix(buf, productHint);
}

export function parseMix(buf: MixBuffer, productHint?: string): MixIR | null {
  const format = detectFormat(buf);
  if (!format) return null;

  try {
    switch (format) {
      case "A": return parseFormatA(buf, productHint);
      case "B": return parseFormatB(buf, productHint);
      case "C": return parseFormatC(buf, productHint);
      case "D": return parseFormatD(buf, productHint);
    }
  } catch (error) {
    if (error instanceof RangeError) return null;
    if (error instanceof Error && error.message.startsWith("Invalid Gen 2/3 MIX:")) {
      return null;
    }
    throw error;
  }
}

// ── Format A parser ──────────────────────────────────────────

export function parseFormatA(buf: MixBuffer, productHint?: string): MixIR {
  const appSig = buf.readUInt16LE(0);

  const product = productHint ?? FORMAT_A_PRODUCTS[appSig] ?? "Unknown_Gen1";
  const bpm = IMPLICIT_BPM[appSig] ?? 140;

  // Real Gen 1 files carry two sequential 8×351 uint16 grids:
  //   [ uint16 appSig | Grid 1 (5616 B) | Grid 2 (5616 B) | optional trailer ]
  // The trailer (when present) is marked by `uint16 0x0A08` at offset 11234.
  // Synthetic / short buffers used by tests fall back to the legacy zero-gap
  // heuristic so we keep parsing them without inflating their size.
  const hasFullLayout = buf.length >= FA_TRAILER_OFFSET;

  let gridEnd: number;
  let grid2: number[] | undefined;

  if (hasFullLayout) {
    gridEnd = FA_GRID2_START - 1;
    const cells = new Array<number>(FA_NUM_ROWS * FA_COLS);
    for (let i = 0; i < cells.length; i++) {
      cells[i] = buf.readUInt16LE(FA_GRID2_START + i * FA_CELL_BYTES);
    }
    grid2 = cells;
  } else {
    ({ gridEnd } = locateGridTrailer(buf, FA_HEADER_BYTES, FA_ZERO_GAP));
  }

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

  return {
    format: "A",
    product,
    appId: appSig,
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
    formatAGrid2: grid2,
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
  titleSectionOffset: number;
}

function parseGen23Header(buf: MixBuffer): Gen23Header {
  if (buf.length < 0x10) {
    throw new Error("Invalid Gen 2/3 MIX: truncated header");
  }

  const appId = buf.readUInt32LE(0);
  const entryCount = buf.readUInt32LE(4);
  const rawBpm = buf.readUInt16LE(8);
  const rawBpm2 = buf.readUInt16LE(0x0a);
  const bpm = isValidMixBpm(rawBpm)
    ? rawBpm
    : isValidMixBpm(rawBpm2)
      ? rawBpm2
      : DEFAULT_GEN23_BPM;
  const bpm2 = isValidMixBpm(rawBpm2) ? rawBpm2 : bpm;
  const unknown0C = buf.readUInt16LE(0x0c);
  const metadataLen = buf.readUInt16LE(0x0e);

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

  return {
    appId,
    entryCount,
    bpm,
    bpm2,
    unknown0C,
    metadataLen,
    author,
    registration,
    titleSectionOffset: metaEnd,
  };
}

function readTitleSection(buf: MixBuffer, offset: number): {
  title: string | null;
  afterTitle: number;
  sectionEnd: number;
} {
  if (offset + 2 > buf.length) {
    return { title: null, afterTitle: offset, sectionEnd: offset };
  }

  const sectionLen = buf.readUInt16LE(offset);
  const sectionEnd = offset + 2 + sectionLen;
  const titleStart = offset + 2;

  let titleEnd = titleStart;
  while (titleEnd < buf.length && titleEnd < sectionEnd && buf.at(titleEnd) !== 0x00) {
    titleEnd++;
  }

  const title = titleEnd > titleStart ? buf.toString("latin1", titleStart, titleEnd) : null;
  const afterTitle = titleEnd < buf.length ? titleEnd + 1 : titleEnd;

  return { title, afterTitle, sectionEnd };
}

// ── Mixer state parser (Format C/D) ─────────────────────────

export function parseMixerKV(text: string): Record<string, string> {
  const kv: Record<string, string> = {};
  const regex = /([^#%]+)#\xB0_#([^%]*)%\xB0_%/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    kv[m[1]] = m[2];
  }
  return kv;
}

function stripVideoOnlyMixerData(kv: Record<string, string>): Record<string, string> {
  if (kv.VideoMix === undefined) return kv;
  const audioOnlyKV = { ...kv };
  delete audioOnlyKV.VideoMix;
  return audioOnlyKV;
}

function buildMixerState(kv: Record<string, string>, format: MixFormat): MixerState {
  const channels: ChannelState[] = [];
  const eq: number[] = [];
  const parseOptionalInt = (value: string | undefined): number | null => {
    if (value === undefined) return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const parseIntWithDefault = (value: string | undefined, fallback: number): number => {
    return parseOptionalInt(value) ?? fallback;
  };

  if (format === "D") {
    for (let i = 1; i <= 49; i++) {
      const vol = kv[`MixVolume${i}`];
      const pan = kv[`MixPan${i}`];
      const mute = kv[`MixMute${i}`];
      const solo = kv[`MixSolo${i}`];
      if (vol !== undefined || pan !== undefined) {
        channels.push({
          index: i - 1,
          volume1: parseOptionalInt(vol),
          volume2: null,
          pan: parseOptionalInt(pan),
          eq: null,
          muted: mute === "active" || mute === "1",
          solo: solo === "active" || solo === "1",
        });
      }
    }
    for (let i = 0; i < 10; i++) {
      const v = kv[`BO_Equalizer${i}`] ?? kv[`BOequ${i}`] ?? kv[`BoostEQ_${i}`];
      eq.push(parseIntWithDefault(v, 50));
    }
  } else {
    for (let i = 0; i < 13; i++) {
      const v1 = kv[`BOOU1_${i}`];
      const v2 = kv[`BOOU2_${i}`];
      const deq = kv[`DrumEQ${i}`];
      if (v1 !== undefined || v2 !== undefined || deq !== undefined) {
        channels.push({
          index: i,
          volume1: parseOptionalInt(v1),
          volume2: parseOptionalInt(v2),
          pan: null,
          eq: parseOptionalInt(deq),
          muted: false,
          solo: false,
        });
      }
    }
    for (let i = 0; i < 10; i++) {
      eq.push(parseIntWithDefault(kv[`BoostEQ_${i}`], 50));
    }
  }

  let compressor: CompressorState | null = null;
  const cDrive = kv["BoostCompressorDrive"] ?? kv["BO_COMP_DRIVE_SCROLL"] ?? kv["BOcomDri"];
  const cGain  = kv["BoostCompressorGain"]  ?? kv["BO_COMP_GAIN_SCROLL"]  ?? kv["BOcomGai"];
  const cSpeed = kv["BoostCompressorSpeed"] ?? kv["BO_COMP_SPEED_SCROLL"] ?? kv["BOcomSpe"];
  const cLed   = kv["BoostCompressorLED"]   ?? kv["BO_COMP_LED"]          ?? kv["BOcomLED"];
  if (cDrive !== undefined || cGain !== undefined || cSpeed !== undefined) {
    compressor = {
      drive: parseIntWithDefault(cDrive, 0),
      gain:  parseIntWithDefault(cGain, 0),
      speed: parseIntWithDefault(cSpeed, 0),
      enabled: cLed === "active" || cLed === "1",
    };
  }

  const sw = kv["BoostStereoWide"] ?? kv["BO_STEREOWIDE_SPREAD_SCROLL"] ?? kv["BOsteSpr"];

  return { channels, eq, compressor, stereoWide: parseOptionalInt(sw), raw: kv };
}

function buildDrumMachine(kv: Record<string, string>): DrumMachineState | null {
  const pads: DrumPad[] = [];
  let maxPad = 0;

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
      volume: Number.parseInt(kv[`DrumVolume${i}`] ?? "500", 10) || 500,
      pan: Number.parseInt(kv[`DrumPan${i}`] ?? "50", 10) || 50,
      pitch: Number.parseInt(kv[`DrumPitch${i}`] ?? "0", 10) || 0,
      reversed: kv[`DrumReverse${i}`] === "active",
      fx: kv[`DrumFX${i}`] ?? "passive",
    });
  }

  const effects = buildDrumEffects(kv);
  const masterVol = Number.parseInt(kv["DRUMvolume"] ?? "500", 10) || 500;

  return { pads, effects, masterVolume: masterVol };
}

function buildDrumEffects(kv: Record<string, string>): DrumEffectsChain {
  return {
    chorus: {
      drive: Number.parseInt(kv["DRUMchoDri"] ?? "0", 10) || 0,
      speed: Number.parseInt(kv["DRUMchoSpe"] ?? "0", 10) || 0,
      enabled: kv["DRUMchoLED"] === "active",
    },
    echo: {
      time: Number.parseInt(kv["DRUMechTim"] ?? "0", 10) || 0,
      feedback: Number.parseInt(kv["DRUMechFee"] ?? "0", 10) || 0,
      volume: Number.parseInt(kv["DRUMechVol"] ?? "0", 10) || 0,
      enabled: kv["DRUMechLED"] === "active",
    },
    eq: {
      low: Number.parseInt(kv["DRUMequ1"] ?? "50", 10) || 50,
      mid: Number.parseInt(kv["DRUMequ2"] ?? "50", 10) || 50,
      high: Number.parseInt(kv["DRUMequ3"] ?? "50", 10) || 50,
      enabled: kv["DRUMequLED"] === "active",
    },
    overdrive: {
      drive: Number.parseInt(kv["DRUMoveDri"] ?? "0", 10) || 0,
      filter: Number.parseInt(kv["DRUMoveFil"] ?? "0", 10) || 0,
      enabled: kv["DRUMoveLED"] === "active",
    },
    reverb: {
      preDelay: Number.parseInt(kv["DRUMrevPre"] ?? "0", 10) || 0,
      time: Number.parseInt(kv["DRUMrevtim"] ?? "0", 10) || 0,
      volume: Number.parseInt(kv["DRUMrevVol"] ?? "0", 10) || 0,
      enabled: kv["DRUMrevLED"] === "active",
    },
  };
}

// ── Catalog parser (Format B/C/D) ────────────────────────────

export function parseCatalogs(buf: MixBuffer, startOffset: number): {
  catalogs: CatalogEntry[];
  endOffset: number;
} {
  const catalogs: CatalogEntry[] = [];
  let offset = startOffset;

  while (offset < buf.length && buf.at(offset) === 0x00) offset++;

  while (offset + 12 <= buf.length) {
    if (buf.at(offset) === 0x02 && buf.at(offset + 1) === 0x00 &&
        buf.at(offset + 2) === 0x00 && buf.at(offset + 3) === 0x01) break;

    const nameLen = buf.readUInt16LE(offset);
    if (nameLen < 2 || nameLen > 200) break;
    if (offset + 2 + nameLen + 8 > buf.length) break;

    const nameBlockEnd = offset + 2 + nameLen;
    if (buf.at(nameBlockEnd - 1) !== 0x01) break;
    if (buf.at(nameBlockEnd - 2) !== 0x00) break;

    const name = buf.toString("latin1", offset + 2, nameBlockEnd - 2);

    let printable = true;
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) { printable = false; break; }
    }
    if (!printable) break;

    offset = nameBlockEnd;

    if (offset + 10 <= buf.length) {
      const peekU32 = buf.readUInt32LE(offset);
      if (peekU32 > 100_000) offset += 2;
    }

    if (offset + 8 > buf.length) break;
    const idStart = buf.readUInt32LE(offset); offset += 4;
    const idEnd = buf.readUInt32LE(offset);   offset += 4;

    catalogs.push({ name, idRangeStart: idStart, idRangeEnd: idEnd });
  }

  return { catalogs, endOffset: offset };
}

// ── Format B parser ──────────────────────────────────────────

export function parseFormatB(buf: MixBuffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  const catalogStart = findCatalogStart(buf, sectionEnd);
  const { catalogs, endOffset: afterCatalogs } = parseCatalogs(buf, catalogStart);
  const legacyTracks = parseFormatBTracks(buf, afterCatalogs);
  const timeline = parseFormatBTimeline(buf, afterCatalogs);
  const useTimeline = timeline !== null && timeline.tracks.length > legacyTracks.length;
  const tracks = useTimeline ? timeline.tracks : legacyTracks;
  const loopBeats = useTimeline && timeline !== null
    ? formatBLoopBeatsFromMaxBeat(timeline.maxBeat)
    : null;
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
    ...(loopBeats !== null ? { loopBeats } : {}),
    tracks,
    mixer: emptyMixer(),
    drumMachine: null,
    tickerText,
    catalogs,
  };
}

function findCatalogStart(buf: MixBuffer, searchFrom: number): number {
  for (let i = Math.max(0, searchFrom); i + 20 < buf.length; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 4 || len > 200) continue;
    const nameBlockEnd = i + 2 + len;
    if (nameBlockEnd + 8 > buf.length) continue;
    if (buf.at(nameBlockEnd - 1) !== 0x01) continue;
    if (buf.at(nameBlockEnd - 2) !== 0x00) continue;

    let printable = true;
    for (let j = 0; j < len - 2; j++) {
      const b = buf.at(i + 2 + j);
      if (b < 0x20 || b > 0x7e) { printable = false; break; }
    }
    if (!printable) continue;

    return i;
  }
  return buf.length;
}

interface FormatBTimelineParse {
  tracks: TrackPlacement[];
  maxBeat: number | null;
}

function parseFormatBTimeline(buf: MixBuffer, startOffset: number): FormatBTimelineParse | null {
  const markerOffset = findFormatBTimelineMarkerOffset(buf, startOffset);
  if (markerOffset === null) return null;

  const chunkStart = findFormatBTimelineChunkStart(buf, startOffset, markerOffset);
  if (chunkStart === null) return null;

  const chunkLength = buf.readUInt32LE(chunkStart);
  const payloadEnd = chunkStart + chunkLength;
  if (payloadEnd !== markerOffset) return null;

  const tracks: TrackPlacement[] = [];
  let maxBeat: number | null = null;
  let offset = chunkStart + 4;

  for (let expectedChannel = 1; expectedChannel <= FORMAT_B_TIMELINE_CHANNEL_COUNT; expectedChannel++) {
    if (offset + 5 > payloadEnd) return null;

    const channelId = buf.at(offset); offset += 1;
    if (channelId !== expectedChannel) return null;

    const eventCount = buf.readUInt32LE(offset); offset += 4;
    if (eventCount > 100_000) return null;

    const laneIndex = channelId - 1;

    for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
      if (offset + 7 > payloadEnd) return null;

      const laneClass = buf.at(offset); offset += 1;
      const posRaw = buf.readInt32LE(offset); offset += 4;
      const sampleKey = buf.readUInt16LE(offset); offset += 2;

      let trailingBytes = 0;

      if (laneIndex <= 15) {
        if (laneClass !== 0 && laneClass !== 3) return null;
        if (posRaw >= 0) {
          trailingBytes = FORMAT_B_CORE_EVENT_TAIL_BYTES;
        }
      } else if (laneClass === FORMAT_B_USER_PERC_LANE_CLASS) {
        // HipHop eJay 2 channel 17 records embed a fixed extension payload
        // (sample label/variant metadata) after the core tuple.
        trailingBytes = FORMAT_B_USER_PERC_EXTENSION_BYTES;
      } else if (laneClass !== 0) {
        return { tracks, maxBeat };
      } else if (posRaw >= 0) {
        trailingBytes = FORMAT_B_CORE_EVENT_TAIL_BYTES;
      }

      const decodedPos = posRaw < 0 ? (-posRaw - 1) : posRaw;
      const beat = decodedPos / FORMAT_B_TIMELINE_POS_DIVISOR;
      if (Number.isFinite(beat) && beat >= 0) {
        maxBeat = maxBeat === null ? beat : Math.max(maxBeat, beat);
      }

      tracks.push({
        beat,
        channel: laneIndex,
        sampleRef: {
          rawId: sampleKey,
          internalName: null,
          displayName: null,
          resolvedPath: null,
          dataLength: null,
        },
      });

      if (trailingBytes > 0) {
        if (offset + trailingBytes > payloadEnd) return null;
        offset += trailingBytes;
      }
    }
  }

  if (offset !== payloadEnd) return null;
  return { tracks, maxBeat };
}

function findFormatBTimelineMarkerOffset(buf: MixBuffer, startOffset: number): number | null {
  for (let offset = buf.length - 4; offset >= Math.max(0, startOffset); offset--) {
    if (buf.readUInt32LE(offset) === FORMAT_B_TIMELINE_SENTINEL) {
      return offset;
    }
  }
  return null;
}

function findFormatBTimelineChunkStart(buf: MixBuffer, startOffset: number, markerOffset: number): number | null {
  for (let offset = markerOffset - 4; offset >= Math.max(0, startOffset); offset--) {
    const chunkLength = buf.readUInt32LE(offset);
    if (chunkLength < FORMAT_B_TIMELINE_MIN_CHUNK_LEN) continue;
    if (offset + chunkLength === markerOffset) {
      return offset;
    }
  }
  return null;
}

function formatBLoopBeatsFromMaxBeat(maxBeat: number | null): number | null {
  if (maxBeat === null || !Number.isFinite(maxBeat) || maxBeat < 0) {
    return null;
  }
  const hasFractionalTail = Math.abs(maxBeat - Math.round(maxBeat)) > 1e-6;
  if (!hasFractionalTail) {
    return null;
  }
  return Math.max(1, Math.ceil(maxBeat + 1));
}

function parseFormatBTracks(buf: MixBuffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  let offset = startOffset;

  while (offset + 4 < buf.length) {
    if (buf.at(offset) !== 0x02) { offset++; continue; }
    if (offset + 3 >= buf.length) break;
    if (buf.at(offset + 1) !== 0x00 || buf.at(offset + 2) !== 0x00 || buf.at(offset + 3) !== 0x01) {
      offset++; continue;
    }

    const recordStart = offset;
    offset += 4;
    if (offset + 4 > buf.length) break;

    const sampleId = buf.readUInt16LE(offset); offset += 2;
    const channelByte = buf.at(offset); offset += 2;

    const nameStart = offset;
    while (offset < buf.length && buf.at(offset) !== 0x00) offset++;
    if (offset >= buf.length) break;

    const name = buf.toString("latin1", nameStart, offset);
    offset++;

    if (name.length === 0 || name.length > 64 || !/^[A-Za-z0-9_. -]+$/.test(name)) {
      offset = recordStart + 1; continue;
    }

    if (offset >= buf.length || buf.at(offset) !== 0x01) {
      offset = recordStart + 1; continue;
    }
    offset++;

    if (offset + 8 > buf.length) break;

    const beat = buf.readInt16LE(offset); offset += 2;
    if (beat < -8) { offset = recordStart + 1; continue; }

    offset += 2; // flags
    const dataLen = buf.readUInt32LE(offset); offset += 4;

    if (dataLen === 0 || dataLen > 50_000_000) {
      offset = recordStart + 1; continue;
    }

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

function extractTickerText(buf: MixBuffer, searchFrom: number): string[] {
  const text: string[] = [];
  const searchEnd = Math.min(buf.length, searchFrom + 4096);

  for (let offset = searchFrom; offset + 5 < searchEnd; offset++) {
    const len = buf.readUInt16LE(offset);
    if (len < 3 || len > 30) continue;

    const textStart = offset + 2;
    const textEnd = textStart + len - 2;
    if (textEnd + 1 > searchEnd) continue;
    if (buf.at(textEnd) !== 0x00 || buf.at(textEnd + 1) !== 0x01) continue;

    const candidate = buf.toString("latin1", textStart, textEnd);
    if (!/^[\x20-\x7e]+$/.test(candidate)) continue;
    text.push(candidate);
    offset = textEnd + 1;
  }

  return text;
}

// ── Format C parser ──────────────────────────────────────────

interface FormatCTrackRecord {
  displayName: string | null;
  beat: number | null;
  channel: number | null;
  dataLength: number | null;
}

export function parseFormatC(buf: MixBuffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, afterTitle, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  let mixerKV: Record<string, string> = {};
  if (afterTitle < sectionEnd) {
    const mixerText = buf.toString("latin1", afterTitle, sectionEnd);
    mixerKV = stripVideoOnlyMixerData(parseMixerKV(mixerText));
  }

  const mixer = buildMixerState(mixerKV, "C");
  const catalogStart = findCatalogStart(buf, sectionEnd);
  const { catalogs, endOffset: afterCatalogs } = parseCatalogs(buf, catalogStart);
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

function parseFormatCTracks(buf: MixBuffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  const text = bufLatin1(buf);

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
      if (gap >= 0 && gap <= 4) i++;
    }

    const record = parseFormatCTrackRecord(buf, startOffset, first.index, first.path);
    if (!record) continue;

    tracks.push({
      beat: record.beat,
      channel: record.channel,
      sampleRef: {
        // C/D lane indexes are timeline coordinates, not sample ids.
        rawId: 0,
        internalName: null,
        displayName: record.displayName,
        resolvedPath: null,
        dataLength: record.dataLength,
      },
    });
  }

  return tracks;
}

function parseFormatCTrackRecord(
  buf: MixBuffer,
  lowerBound: number,
  pathStart: number,
  path: string,
): FormatCTrackRecord | null {
  if (pathStart > buf.length) return null;

  const nameField = findFormatCDNameField(buf, lowerBound, pathStart);
  if (!nameField) return null;

  // The big format (gap===40) has beat/channel/dataLength at fixed offsets relative to pathStart.
  // Layout: [...18-byte state][dataLen:4][zeitpos:4][pad:1][channel:1][8-byte state][mystery:2][pathLen:2][path]
  // The compact format (gap 8-12) has no such fields.
  let beat: number | null = null;
  let channel: number | null = null;
  let dataLength: number | null = null;
  if (nameField.gap === 40 && pathStart >= 22) {
    const recoveredBeat = buf.readUInt32LE(pathStart - 18);   // zeitpos
    beat = recoveredBeat <= MAX_RECOVERED_FORMAT_CD_BEAT ? recoveredBeat : null;
    channel = buf.readUInt8(pathStart - 13);   // Spur
    dataLength = buf.readUInt32LE(pathStart - 22);
  } else {
    // Compact C records (observed gap=10 in shipped mixes) expose a small
    // signed timeline offset at pathStart-10. Lane identity is encoded in
    // the temp filename suffix (pxd32p[d..s].tmp -> lane 0..15).
    const recoveredBeat = recoverCompactFormatCDBeat(buf, pathStart, nameField.gap);
    const recoveredLane = laneIndexFromTempPath(path);
    if (recoveredBeat !== null && recoveredLane !== null) {
      beat = recoveredBeat;
      channel = recoveredLane;
    }
  }

  return { displayName: nameField.name, beat, channel, dataLength };
}

function laneIndexFromTempPath(path: string): number | null {
  const match = /pxd32p([a-z])\.tmp[.,]?$/i.exec(path);
  if (!match) return null;
  const lane = match[1]!.toLowerCase().charCodeAt(0) - 100; // 'd' -> 0
  return lane >= 0 && lane < 32 ? lane : null;
}

function recoverCompactFormatCDBeat(
  buf: MixBuffer,
  pathStart: number,
  gap: number,
): number | null {
  if (gap !== 10 || pathStart < 10) return null;
  const beat = buf.readInt16LE(pathStart - 10);
  return beat >= -64 && beat <= 4096 ? beat : null;
}

function findFormatCDNameField(
  buf: MixBuffer,
  lowerBound: number,
  pathStart: number,
): { offset: number; name: string; gap: number } | null {
  // ── Big format (gap === 40) ───────────────────────────────────────────────
  // nameLen includes a trailing \0\x01 marker (2 bytes), so effective name =
  // nameLen − 2 printable chars.  Confirmed for Dance eJay 3 format-C files
  // where the 40-byte block contains: 18-byte state, dataLen, zeitpos, pad,
  // channel, 8-byte state, mystery word, pathLen.
  const nameEnd40 = pathStart - 40;
  if (nameEnd40 >= lowerBound) {
    for (let nameLen = 2; nameLen <= 54; nameLen++) {
      const offset = nameEnd40 - nameLen - 2;
      if (offset < lowerBound) break;
      if (offset + 2 > buf.length) continue;
      if (buf.readUInt16LE(offset) !== nameLen) continue;
      // Strip \0\x01 trailer before validation
      const name = buf.toString("latin1", offset + 2, nameEnd40 - 2);
      if (!/^[A-Za-z0-9_ .()-]*$/.test(name)) continue;
      return { offset, name, gap: 40 };
    }
  }

  // ── Compact format (gap 8–12) ─────────────────────────────────────────────
  // nameLen is the exact printable-char count (no \0\x01 trailer).
  const minOffset = Math.max(lowerBound, pathStart - 64);
  for (let offset = pathStart - 2; offset >= minOffset; offset--) {
    if (offset + 2 > buf.length) continue;
    const nameLen = buf.readUInt16LE(offset);
    if (nameLen < 2 || nameLen > 32) continue;

    const nameStart = offset + 2;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > pathStart) continue;

    const gap = pathStart - nameEnd;
    if (gap < 8 || gap > 12) continue;

    const name = buf.toString("latin1", nameStart, nameEnd);
    if (!/^[A-Za-z0-9_ .()-]*$/.test(name)) continue;

    return { offset, name, gap };
  }

  return null;
}

// ── Format D parser ──────────────────────────────────────────

export function parseFormatD(buf: MixBuffer, productHint?: string): MixIR {
  const header = parseGen23Header(buf);
  const { title, afterTitle, sectionEnd } = readTitleSection(buf, header.titleSectionOffset);

  let mixerKV: Record<string, string> = {};
  if (afterTitle < sectionEnd) {
    const mixerText = buf.toString("latin1", afterTitle, sectionEnd);
    mixerKV = parseMixerKV(mixerText);
  }

  const mixer = buildMixerState(mixerKV, "D");
  const drumMachine = buildDrumMachine(mixerKV);

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

function parseFormatDTracks(buf: MixBuffer, startOffset: number): TrackPlacement[] {
  const tracks: TrackPlacement[] = [];
  let offset = startOffset;

  while (offset + 6 < buf.length) {
    const left = readLengthPrefixedTempPath(buf, offset);
    if (!left) { offset++; continue; }

    const right = readLengthPrefixedTempPath(buf, left.nextOffset);
    if (!right) { offset++; continue; }

    const nameField = findFormatCDNameField(buf, Math.max(startOffset, offset - 96), left.pathStart);
    if (!nameField) {
      offset = right.nextOffset;
      continue;
    }

    // Strict compact-D recovery: only populate beat/lane when every guard
    // passes; otherwise keep explicit null fallbacks.
    let beat: number | null = null;
    let channel: number | null = null;
    if (nameField.gap === 10) {
      const recoveredBeat = recoverCompactFormatCDBeat(buf, left.pathStart, nameField.gap);
      const recoveredLane = laneIndexFromTempPath(left.path);
      if (recoveredBeat !== null && recoveredLane !== null) {
        beat = recoveredBeat;
        channel = recoveredLane;
      }
    }

    tracks.push({
      beat,
      channel,
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
  buf: MixBuffer,
  lengthOffset: number,
): { pathStart: number; nextOffset: number; path: string } | null {
  if (lengthOffset + 4 > buf.length) return null;

  const pathLength = buf.readUInt16LE(lengthOffset);
  if (pathLength < 12 || pathLength > 128) return null;

  const pathStart = lengthOffset + 2;
  const pathEnd = pathStart + pathLength;
  if (pathEnd > buf.length) return null;

  const path = buf.toString("latin1", pathStart, pathEnd);
  if (!/^[A-Z]:\\.*pxd32p[a-z]\.tmp[.,]?$/i.test(path)) return null;

  return { pathStart, nextOffset: pathEnd, path };
}

// ── Helpers ──────────────────────────────────────────────────

export function locateGridTrailer(
  buf: MixBuffer,
  headerBytes: number,
  threshold: number,
): { gridEnd: number; trailerStart: number } {
  let lastNonZero = -1;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf.at(i) !== 0) { lastNonZero = i; break; }
  }
  if (lastNonZero < headerBytes) {
    return { gridEnd: lastNonZero, trailerStart: lastNonZero + 1 };
  }

  let zeroRun = 0;
  let runStart = -1;
  for (let i = headerBytes; i <= lastNonZero; i++) {
    if (buf.at(i) === 0) {
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

export function extractAsciiStrings(buf: MixBuffer, minLength: number = 4): string[] {
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

function inferProduct(catalogs: CatalogEntry[], appId: number): string | null {
  if (catalogs.length > 0) {
    const name = catalogs[0].name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
    return name || null;
  }
  return APP_ID_PRODUCTS[appId] ?? null;
}

function emptyMixer(): MixerState {
  return { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} };
}
