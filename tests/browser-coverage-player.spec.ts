import { test, expect } from "./baseFixtures.js";
import { openCoverageHarnessAndWaitForNetworkIdle } from "./playwright-test-helpers.js";

test.describe("browser coverage gap", () => {
  const MIX_PLAYER_MOD = "/src/mix-player.ts";

  test("mix-player executes playback-plan, graph, and fetch helper paths in the browser", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      const connections: string[] = [];
      const disconnects: string[] = [];
      const starts: number[] = [];
      const stops: number[] = [];
      const fetchUrls: string[] = [];

      const connect = (label: string) => (destination: unknown) => {
        connections.push(`${label}->${typeof destination}`);
        return destination as object;
      };

      const makeGain = () => ({
        gain: { value: 1 },
        connect: connect("gain"),
        disconnect: () => { disconnects.push("gain"); },
      });

      const makePanner = () => ({
        pan: { value: 0 },
        connect: connect("panner"),
        disconnect: () => { disconnects.push("panner"); },
      });

      const makeDelay = () => ({
        delayTime: { value: 0 },
        connect: connect("delay"),
        disconnect: () => { disconnects.push("delay"); },
      });

      const makeConvolver = () => ({
        buffer: null,
        connect: connect("convolver"),
        disconnect: () => { disconnects.push("convolver"); },
      });

      const makeCompressor = () => ({
        threshold: { value: -24 },
        ratio: { value: 12 },
        connect: connect("compressor"),
        disconnect: () => { disconnects.push("compressor"); },
      });

      const makeBiquad = () => ({
        type: "peaking",
        frequency: { value: 1000 },
        Q: { value: 1 },
        gain: { value: 0 },
        connect: connect("biquad"),
        disconnect: () => { disconnects.push("biquad"); },
      });

      const makeWaveShaper = () => ({
        curve: null,
        oversample: "none" as const,
        connect: connect("waveshaper"),
        disconnect: () => { disconnects.push("waveshaper"); },
      });

      const makeOscillator = () => ({
        type: "sine",
        frequency: { value: 440 },
        connect: connect("oscillator"),
        disconnect: () => { disconnects.push("oscillator"); },
        start: (when?: number) => { starts.push(when ?? -1); },
        stop: (when?: number) => { stops.push(when ?? -1); },
      });

      const makeAnalyser = () => ({
        fftSize: 2048,
        frequencyBinCount: 1024,
        connect: connect("analyser"),
        disconnect: () => { disconnects.push("analyser"); },
      });

      const makeSource = () => ({
        buffer: null,
        playbackRate: { value: 1 },
        connect: connect("source"),
        disconnect: () => { disconnects.push("source"); },
        start: (when?: number) => { starts.push(when ?? -1); },
        stop: (when?: number) => { stops.push(when ?? -1); },
      });

      const ctx = {
        sampleRate: 44100,
        currentTime: 2,
        destination: { connect: connect("destination"), disconnect: () => { disconnects.push("destination"); } },
        createGain: makeGain,
        createStereoPanner: makePanner,
        createDelay: () => makeDelay(),
        createConvolver: makeConvolver,
        createDynamicsCompressor: makeCompressor,
        createBuffer: (_channels: number, length: number) => ({
          getChannelData: () => new Float32Array(length),
        }),
        createBufferSource: makeSource,
        createBiquadFilter: makeBiquad,
        createWaveShaper: makeWaveShaper,
        createOscillator: makeOscillator,
        createAnalyser: makeAnalyser,
        decodeAudioData: async (data: ArrayBuffer) => ({ decodedBytes: data.byteLength }),
      };

      const mix = {
        format: "D",
        product: "Dance_eJay_10",
        appId: 0x02f60006,
        bpm: 120,
        bpmAdjusted: null,
        author: null,
        title: null,
        registration: null,
        mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
        drumMachine: null,
        tickerText: [],
        catalogs: [
          { name: "DanceMachine Sample Kit Vol. 1", idRangeStart: 0, idRangeEnd: 100 },
          { name: "Dance eJay 2", idRangeStart: 100, idRangeEnd: 200 },
        ],
        tracks: [
          { beat: 0, channel: 0, sampleRef: { rawId: 7, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 1, channel: 1, sampleRef: { rawId: 9, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 2, channel: 2, sampleRef: { rawId: 0, internalName: "D5MG539", displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 3, channel: null, sampleRef: { rawId: 0, internalName: "folder/LEAD.WAV", displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 4, channel: Number.NaN, sampleRef: { rawId: 0, internalName: null, displayName: "kick28", resolvedPath: null, dataLength: null } },
          { beat: Number.POSITIVE_INFINITY, channel: Number.POSITIVE_INFINITY, sampleRef: { rawId: 0, internalName: null, displayName: "sub/vox.wav", resolvedPath: null, dataLength: null } },
          { beat: -2, channel: 4, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "Loop/fallback.wav", dataLength: null } },
          { beat: 6, channel: 5, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "output/Loop/already.wav", dataLength: null } },
          { beat: 7, channel: 6, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        ],
      };

      const sampleIndex = {
        Dance_eJay1: {
          byAlias: {},
          bySource: {},
          byStem: { lead: "Loop/lead.wav" },
          byInternalName: { d5mg539: "Drum/internal.wav" },
          bySampleId: { "7": "Drum/kick.wav" },
          byGen1Id: { "9": "Drum/gen1.wav" },
        },
        SampleKit_DMKIT1: {
          byAlias: { kick28: "Drum/kick28.wav" },
          bySource: {},
          byStem: { vox: "Voice/vox.wav" },
          byInternalName: {},
          bySampleId: {},
          byGen1Id: {},
        },
        Dance_eJay2: {
          byAlias: {},
          bySource: {},
          byStem: {},
          byInternalName: {},
          bySampleId: {},
          byGen1Id: {},
        },
      };

      const plan = mod.buildMixPlaybackPlan(mix, sampleIndex);
      const emptyPlan = mod.buildMixPlaybackPlan({ ...mix, tracks: [] }, undefined);

      const channel = new mod.MixChannel(ctx);
      channel.setVolume(50);
      channel.setPan(100);
      channel.setMuted(true);
      channel.setMuted(false);

      const secondChannel = new mod.MixChannel(ctx);
      const solo = new mod.SoloGroup();
      solo.attach("a", channel);
      solo.attach("b", secondChannel);
      solo.setSoloed("a", true);
      solo.setSoloed("missing", true);

      const drum = new mod.DrumMachine(ctx, ctx.destination);
      const missingPad = drum.trigger("ghost", 0);
      drum.setPad("kick", { buffer: { id: "kick" }, semitones: 12, gain: 0.25 });
      const triggeredPad = drum.trigger("kick", 0.5);
      drum.dispose();

      const effects = [
        mod.createEffect(ctx, "compressor"),
        mod.createEffect(ctx, "delay"),
        mod.createEffect(ctx, "reverb"),
        mod.createEffect(ctx, "overdrive"),
        mod.createEffect(ctx, "eq10"),
        mod.createEffect(ctx, "chorus"),
        mod.createEffect(ctx, "midsweep"),
        mod.createEffect(ctx, "harmonizer"),
        mod.createEffect(ctx, "vocoder"),
      ];
      for (const effect of effects) {
        effect.input.connect(effect.output);
        effect.dispose?.();
      }

      const host = new mod.MixPlayerHost(ctx);
      host.registerChannel("lane-0");
      host.registerChannel("lane-1");
      host.scheduleSample({ buffer: { id: 1 }, beat: 0, channelId: "lane-0", semitones: 12 });
      host.scheduleSample({ buffer: { id: 2 }, beat: 1, channelId: "unknown" });
      const started = host.play(120, 4);
      host.stop();
      host.clear();

      const curve = mod.buildOverdriveCurve(32, 25);
      const emptyCurve = mod.buildOverdriveCurve(0, 10);
      const impulse = mod.buildImpulseResponse(8000, 0.25, 2);
      const emptyImpulse = mod.buildImpulseResponse(0, 0.25, 2);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url.includes("bad%20file.mix")) {
          return {
            ok: false,
            status: 404,
            arrayBuffer: async () => new ArrayBuffer(0),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
        } as Response;
      };

      const fetched = await mod.fetchMixBinary("Dance eJay 1", "START.MIX");
      let fetchError = "";
      try {
        await mod.fetchMixBinary("Broken Product", "bad file.mix");
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
      }
      globalThis.fetch = originalFetch;

      channel.dispose();
      secondChannel.dispose();

      return {
        plan: {
          channelIds: plan.channelIds,
          resolvedEvents: plan.resolvedEvents,
          unresolvedEvents: plan.unresolvedEvents,
          loopBeats: plan.loopBeats,
          audioUrls: plan.events.map((event: { audioUrl: string | null }) => event.audioUrl),
          labels: plan.events.map((event: { displayLabel: string }) => event.displayLabel),
        },
        emptyPlan: {
          loopBeats: emptyPlan.loopBeats,
          resolvedEvents: emptyPlan.resolvedEvents,
          unresolvedEvents: emptyPlan.unresolvedEvents,
        },
        channelState: {
          gain: channel.gain.gain.value,
          pan: channel.panner.pan.value,
          anySoloed: solo.anySoloed,
          secondGain: secondChannel.gain.gain.value,
        },
        drumMachine: {
          missingPad,
          triggeredRate: triggeredPad?.playbackRate.value ?? null,
          padCountAfterDispose: drum.padCount,
        },
        effects: effects.map((effect: { kind: string }) => effect.kind),
        host: {
          started,
          scheduledCount: host.scheduledCount,
          isPlaying: host.isPlaying,
        },
        helpers: {
          beatsToSeconds: mod.beatsToSeconds(4, 120),
          volumeToGain: mod.volumeToGain(150),
          panToStereo: mod.panToStereo(0),
          semitonesToRate: mod.semitonesToRate(12),
          effectiveGain: mod.effectiveGain({ volume: 80, muted: false, soloed: true, anySoloed: true }),
          curveLength: curve.length,
          emptyCurveLength: emptyCurve.length,
          impulseLength: impulse.length,
          emptyImpulseLength: emptyImpulse.length,
        },
        fetch: {
          urls: fetchUrls,
          fetchedBytes: fetched.byteLength,
          error: fetchError,
        },
        starts,
        stops,
        disconnectCount: disconnects.length,
        connectionCount: connections.length,
      };
    }, MIX_PLAYER_MOD);

    expect(result.plan.channelIds).toEqual([
      "lane-0",
      "lane-1",
      "lane-2",
      "track-3",
      "track-4",
      "track-5",
      "lane-4",
      "lane-5",
      "lane-6",
    ]);
    expect(result.plan.resolvedEvents).toBe(8);
    expect(result.plan.unresolvedEvents).toBe(1);
    expect(result.plan.loopBeats).toBe(8);
    expect(result.plan.audioUrls).toEqual([
      "output/Drum/kick.wav",
      "output/Loop/fallback.wav",
      "output/Voice/vox.wav",
      "output/Drum/gen1.wav",
      "output/Drum/internal.wav",
      "output/Loop/lead.wav",
      "output/Drum/kick28.wav",
      "output/Loop/already.wav",
      null,
    ]);
    expect(result.plan.labels).toContain("#7");
    expect(result.plan.labels).toContain("D5MG539");
    expect(result.plan.labels).toContain("kick28");
    expect(result.emptyPlan).toEqual({ loopBeats: null, resolvedEvents: 0, unresolvedEvents: 0 });
    expect(result.channelState).toEqual({ gain: 0.5, pan: 1, anySoloed: true, secondGain: 0 });
    expect(result.drumMachine.missingPad).toBeNull();
    expect(result.drumMachine.triggeredRate).toBeCloseTo(2);
    expect(result.drumMachine.padCountAfterDispose).toBe(0);
    expect(result.effects).toEqual([
      "compressor",
      "delay",
      "reverb",
      "overdrive",
      "eq10",
      "chorus",
      "midsweep",
      "harmonizer",
      "vocoder",
    ]);
    expect(result.host).toEqual({ started: 1, scheduledCount: 0, isPlaying: false });
    expect(result.helpers.beatsToSeconds).toBeCloseTo(2);
    expect(result.helpers.volumeToGain).toBe(1);
    expect(result.helpers.panToStereo).toBe(-1);
    expect(result.helpers.semitonesToRate).toBeCloseTo(2);
    expect(result.helpers.effectiveGain).toBeCloseTo(0.8);
    expect(result.helpers.curveLength).toBe(32);
    expect(result.helpers.emptyCurveLength).toBe(0);
    expect(result.helpers.impulseLength).toBe(2000);
    expect(result.helpers.emptyImpulseLength).toBe(0);
    expect(result.fetch.urls).toEqual([
      "/mix/Dance%20eJay%201/START.MIX",
      "/mix/Broken%20Product/bad%20file.mix",
    ]);
    expect(result.fetch.fetchedBytes).toBe(4);
    expect(result.fetch.error).toContain("HTTP 404");
    expect(result.starts.length).toBeGreaterThanOrEqual(4);
    expect(result.stops.length).toBeGreaterThanOrEqual(1);
    expect(result.disconnectCount).toBeGreaterThan(0);
    expect(result.connectionCount).toBeGreaterThan(0);
  });

  test("mix-player covers alias lookup, timeline-length variants, and host edge branches", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      const makeAudioBuffer = (length = 44100, sampleRate = 44100) => ({
        duration: length / sampleRate,
        length,
        numberOfChannels: 1,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      });

      const sourceStartTimes: number[] = [];
      const sourceStopTimes: number[] = [];
      let throwOnScheduledStop = false;

      const makeSource = () => ({
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => {},
        disconnect: () => {},
        start: (when?: number) => { sourceStartTimes.push(when ?? -1); },
        stop: (when?: number) => {
          if (typeof when === "number") {
            if (throwOnScheduledStop) {
              throw new Error("scheduled stop unsupported");
            }
            sourceStopTimes.push(when);
            return;
          }
          sourceStopTimes.push(-1);
        },
      });

      const ctx = {
        sampleRate: 44100,
        currentTime: 3,
        destination: { connect: () => {}, disconnect: () => {} },
        createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} }),
        createStereoPanner: () => ({ pan: { value: 0 }, connect: () => {}, disconnect: () => {} }),
        createDelay: () => ({ delayTime: { value: 0 }, connect: () => {}, disconnect: () => {} }),
        createConvolver: () => ({ buffer: null, connect: () => {}, disconnect: () => {} }),
        createDynamicsCompressor: () => ({
          threshold: { value: -24 },
          ratio: { value: 12 },
          connect: () => {},
          disconnect: () => {},
        }),
        createBuffer: (_channels: number, length: number, sampleRate: number) => makeAudioBuffer(length, sampleRate),
        createBufferSource: makeSource,
        createBiquadFilter: () => ({
          type: "peaking",
          frequency: { value: 1000 },
          Q: { value: 1 },
          gain: { value: 0 },
          connect: () => {},
          disconnect: () => {},
        }),
        createWaveShaper: () => ({ curve: null, oversample: "none" as const, connect: () => {}, disconnect: () => {} }),
        createOscillator: () => ({
          type: "sine",
          frequency: { value: 440 },
          connect: () => {},
          disconnect: () => {},
          start: () => {},
          stop: () => {},
        }),
        createAnalyser: () => ({ fftSize: 1024, frequencyBinCount: 512, connect: () => {}, disconnect: () => {} }),
        decodeAudioData: async (data: ArrayBuffer) => makeAudioBuffer(Math.max(1, data.byteLength)),
      };

      const sampleIndex = {
        Techno_eJay: {
          byAlias: { voxhit: "Voice/voxhit.wav" },
          bySource: {},
          byStem: { lead: "Loop/lead.wav", hit: "Voice/hit.wav" },
          byInternalName: { eurokick5: "Drum/eurokick5.wav", ravea01: "Drum/ravea01.wav" },
          bySampleId: { "1": "Drum/by-sample-id.wav" },
          byGen1Id: { "2": "Drum/by-gen1-id.wav" },
          byPath: {
            "Drum/by-sample-id.wav": "Sample ID",
            "Drum/eurokick5.wav": "Euro Kick 5",
            "Loop/meta-len.wav": "Meta Length",
          },
          byPathBeats: {
            "Loop/meta-len.wav": 12,
            "Loop/too-long.wav": 24,
          },
        },
        Dance_eJay2: {
          byAlias: {},
          bySource: {},
          byStem: {},
          byInternalName: {},
          bySampleId: {},
          byGen1Id: {},
        },
        House_eJay: {
          byAlias: {},
          bySource: {},
          byStem: {},
          byInternalName: {},
          bySampleId: {},
          byGen1Id: {},
        },
      };

      const baseMix = {
        format: "A",
        product: "Techno_eJay_",
        appId: 0x0889,
        bpm: 140,
        bpmAdjusted: null,
        author: null,
        title: null,
        registration: null,
        mixer: { channels: [], eq: [], compressor: null, stereoWide: null, raw: {} },
        drumMachine: null,
        tickerText: [],
        catalogs: [
          { name: "Techno eJay 3", idRangeStart: 0, idRangeEnd: 10 },
          { name: "Rave eJay", idRangeStart: 11, idRangeEnd: 20 },
          { name: "Dance SuperPack", idRangeStart: 21, idRangeEnd: 30 },
          { name: "House eJay", idRangeStart: 31, idRangeEnd: 40 },
          { name: "Xtreme eJay", idRangeStart: 41, idRangeEnd: 50 },
          { name: "HipHop eJay 4", idRangeStart: 51, idRangeEnd: 60 },
        ],
        tracks: [
          { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 4, channel: 0, sampleRef: { rawId: 0, internalName: "EUROKICK5", displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 7, channel: 0, sampleRef: { rawId: 0, internalName: "folder/lead.wav", displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 10, channel: 1, sampleRef: { rawId: 2, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 14, channel: 1, sampleRef: { rawId: 0, internalName: null, displayName: "VoxHit", resolvedPath: null, dataLength: null } },
          { beat: 18, channel: 1, sampleRef: { rawId: 0, internalName: null, displayName: "folder/hit.wav", resolvedPath: null, dataLength: null } },
          { beat: 22, channel: 2, sampleRef: { rawId: 0, internalName: "missing", displayName: null, resolvedPath: "Loop/meta-len.wav", dataLength: null } },
          { beat: 26, channel: 2, sampleRef: { rawId: 0, internalName: "missing2", displayName: null, resolvedPath: "Loop/too-long.wav", dataLength: null } },
          { beat: 30, channel: 3, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "output/Loop/already.wav", dataLength: null } },
          { beat: 34, channel: null, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        ],
      };

      const planA = mod.buildMixPlaybackPlan(baseMix, sampleIndex);
      const planB = mod.buildMixPlaybackPlan({
        ...baseMix,
        format: "B",
        product: "Techno_eJay",
        tracks: [
          { beat: 0, channel: 0, sampleRef: { rawId: 1, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
          { beat: 5, channel: 0, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "Loop/too-long.wav", dataLength: null } },
        ],
      }, sampleIndex);
      const planList = mod.buildMixPlaybackPlan({
        ...baseMix,
        format: "D",
        tracks: [
          { beat: null, channel: null, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: null, dataLength: null } },
        ],
      }, sampleIndex);
      const planUnknown = mod.buildMixPlaybackPlan({
        ...baseMix,
        product: "Unknown_Product",
        tracks: [
          { beat: 0, channel: 0, sampleRef: { rawId: 0, internalName: null, displayName: null, resolvedPath: "Loose/path.wav", dataLength: null } },
        ],
      }, sampleIndex);

      const host = new mod.MixPlayerHost(ctx);
      host.registerChannel("lane-0");
      host.scheduleSample({ buffer: makeAudioBuffer(), beat: 4, channelId: "lane-0", durationBeats: 2 });
      const startedOnce = host.play(120, 10);
      const startedTwice = host.play(120, 10);
      host.stop();

      const hostStopThrow = new mod.MixPlayerHost(ctx);
      hostStopThrow.registerChannel("lane-0");
      hostStopThrow.scheduleSample({ buffer: makeAudioBuffer(), beat: 0, channelId: "lane-0", durationBeats: 1 });
      throwOnScheduledStop = true;
      const startedWithThrowingStop = hostStopThrow.play(120, 0);
      throwOnScheduledStop = false;
      hostStopThrow.clear();

      let invalidBpmMessage = "";
      let invalidBeatsMessage = "";
      try {
        mod.beatsToSeconds(4, 0);
      } catch (error) {
        invalidBpmMessage = error instanceof Error ? error.message : String(error);
      }
      try {
        mod.beatsToSeconds(Number.NaN, 120);
      } catch (error) {
        invalidBeatsMessage = error instanceof Error ? error.message : String(error);
      }

      return {
        planA: {
          loopBeats: planA.loopBeats,
          timelineUnitBeats: planA.timelineUnitBeats,
          timelineRecovered: planA.timelineRecovered,
          laneCount: planA.lanes.length,
          labels: planA.events.map((event: { displayLabel: string }) => event.displayLabel),
          lengths: planA.events.map((event: { lengthBeats: number }) => event.lengthBeats),
          audioUrls: planA.events.map((event: { audioUrl: string | null }) => event.audioUrl),
        },
        planB: {
          loopBeats: planB.loopBeats,
          lengths: planB.events.map((event: { lengthBeats: number }) => event.lengthBeats),
        },
        planList: {
          loopBeats: planList.loopBeats,
          timelineRecovered: planList.timelineRecovered,
          firstLength: planList.events[0]?.lengthBeats ?? null,
        },
        planUnknownAudioUrl: planUnknown.events[0]?.audioUrl ?? null,
        lanesForB: mod.lanesForMix({ ...baseMix, format: "B" }).at(-1)?.label ?? null,
        recoveredBeat: mod.maxRecoveredBeat([{ beat: null }, { beat: 9 }, { beat: 2 }]),
        host: {
          startedOnce,
          startedTwice,
          startedWithThrowingStop,
          startTimes: sourceStartTimes,
          stopTimes: sourceStopTimes,
        },
        helperEdges: {
          volumeNaN: mod.volumeToGain(Number.NaN),
          panNaN: mod.panToStereo(Number.NaN),
          semitoneNaN: mod.semitonesToRate(Number.NaN),
          negativeCurveLength: mod.buildOverdriveCurve(-1, 10).length,
          negativeAmountCurveLength: mod.buildOverdriveCurve(8, -5).length,
          invalidBpmMessage,
          invalidBeatsMessage,
        },
      };
    }, MIX_PLAYER_MOD);

    expect(result.planA.loopBeats).toBe(36);
    expect(result.planA.timelineUnitBeats).toBe(4);
    expect(result.planA.timelineRecovered).toBe(true);
    expect(result.planA.laneCount).toBe(8);
    expect(result.planA.labels).toContain("Sample ID");
    expect(result.planA.labels).toContain("Euro Kick 5");
    expect(result.planA.labels).toContain("Meta Length");
    expect(result.planA.labels).toContain("Unknown sample");
    expect(result.planA.audioUrls).toContain("output/Loop/already.wav");
    expect(result.planB.loopBeats).toBe(8);
    expect(result.planB.lengths).toEqual([5, 3]);
    expect(result.planList).toEqual({
      loopBeats: null,
      timelineRecovered: false,
      firstLength: 1,
    });
    expect(result.planUnknownAudioUrl).toBe("output/Loose/path.wav");
    expect(result.lanesForB).toBe("User Perc.");
    expect(result.recoveredBeat).toBe(9);
    expect(result.host.startedOnce).toBe(1);
    expect(result.host.startedTwice).toBe(0);
    expect(result.host.startedWithThrowingStop).toBe(1);
    expect(result.host.startTimes).toContain(12);
    expect(result.host.stopTimes).toContain(13);
    expect(result.helperEdges).toMatchObject({
      volumeNaN: 0,
      panNaN: 0,
      semitoneNaN: 1,
      negativeCurveLength: 0,
      negativeAmountCurveLength: 8,
    });
    expect(result.helperEdges.invalidBpmMessage).toContain("Invalid BPM");
    expect(result.helperEdges.invalidBeatsMessage).toContain("Invalid beats");
  });

  test("player module covers toggle, stop, and rejection paths in browser", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      type ListenerMap = Record<string, Array<() => void>>;

      class FakeAudio {
        src = "";
        paused = true;
        ended = false;
        currentTime = 0;
        duration = 5;
        private listeners: ListenerMap = {};

        addEventListener(type: string, fn: () => void): void {
          this.listeners[type] = this.listeners[type] ?? [];
          this.listeners[type].push(fn);
        }

        removeEventListener(type: string, fn: () => void): void {
          this.listeners[type] = (this.listeners[type] ?? []).filter((cb) => cb !== fn);
        }

        emit(type: string): void {
          for (const fn of this.listeners[type] ?? []) fn();
        }

        async play(): Promise<void> {
          if (this.src.includes("reject")) {
            return Promise.reject(new Error("blocked"));
          }
          this.paused = false;
          return Promise.resolve();
        }

        pause(): void {
          this.paused = true;
          this.emit("pause");
        }
      }

      const OriginalAudio = window.Audio;
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warns.push(args.map(String).join(" "));
      };

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;

      const states: string[] = [];
      const player = new mod.Player();
      player.onStateChange((state: string) => states.push(state));

      const flush = async (): Promise<void> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      };

      player.play("ok-1.wav");
      await flush();
      const activeAfterPlay = player.activePath;

      player.stop();
      await flush();

      player.toggle("ok-2.wav"); // toggles to play
      await flush();
      player.toggle("ok-2.wav"); // toggles to stop
      await flush();
      const activeAfterToggleStop = player.activePath;

      player.play("reject.wav"); // play() rejection path
      await flush();

      const intervalUnknown = mod.calcProgressInterval(0);
      const intervalNormal = mod.calcProgressInterval(3);

      const stateBeforeDestroy = player.state;
      player.destroy();
      const stateAfterDestroy = player.state;

      (window as unknown as { Audio: typeof Audio }).Audio = OriginalAudio;
      console.warn = originalWarn;

      return {
        states,
        activeAfterPlay,
        activeAfterToggleStop,
        intervalUnknown,
        intervalNormal,
        stateBeforeDestroy,
        stateAfterDestroy,
        warns,
      };
    }, "/src/player.ts");

    expect(result.states).toContain("playing");
    expect(result.states).toContain("stopped");
    expect(result.activeAfterPlay).toBe("ok-1.wav");
    expect(result.activeAfterToggleStop).toBeNull();
    expect(result.intervalUnknown).toBe(250);
    expect(result.intervalNormal).toBe(150);
    expect(result.stateBeforeDestroy).toBe("stopped");
    expect(result.stateAfterDestroy).toBe("stopped");
    expect(result.warns.some((line: string) => line.includes("Audio playback failed"))).toBe(true);
  });

  test("sample-grid context menu covers sample and grid right-click branches", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.className = "sample-grid";
      const block = document.createElement("div");
      block.className = "sample-block";
      block.dataset.filename = "kick.wav";
      host.appendChild(block);
      document.body.appendChild(host);

      const categories = [
        {
          id: "Drum",
          name: "Drum",
          sampleCount: 1,
          subcategories: ["kick", "snare"],
        },
      ];
      const samples = [
        {
          filename: "kick.wav",
          category: "Drum",
          subcategory: "kick",
          product: "Dance_eJay1",
          source_archive: "archive",
        },
      ];

      const moved: Array<{ category: string; subcategory: string | null }> = [];
      let sortState = { key: "filename", dir: "asc" };
      let refreshCalls = 0;

      const controller = mod.createSampleGridContextMenuController({
        getCategories: () => categories,
        getCurrentGridSamples: () => samples,
        getSortState: () => sortState,
        setSortState: (key: string, dir: string) => {
          sortState = { key, dir };
        },
        refreshSamples: () => {
          refreshCalls += 1;
        },
        onMoveSample: (_sample: unknown, category: string, subcategory: string | null) => {
          moved.push({ category, subcategory });
        },
      });

      const sampleEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 50,
      });
      Object.defineProperty(sampleEvent, "target", { value: block });
      controller.handleContextMenu(sampleEvent);

      const sampleMenuShown = document.getElementById(mod.SAMPLE_CONTEXT_MENU_ID) !== null;
      const moveButton = document.querySelector<HTMLElement>("#sample-context-menu .ctx-submenu .ctx-menu-item");
      moveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      // Dismiss via escape path in attachMenuDismiss.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      const gridEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
      });
      Object.defineProperty(gridEvent, "target", { value: host });
      controller.handleContextMenu(gridEvent);

      const sortMenuShown = document.getElementById(mod.SAMPLE_CONTEXT_MENU_ID) !== null;
      const sortButton = document.querySelector<HTMLButtonElement>("#sample-context-menu button.ctx-menu-item");
      sortButton?.click();

      controller.close();

      host.remove();
      return {
        sampleMenuShown,
        sortMenuShown,
        moved,
        sortState,
        refreshCalls,
        menuExistsAfterClose: document.getElementById(mod.SAMPLE_CONTEXT_MENU_ID) !== null,
      };
    }, "/src/sample-grid-context-menu.ts");

    expect(result.sampleMenuShown).toBe(true);
    expect(result.sortMenuShown).toBe(true);
    expect(result.moved.length).toBeGreaterThanOrEqual(1);
    expect(result.refreshCalls).toBeGreaterThanOrEqual(1);
    expect(result.menuExistsAfterClose).toBe(false);
  });

});

