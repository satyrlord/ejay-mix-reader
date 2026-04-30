import type { MixPlaybackPlan } from "../mix-player.js";

export function timelineWidthPx(beatCount: number, labelPx: number = 160, beatPx: number = 48): number {
  return labelPx + (beatCount * beatPx);
}

export function timelineBpm(plan: MixPlaybackPlan): number {
  const unitBeats = Number.isFinite(plan.timelineUnitBeats) && plan.timelineUnitBeats > 0
    ? plan.timelineUnitBeats
    : 1;
  return plan.bpm / unitBeats;
}

export function clampMixBeat(beat: number, loopBeats: number | null): number {
  if (loopBeats === null) return 0;
  const maxStartBeat = Math.max(0, loopBeats - 1);
  if (!Number.isFinite(beat)) return 0;
  return Math.max(0, Math.min(maxStartBeat, Math.floor(beat)));
}
