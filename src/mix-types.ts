/**
 * mix-types.ts — Browser-side re-export of the shared MixIR schema.
 *
 * The canonical definitions live in [`scripts/mix-types.ts`](../scripts/mix-types.ts).
 * This file re-exports them so browser code under `src/` can `import from
 * "./mix-types.js"` without reaching into the tooling tree.
 *
 * Keep this file type-only (`export type`) so it compiles away to nothing
 * at runtime and never widens the browser bundle.
 */

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
} from "../scripts/mix-types.js";
