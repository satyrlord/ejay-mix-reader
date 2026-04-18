// Browser-side MIX player runtime. Covers prerequisites 8-11 of the
// mix-player roadmap: Web Audio scheduling prototype (8), per-channel
// mixer routing with mute/solo (9), Format-D drum machine pad playback
// (10), and a P4 effects chain factory (11).
//
// Pure helpers live at the top so they can be unit-tested without a real
// `AudioContext`. The graph-wiring classes take any object that satisfies
// the small `AudioContextLike` interface so they can be exercised with
// either a real `AudioContext` or a lightweight stub.

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Convert a beat offset to seconds at the given tempo. Throws on non-positive BPM. */
export function beatsToSeconds(beats: number, bpm: number): number {
  if (bpm <= 0 || !Number.isFinite(bpm)) {
    throw new Error(`Invalid BPM: ${bpm}`);
  }
  if (!Number.isFinite(beats)) {
    throw new Error(`Invalid beats: ${beats}`);
  }
  return (beats * 60) / bpm;
}

/** Map a BOOU or MixVolume integer (0..100) to a linear gain in [0, 1]. */
export function volumeToGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value)) / 100;
}

/** Map a pan integer (0..100, 50 = centre) to the `StereoPannerNode` range [-1, 1]. */
export function panToStereo(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(100, value));
  return (clamped - 50) / 50;
}

/** Convert a semitone offset to the matching `AudioBufferSourceNode.playbackRate`. */
export function semitonesToRate(semitones: number): number {
  if (!Number.isFinite(semitones)) return 1;
  return Math.pow(2, semitones / 12);
}

/**
 * Compute the effective gain for a channel given the per-channel state and
 * the solo state of the mixer. Solo wins over mute: when any channel is
 * soloed, non-soloed channels are silent even if they are not muted.
 */
export function effectiveGain(params: {
  volume: number;
  muted: boolean;
  soloed: boolean;
  anySoloed: boolean;
}): number {
  if (params.muted) return 0;
  if (params.anySoloed && !params.soloed) return 0;
  return volumeToGain(params.volume);
}

/**
 * Effect kinds understood by `createEffect`. P4 (compressor, delay, reverb)
 * and P5 (overdrive, 10-band EQ, chorus, mid-sweep) are implemented with
 * native Web Audio nodes. P6 (harmonizer, vocoder) are approximated with
 * analyser + filter-bank / parallel-source wiring that mirrors the original
 * eJay effect topology — acceptable-quality placeholders that keep the
 * graph complete.
 */
export type EffectKind =
  | "compressor"
  | "delay"
  | "reverb"
  | "overdrive"
  | "eq10"
  | "chorus"
  | "midsweep"
  | "harmonizer"
  | "vocoder";

/** Centre frequencies (Hz) for the 10-band EQ — standard ISO octave layout. */
export const EQ10_FREQUENCIES: readonly number[] = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/**
 * Build a symmetric soft-clipping `WaveShaper` curve for overdrive. The
 * `amount` parameter controls drive intensity (0 = linear, higher = more
 * distortion). Exposed for unit testing.
 */
export function buildOverdriveCurve(samples: number, amount: number): Float32Array {
  if (samples <= 0) return new Float32Array(0);
  const curve = new Float32Array(samples);
  const k = Math.max(0, amount);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Generate a synthetic exponential-decay impulse response used by the reverb
 * `ConvolverNode`. Exported so unit tests can verify the envelope math
 * without instantiating a real audio graph.
 */
export function buildImpulseResponse(
  sampleRate: number,
  durationSec: number,
  decay: number,
): Float32Array {
  if (sampleRate <= 0 || durationSec <= 0) {
    return new Float32Array(0);
  }
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const ir = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    ir[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
  }
  return ir;
}

/* -------------------------------------------------------------------------- */
/* Audio graph types                                                           */
/* -------------------------------------------------------------------------- */

/** Minimal shape of the Web Audio nodes we touch. Kept narrow for testability. */
export interface AudioNodeLike {
  /** Returns the downstream node for node-to-node connections; AudioParam targets typically yield `void`. */
  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike | void;
  disconnect?(): void;
}

export interface AudioParamLike {
  value: number;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike;
}

export interface DelayNodeLike extends AudioNodeLike {
  delayTime: AudioParamLike;
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: unknown;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike;
  ratio: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: unknown;
  playbackRate: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
  gain: AudioParamLike;
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: "none" | "2x" | "4x";
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number;
  readonly frequencyBinCount: number;
}

/**
 * Just enough of `AudioContext` for the classes below. Real browser code
 * passes a `window.AudioContext`; tests can hand in a tiny stub.
 */
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createDelay(maxDelay?: number): DelayNodeLike;
  createConvolver(): ConvolverNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): {
    getChannelData(channel: number): Float32Array;
  };
  createBufferSource(): AudioBufferSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createWaveShaper(): WaveShaperNodeLike;
  createOscillator(): OscillatorNodeLike;
  createAnalyser(): AnalyserNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
}

