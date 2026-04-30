import { describe, expect, it } from "vitest";

import {
  categoryColorFromAudioUrl,
  categoryTokenFromAudioUrl,
  clampMixBeat,
  collectMixAudioUrls,
  describeMixLane,
  timelineBpm,
  timelineWidthPx,
} from "../mix-playback-controller.js";

describe("mix-playback-controller helpers", () => {
  it("collects unique non-empty audio URLs", () => {
    const urls = collectMixAudioUrls({
      events: [
        { audioUrl: "output/Drum/kick.wav" },
        { audioUrl: null },
        { audioUrl: "" },
        { audioUrl: "output/Drum/kick.wav" },
        { audioUrl: "output/Bass/riff.wav" },
      ],
    } as never);

    expect(urls).toEqual([
      "output/Drum/kick.wav",
      "output/Bass/riff.wav",
    ]);
  });

  it("derives category tokens and colors from audio URLs", () => {
    expect(categoryTokenFromAudioUrl("output/Voice/sing.wav")).toBe("voice");
    expect(categoryTokenFromAudioUrl("Drum/kick.wav")).toBe("drum");
    expect(categoryTokenFromAudioUrl(null)).toBe("unsorted");
    expect(categoryTokenFromAudioUrl("no-slash")).toBe("unsorted");

    expect(categoryColorFromAudioUrl("output/Loop/fill.wav")).toBe("var(--channel-loop, var(--channel-unsorted, #6b83aa))");
  });

  it("formats fallback lane labels", () => {
    expect(describeMixLane("lane-0")).toBe("Lane 1");
    expect(describeMixLane("track-9")).toBe("Track 10");
    expect(describeMixLane("custom")).toBe("custom");
  });

  it("computes timeline helpers", () => {
    expect(timelineWidthPx(8)).toBe(544);
    expect(timelineBpm({ bpm: 140, timelineUnitBeats: 1 } as never)).toBe(140);
    expect(timelineBpm({ bpm: 140, timelineUnitBeats: 2 } as never)).toBe(70);
    expect(clampMixBeat(4.6, 8)).toBe(4);
    expect(clampMixBeat(Number.NaN, 8)).toBe(0);
    expect(clampMixBeat(9, 8)).toBe(7);
    expect(clampMixBeat(3, null)).toBe(0);
  });
});
