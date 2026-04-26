/**
 * mix-types.ts — Shared TypeScript interfaces for the MIX file parser,
 * sample resolver, and browser playback engine.
 *
 * One unified IR ("MixIR") that all four format parsers (A/B/C/D) emit
 * and all downstream consumers (resolver, player, UI) read.
 */

// ── Format detection ─────────────────────────────────────────

export type MixFormat = "A" | "B" | "C" | "D";

// ── Top-level IR ─────────────────────────────────────────────

export interface MixIR {
  format: MixFormat;
  product: string;                    // e.g. "Dance_eJay2"
  appId: number;                      // uint32 from offset 0x00
  bpm: number;                        // beats per minute
  bpmAdjusted: number | null;         // BPM2 if different from BPM1
  author: string | null;              // null for Format A
  title: string | null;               // null for Format A
  registration: string | null;        // SKKENNUNG key (null for Format A)

  tracks: TrackPlacement[];           // all sample placements on the timeline
  mixer: MixerState;                  // normalised mixer settings
  drumMachine: DrumMachineState | null; // only Format D
  tickerText: string[];               // scrolling text messages (Format B only)
  catalogs: CatalogEntry[];           // referenced sample packs

  /**
   * Format A only: row-major copy of the second 8×N uint16 grid that follows
   * Grid 1 in Gen 1 `.mix` files (decompiled VB6 writes it from `Me+0x60C`).
   * Length is `FA_NUM_ROWS * FA_COLS` (= 2808) for full-size files, `undefined`
   * for short/synthetic buffers that do not contain the dual-grid layout.
   * Semantics are still under investigation — likely a per-cell duration or
   * variant override — so consumers should treat it as opaque metadata.
   */
  formatAGrid2?: number[];
}

// ── Catalog ──────────────────────────────────────────────────

export interface CatalogEntry {
  name: string;                       // e.g. "Dance eJay 2.0"
  idRangeStart: number;               // first sample ID in this pack
  idRangeEnd: number;                 // last sample ID in this pack
}

// ── Track placements ─────────────────────────────────────────

export interface TrackPlacement {
  beat: number | null;                // timeline position (0-indexed beat) when recoverable
  channel: number | null;             // track/row index (0-indexed) when recoverable
  sampleRef: SampleRef;              // resolved sample reference
}

export interface SampleRef {
  rawId: number;                      // original uint16 from the grid (Format A)
  internalName: string | null;        // PXD filename (e.g. "humn.9") — Format B
  displayName: string | null;         // human name (e.g. "kick28") — Format C/D
  resolvedPath: string | null;        // output WAV path (filled by resolver)
  dataLength: number | null;          // sample data length in bytes (from file)
}

// ── Mixer state ──────────────────────────────────────────────

export interface MixerState {
  channels: ChannelState[];           // per-track mixer state
  eq: number[];                       // 10-band master EQ (raw values)
  compressor: CompressorState | null;
  stereoWide: number | null;          // stereo spread (raw value)
  raw: Record<string, string>;        // all key-value pairs from the file
}

export interface ChannelState {
  index: number;
  volume1: number | null;             // BOOU1 / MixVolume (raw value)
  volume2: number | null;             // BOOU2 (raw value, Format C only)
  pan: number | null;                 // MixPan (raw value, Format D only)
  eq: number | null;                  // DrumEQ per-channel level
  muted: boolean;
  solo: boolean;
}

export interface CompressorState {
  drive: number;
  gain: number;
  speed: number;
  enabled: boolean;
}

// ── Drum machine (Format D only) ─────────────────────────────

export interface DrumMachineState {
  pads: DrumPad[];
  effects: DrumEffectsChain;
  masterVolume: number;
}

export interface DrumPad {
  index: number;                      // 1-based pad number
  name: string;                       // display name
  volume: number;                     // raw value (0–500+)
  pan: number;                        // raw value (0–100)
  pitch: number;                      // semitone offset
  reversed: boolean;
  fx: string;                         // "passive" or FX routing name
}

export interface DrumEffectsChain {
  chorus: { drive: number; speed: number; enabled: boolean };
  echo: {
    time: number; feedback: number; volume: number;
    enabled: boolean;
  };
  eq: { low: number; mid: number; high: number; enabled: boolean };
  overdrive: { drive: number; filter: number; enabled: boolean };
  reverb: {
    preDelay: number; time: number; volume: number;
    enabled: boolean;
  };
}
