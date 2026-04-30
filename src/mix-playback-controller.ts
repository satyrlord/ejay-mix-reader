import { clampMixBeat, timelineBpm, timelineWidthPx } from "./main-helpers/sequencer.js";
import type { MixPlaybackPlan } from "./mix-player.js";

export { clampMixBeat, timelineBpm, timelineWidthPx };

export function collectMixAudioUrls(plan: MixPlaybackPlan): string[] {
  return [...new Set(
    plan.events
      .map((event) => event.audioUrl)
      .filter((audioUrl): audioUrl is string => typeof audioUrl === "string" && audioUrl.length > 0),
  )];
}

export function normalizeCategoryToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "unsorted";
}

export function categoryTokenFromAudioUrl(audioUrl: string | null): string {
  if (!audioUrl) return "unsorted";
  const relativePath = audioUrl.startsWith("output/")
    ? audioUrl.slice("output/".length)
    : audioUrl;
  const slashIndex = relativePath.indexOf("/");
  if (slashIndex <= 0) return "unsorted";
  return normalizeCategoryToken(relativePath.slice(0, slashIndex));
}

export function categoryColorFromAudioUrl(audioUrl: string | null): string {
  const token = categoryTokenFromAudioUrl(audioUrl);
  return `var(--channel-${token}, var(--channel-unsorted, #6b83aa))`;
}

export function describeMixLane(channelId: string): string {
  if (channelId.startsWith("lane-")) {
    return `Lane ${Number(channelId.slice(5)) + 1}`;
  }
  if (channelId.startsWith("track-")) {
    return `Track ${Number(channelId.slice(6)) + 1}`;
  }
  return channelId;
}