/* -------------------------------------------------------------------------- */
/* Mixer channel (Prereq 9)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Single mixer channel: gain → panner → output. `setVolume`, `setPan`, and
 * `setMuted` all feed the same gain/pan nodes; external solo state is applied
 * through `setSoloState` so callers do not need to recompute the effective
 * gain themselves.
 */
export class MixChannel {
  readonly gain: GainNodeLike;
  readonly panner: StereoPannerNodeLike;
  private volume = 100;
  private muted = false;
  private soloed = false;
  private anySoloed = false;

  constructor(ctx: AudioContextLike, destination: AudioNodeLike = ctx.destination) {
    this.gain = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.gain.connect(this.panner);
    this.panner.connect(destination);
    this.apply();
  }

  /** Node that incoming sample sources should connect to. */
  get input(): AudioNodeLike {
    return this.gain;
  }

  setVolume(value: number): void { this.volume = value; this.apply(); }
  setPan(value: number): void { this.panner.pan.value = panToStereo(value); }
  setMuted(muted: boolean): void { this.muted = muted; this.apply(); }
  setSoloState(soloed: boolean, anySoloed: boolean): void {
    this.soloed = soloed;
    this.anySoloed = anySoloed;
    this.apply();
  }

  private apply(): void {
    this.gain.gain.value = effectiveGain({
      volume: this.volume,
      muted: this.muted,
      soloed: this.soloed,
      anySoloed: this.anySoloed,
    });
  }
}

/**
 * Tracks which channels are soloed and pushes the aggregated state back into
 * every registered `MixChannel`. Channels register at construction via
 * `SoloGroup.attach` so the group always knows the full membership.
 */
export class SoloGroup {
  private readonly members = new Map<string, { channel: MixChannel; soloed: boolean }>();

  attach(id: string, channel: MixChannel): void {
    this.members.set(id, { channel, soloed: false });
    this.notify();
  }

  setSoloed(id: string, soloed: boolean): void {
    const entry = this.members.get(id);
    if (!entry) return;
    entry.soloed = soloed;
    this.notify();
  }

  get anySoloed(): boolean {
    for (const entry of this.members.values()) if (entry.soloed) return true;
    return false;
  }

  private notify(): void {
    const any = this.anySoloed;
    for (const entry of this.members.values()) {
      entry.channel.setSoloState(entry.soloed, any);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Drum machine (Prereq 10)                                                   */
/* -------------------------------------------------------------------------- */

export interface DrumPadConfig {
  /** Decoded audio buffer for the pad sample. */
  buffer: unknown;
  /** Semitone offset applied via `playbackRate`. */
  semitones?: number;
  /** Reverse playback — the buffer must already be pre-reversed before being passed in. */
  reverse?: boolean;
  /** Linear gain multiplier applied on top of the channel gain. */
  gain?: number;
}

/**
 * Schedules Format-D drum machine pads onto a single output node. Pitch is
 * applied via `playbackRate` (semitones → rate), reverse playback expects a
 * pre-reversed buffer (the caller owns the reversal so we do not mutate
 * shared buffers here), and per-pad gain rides on top of the channel gain.
 */
export class DrumMachine {
  private readonly pads = new Map<string, DrumPadConfig>();

  constructor(private readonly ctx: AudioContextLike, private readonly output: AudioNodeLike) {}

  setPad(id: string, config: DrumPadConfig): void {
    this.pads.set(id, config);
  }

  trigger(id: string, when: number): AudioBufferSourceNodeLike | null {
    const pad = this.pads.get(id);
    if (!pad) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.playbackRate.value = semitonesToRate(pad.semitones ?? 0);
    if (pad.gain !== undefined && pad.gain !== 1) {
      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0, pad.gain);
      src.connect(gain);
      gain.connect(this.output);
    } else {
      src.connect(this.output);
    }
    src.start(when);
    return src;
  }

  get padCount(): number {
    return this.pads.size;
  }
}

/* -------------------------------------------------------------------------- */
/* Effects (Prereq 11, P4)                                                    */
/* -------------------------------------------------------------------------- */

export interface EffectHandle {
  readonly kind: EffectKind;
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
}

/**
 * Build one of the effect chains backed by native Web Audio nodes. The
 * returned handle exposes `input`/`output` so effects can be threaded in
 * series: `channel.connect(effect.input); effect.output.connect(dest);`.
 *
 * Implemented priorities:
 * - **P4**: `compressor`, `delay`, `reverb`.
 * - **P5**: `overdrive` (soft-clip `WaveShaper` + low-pass tame),
 *   `eq10` (ten peaking `BiquadFilter` stages in series),
 *   `chorus` (LFO-modulated `DelayNode` wet-mix),
 *   `midsweep` (bandpass swept by an LFO).
 * - **P6**: `harmonizer` (two parallel detuned sources through a shared
 *   gain bus — callers push sources into `input` and receive the mixed
 *   output), `vocoder` (16-band filter bank fed by `AnalyserNode` for
 *   envelope extraction, acceptable-quality placeholder).
 */
export function createEffect(ctx: AudioContextLike, kind: EffectKind): EffectHandle {
  switch (kind) {
    case "compressor": {
      const node = ctx.createDynamicsCompressor();
      return { kind, input: node, output: node };
    }
    case "delay": {
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.25;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.4;
      delay.connect(feedback);
      feedback.connect(delay);
      return { kind, input: delay, output: delay };
    }
    case "reverb": {
      const convolver = ctx.createConvolver();
      const buffer = ctx.createBuffer(2, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
      const ir = buildImpulseResponse(ctx.sampleRate, 2, 2);
      for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length && i < ir.length; i++) data[i] = ir[i];
      }
      convolver.buffer = buffer;
      return { kind, input: convolver, output: convolver };
    }
    case "overdrive": {
      const shaper = ctx.createWaveShaper();
      shaper.curve = buildOverdriveCurve(2048, 50);
      shaper.oversample = "4x";
      const tame = ctx.createBiquadFilter();
      tame.type = "lowpass";
      tame.frequency.value = 3500;
      shaper.connect(tame);
      return { kind, input: shaper, output: tame };
    }
    case "eq10": {
      const filters: BiquadFilterNodeLike[] = EQ10_FREQUENCIES.map((freq) => {
        const f = ctx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = freq;
        f.Q.value = 1.0;
        f.gain.value = 0;
        return f;
      });
      for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
      return { kind, input: filters[0], output: filters[filters.length - 1] };
    }
    case "chorus": {
      // LFO → depth gain → delay.delayTime. Input splits to a dry path
      // (bypass) and a wet path through the modulated delay; both merge
      // at an output gain bus.
      const input = ctx.createGain();
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.015;
      const depth = ctx.createGain();
      depth.gain.value = 0.005;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 1.5;
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      const out = ctx.createGain();
      input.connect(delay);
      input.connect(out);
      delay.connect(wet);
      wet.connect(out);
      /* istanbul ignore next -- oscillator start is a no-op on stubs but required on real contexts */
      try { lfo.start(0); } catch { /* already started */ }
      return { kind, input, output: out };
    }
    case "midsweep": {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1000;
      band.Q.value = 4;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.3;
      const depth = ctx.createGain();
      depth.gain.value = 800;
      lfo.connect(depth);
      depth.connect(band.frequency);
      /* istanbul ignore next -- see chorus note */
      try { lfo.start(0); } catch { /* already started */ }
      return { kind, input: band, output: band };
    }
    case "harmonizer": {
      // Parallel gain bus: caller routes multiple pitch-shifted sources
      // into `input`; both the dry and wet signals sum into `output`.
      const input = ctx.createGain();
      const up = ctx.createGain();
      const down = ctx.createGain();
      up.gain.value = 0.4;
      down.gain.value = 0.4;
      const out = ctx.createGain();
      input.connect(out);
      input.connect(up);
      input.connect(down);
      up.connect(out);
      down.connect(out);
      return { kind, input, output: out };
    }
    case "vocoder": {
      // 16 peaking filters driven by an `AnalyserNode` that exposes the
      // modulator envelope. The live envelope mapping happens outside of
      // the graph (consumers read `analyser.getByteFrequencyData`) — the
      // factory wires the static carrier path.
      const input = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const out = ctx.createGain();
      const bands = 16;
      for (let i = 0; i < bands; i++) {
        const band = ctx.createBiquadFilter();
        band.type = "peaking";
        band.frequency.value = 100 * Math.pow(2, i / 2);
        band.Q.value = 8;
        band.gain.value = 0;
        input.connect(band);
        band.connect(out);
      }
      input.connect(analyser);
      return { kind, input, output: out };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Mix player host (Prereq 8)                                                 */
/* -------------------------------------------------------------------------- */

export interface MixPlayerSampleSpec {
  /** Pre-decoded audio buffer to play. */
  buffer: unknown;
  /** Beat offset on the timeline (inclusive, 0-based). */
  beat: number;
  /** Target channel id (must have been registered via `registerChannel`). */
  channelId: string;
  /** Optional semitone transpose for the scheduled source. */
  semitones?: number;
}

/**
 * Beat-synced sample scheduler on top of a `MixChannel` graph. Consumers
 * register channels, then call `scheduleSample` for every timeline event;
 * `play(bpm)` kicks off `AudioBufferSourceNode.start(when)` for all pending
 * specs. `stop()` aborts pending sources and resets the schedule queue.
 */
export class MixPlayerHost {
  readonly channels = new Map<string, MixChannel>();
  readonly solo = new SoloGroup();
  private readonly scheduled: MixPlayerSampleSpec[] = [];
  private active: AudioBufferSourceNodeLike[] = [];
  private playing = false;

  constructor(public readonly ctx: AudioContextLike) {}

  registerChannel(id: string): MixChannel {
    const channel = new MixChannel(this.ctx);
    this.channels.set(id, channel);
    this.solo.attach(id, channel);
    return channel;
  }

  scheduleSample(spec: MixPlayerSampleSpec): void {
    this.scheduled.push(spec);
  }

  get scheduledCount(): number {
    return this.scheduled.length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(bpm: number, startAt: number = this.ctx.currentTime): number {
    const started: AudioBufferSourceNodeLike[] = [];
    for (const spec of this.scheduled) {
      const channel = this.channels.get(spec.channelId);
      if (!channel) {
        console.warn(`Skipping scheduled sample for unknown channel: ${spec.channelId}`);
        continue;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = spec.buffer;
      src.playbackRate.value = semitonesToRate(spec.semitones ?? 0);
      src.connect(channel.input);
      src.start(startAt + beatsToSeconds(spec.beat, bpm));
      started.push(src);
    }
    this.active = started;
    this.playing = true;
    return started.length;
  }

  stop(): void {
    for (const src of this.active) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.active = [];
    this.playing = false;
  }

  clear(): void {
    this.stop();
    this.scheduled.length = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Fetch a `.mix` file served by the Vite dev-server middleware (prereq 7). */
export async function fetchMixBinary(productId: string, filename: string): Promise<ArrayBuffer> {
  const url = `/mix/${encodeURIComponent(productId)}/${encodeURIComponent(filename)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  }
  return resp.arrayBuffer();
}
