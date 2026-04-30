import { test, expect } from "./baseFixtures.js";

test.describe("browser coverage gap", () => {
  const BUFFER_MOD = "/src/mix-buffer.ts";
  const PARSER_MOD = "/src/mix-parser.ts";
  const MIX_PLAYER_MOD = "/src/mix-player.ts";
  const MIX_FILE_BROWSER_MOD = "/src/mix-file-browser.ts";

  test("mix-buffer executes browser-only wrapper paths", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const { MixBuffer } = await import(/* @vite-ignore */ modPath);

      const raw = new Uint8Array([0x41, 0x42, 0xff, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12, 0xfe, 0xff]);
      const fromTyped = new MixBuffer(raw);
      const fromArray = new MixBuffer(raw.buffer.slice(0));

      const longBytes = new Uint8Array(0x8002);
      longBytes.fill(0x43);
      const longBuffer = new MixBuffer(longBytes);

      let unsupportedMessage = "";
      try {
        fromTyped.toString("utf8" as never);
      } catch (error) {
        unsupportedMessage = error instanceof Error ? error.message : String(error);
      }

      const slice = fromArray.subarray(0, 3).toString("latin1");

      return {
        lengths: [fromTyped.length, fromArray.length],
        readUInt8: fromTyped.readUInt8(2),
        readUInt16LE: fromTyped.readUInt16LE(3),
        readUInt32LE: fromTyped.readUInt32LE(5),
        readInt16LE: fromTyped.readInt16LE(9),
        sliceCodes: [...slice].map((char) => char.charCodeAt(0)),
        emptyString: fromTyped.toString("latin1", 4, 4),
        longStringLength: longBuffer.toString("latin1").length,
        atValue: fromTyped.at(1),
        iterTail: [...fromTyped].slice(-3),
        unsupportedMessage,
      };
    }, BUFFER_MOD);

    expect(result.lengths).toEqual([11, 11]);
    expect(result.readUInt8).toBe(255);
    expect(result.readUInt16LE).toBe(0x1234);
    expect(result.readUInt32LE).toBe(0x12345678);
    expect(result.readInt16LE).toBe(-2);
    expect(result.sliceCodes).toEqual([0x41, 0x42, 0xff]);
    expect(result.emptyString).toBe("");
    expect(result.longStringLength).toBe(0x8002);
    expect(result.atValue).toBe(0x42);
    expect(result.iterTail).toEqual([0x12, 0xfe, 0xff]);
    expect(result.unsupportedMessage).toContain("Unsupported MixBuffer encoding");
  });

  test("mix-parser executes real archive formats and synthetic helper paths in the browser", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const formatAHeaderBytes = 2;
      const formatARowBytes = 16;
      const formatACellBytes = 2;
      const formatAZeroGap = 32;

      const asciiBytes = (value: string): number[] => [...value].map((char) => char.charCodeAt(0));

      const fetchBytes = async (url: string): Promise<Uint8Array> => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      };

      const pickProductMixUrl = async (
        productId: string,
        preferredFilenames: string[] = [],
      ): Promise<string> => {
        for (const filename of preferredFilenames) {
          const candidate = `/mix/${productId}/${filename}`;
          const head = await fetch(candidate, { method: "HEAD" });
          if (head.ok) return candidate;
        }

        const indexResponse = await fetch("/data/index.json");
        if (!indexResponse.ok) {
          throw new Error(`Failed to fetch /data/index.json: ${indexResponse.status}`);
        }
        const index = await indexResponse.json() as {
          mixLibrary?: Array<{ id: string; mixes: Array<{ filename: string }> }>;
        };
        const group = index.mixLibrary?.find((entry) => entry.id === productId);
        const fallback = group?.mixes?.[0]?.filename;
        if (!fallback) {
          throw new Error(`No mixes found for product ${productId}`);
        }
        return `/mix/${productId}/${fallback}`;
      };

      const buildFormatA = (
        appSig: number,
        cells: Array<{ row: number; col: number; id: number }>,
        trailer?: string,
      ): Uint8Array => {
        const maxRow = cells.reduce((currentMax, cell) => Math.max(currentMax, cell.row), 0);
        const gridBytes = (maxRow + 1) * formatARowBytes;
        const trailerBytes = trailer ? asciiBytes(trailer) : [];
        const gapBytes = trailerBytes.length > 0 ? formatAZeroGap + 8 : 0;
        const bytes = new Uint8Array(formatAHeaderBytes + gridBytes + gapBytes + trailerBytes.length);
        const view = new DataView(bytes.buffer);

        view.setUint16(0, appSig, true);
        for (const cell of cells) {
          const offset = formatAHeaderBytes + (cell.row * formatARowBytes) + (cell.col * formatACellBytes);
          view.setUint16(offset, cell.id, true);
        }

        if (trailerBytes.length > 0) {
          bytes.set(trailerBytes, bytes.length - trailerBytes.length);
        }

        return bytes;
      };

      const buildCatalogEntry = (
        name: string,
        start: number,
        end: number,
        withUnknownField: boolean,
      ): Uint8Array => {
        const nameBytes = Uint8Array.from([...asciiBytes(name), 0x00, 0x01]);
        const prefix = new Uint8Array(2);
        new DataView(prefix.buffer).setUint16(0, nameBytes.length, true);

        const range = new Uint8Array(withUnknownField ? 10 : 8);
        const rangeView = new DataView(range.buffer);
        let offset = 0;
        if (withUnknownField) {
          rangeView.setUint16(offset, 0x0009, true);
          offset += 2;
        }
        rangeView.setUint32(offset, start, true);
        offset += 4;
        rangeView.setUint32(offset, end, true);

        const combined = new Uint8Array(prefix.length + nameBytes.length + range.length);
        combined.set(prefix, 0);
        combined.set(nameBytes, prefix.length);
        combined.set(range, prefix.length + nameBytes.length);
        return combined;
      };

      const concat = (...chunks: Uint8Array[]): Uint8Array => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      };

      const syntheticA = buildFormatA(
        mod.APP_SIG_HIPHOP1,
        [
          { row: 0, col: 1, id: 1231 },
          { row: 1, col: 3, id: 746 },
        ],
        "Dance eJay 1.01\0",
      );

      const buildGen23Mix = (options: {
        appId: number;
        bpm: number;
        bpm2?: number;
        metadataParts?: string[];
        title?: string;
        mixerText?: string;
        catalogs?: Uint8Array;
        tail?: Uint8Array;
      }): Uint8Array => {
        const metadataText = options.metadataParts && options.metadataParts.length > 0
          ? `${options.metadataParts.join("\0")}\0`
          : "";
        const metadataBytes = Uint8Array.from(asciiBytes(metadataText));
        const titleBytes = options.title ? Uint8Array.from(asciiBytes(options.title)) : new Uint8Array(0);
        const mixerBytes = options.mixerText ? Uint8Array.from(asciiBytes(options.mixerText)) : new Uint8Array(0);
        const titleTerminator = options.title ? Uint8Array.from([0x00]) : new Uint8Array(0);
        const sectionPayload = concat(titleBytes, titleTerminator, mixerBytes);

        const header = new Uint8Array(0x10);
        const view = new DataView(header.buffer);
        view.setUint32(0, options.appId, true);
        view.setUint32(4, 0, true);
        view.setUint16(8, options.bpm, true);
        view.setUint16(0x0a, options.bpm2 ?? options.bpm, true);
        view.setUint16(0x0c, 0, true);
        view.setUint16(0x0e, metadataBytes.length, true);

        return concat(
          header,
          metadataBytes,
          Uint8Array.from([sectionPayload.length & 0xff, (sectionPayload.length >>> 8) & 0xff]),
          sectionPayload,
          options.catalogs ?? new Uint8Array(0),
          options.tail ?? new Uint8Array(0),
        );
      };

      const buildFormatCTrackWithDuplicatePaths = (
        name: string,
        laneCode: number,
        dataLength: number,
        firstPath: string,
        secondPath: string,
      ): Uint8Array => {
        const nameBytes = Uint8Array.from(asciiBytes(name));
        const bytes = new Uint8Array(2 + nameBytes.length + 2 + 4 + 4 + firstPath.length + 2 + secondPath.length);
        const view = new DataView(bytes.buffer);
        let offset = 0;

        view.setUint16(offset, nameBytes.length, true);
        offset += 2;
        bytes.set(nameBytes, offset);
        offset += nameBytes.length;
        view.setInt16(offset, laneCode, true);
        offset += 2;
        view.setUint32(offset, 0x11223344, true);
        offset += 4;
        view.setUint32(offset, dataLength, true);
        offset += 4;
        bytes.set(Uint8Array.from(asciiBytes(firstPath)), offset);
        offset += firstPath.length;
        bytes[offset] = 0x00;
        bytes[offset + 1] = 0x00;
        offset += 2;
        bytes.set(Uint8Array.from(asciiBytes(secondPath)), offset);

        return bytes;
      };

      const kv = (key: string, value: string): string => `${key}#\u00b0_#${value}%\u00b0_%`;

      const helperCatalogs = concat(
        Uint8Array.from([0x00, 0x00, 0x00]),
        buildCatalogEntry("Dance eJay 2.0", 2000, 3399, true),
        buildCatalogEntry("DanceMachine Samples", 3400, 3899, false),
        Uint8Array.from([0x02, 0x00, 0x00, 0x01, 0x99, 0x88]),
      );

      const syntheticCCatalogs = concat(
        buildCatalogEntry("Synthetic Pack", 1, 99, false),
        Uint8Array.from([0x02, 0x00, 0x00, 0x01]),
      );
      const syntheticCTracks = concat(
        buildFormatCTrackWithDuplicatePaths(
          "SynthKick",
          23,
          4096,
          "C:\\Temp\\pxd32pa.tmp",
          "D:\\Temp\\pxd32pb.tmp",
        ),
        Uint8Array.from([0x00, 0x00, 0x00]),
        Uint8Array.from(asciiBytes("E:\\Temp\\pxd32pc.tmp")),
      );
      const syntheticCBytes = buildGen23Mix({
        appId: 0x00000a10,
        bpm: 128,
        bpm2: 130,
        metadataParts: ["Synth Author", "#SKKENNUNG#:REGCODE", "Ignored"],
        title: "Synthetic C",
        mixerText: [
          kv("VideoMix", "clip"),
          kv("BOOU1_0", "500"),
          kv("BOOU2_0", "250"),
          kv("DrumEQ0", "75"),
          kv("BoostEQ_0", "42"),
          kv("BO_COMP_DRIVE_SCROLL", "11"),
          kv("BO_COMP_GAIN_SCROLL", "22"),
          kv("BO_COMP_SPEED_SCROLL", "33"),
          kv("BO_COMP_LED", "1"),
          kv("BO_STEREOWIDE_SPREAD_SCROLL", "44"),
        ].join(""),
        catalogs: syntheticCCatalogs,
        tail: syntheticCTracks,
      });
      const syntheticDMinimalBytes = new Uint8Array(0x10);
      const syntheticDMinimalView = new DataView(syntheticDMinimalBytes.buffer);
      syntheticDMinimalView.setUint32(0, 0x00000a11, true);
      syntheticDMinimalView.setUint16(8, 92, true);
      syntheticDMinimalView.setUint16(0x0a, 92, true);
      syntheticDMinimalView.setUint16(0x0e, 32, true);
      const syntheticDRichBytes = buildGen23Mix({
        appId: 0x00000a11,
        bpm: 95,
        metadataParts: ["Late Author", "#SKKENNUNG#:LATE"],
        title: "Synthetic D",
        mixerText: [
          kv("MixVolume1", "400"),
          kv("MixPan1", "60"),
          kv("MixMute1", "1"),
          kv("MixSolo1", "1"),
          kv("BOequ0", "70"),
          kv("BOcomDri", "3"),
          kv("BOcomGai", "4"),
          kv("BOcomSpe", "5"),
          kv("BOcomLED", "active"),
          kv("BOsteSpr", "55"),
          kv("DrumName1", "Kick"),
          kv("DrumVolume1", "600"),
          kv("DrumPan1", "40"),
          kv("DrumPitch1", "2"),
          kv("DrumReverse1", "active"),
          kv("DrumFX1", "wet"),
          kv("DRUMvolume", "650"),
          kv("DRUMchoLED", "active"),
          kv("DRUMechLED", "active"),
          kv("DRUMequLED", "active"),
          kv("DRUMoveLED", "active"),
          kv("DRUMrevLED", "active"),
        ].join(""),
      });

      const parsedCatalogs = mod.parseCatalogs(new mod.MixBuffer(helperCatalogs), 0);
      const invalidCatalogs = mod.parseCatalogs(new mod.MixBuffer(Uint8Array.from([0xff, 0xff, 0x41, 0x42, 0x43, 0x44])), 0);

      const dance1 = mod.parseMixBrowser(await fetchBytes("/mix/Dance_eJay1/START.MIX"));
      const dance2 = mod.parseFormatB(new mod.MixBuffer(await fetchBytes(
        await pickProductMixUrl("Dance_eJay2", ["STEP.MIX", "start.mix", "START.MIX"]),
      )));
      const dance3 = mod.parseFormatC(new mod.MixBuffer(await fetchBytes("/mix/Dance_eJay3/start.mix")));
      const hiphop3 = mod.parseMixBrowser(await fetchBytes("/mix/HipHop_eJay3/start.mix"));
      const hiphop4 = mod.parseFormatD(new mod.MixBuffer(await fetchBytes("/mix/HipHop_eJay4/start.mix")));
      const xtreme = mod.parseFormatC(new mod.MixBuffer(await fetchBytes("/mix/Xtreme_eJay/start.mix")));
      const syntheticCBrowser = mod.parseMixBrowser(syntheticCBytes.buffer.slice(0), "Browser_Hint");
      const syntheticC = mod.parseFormatC(new mod.MixBuffer(syntheticCBytes), "Synthetic_Gen3");
      const syntheticDMinimal = mod.parseFormatD(new mod.MixBuffer(syntheticDMinimalBytes));
      const syntheticDRich = mod.parseFormatD(new mod.MixBuffer(syntheticDRichBytes));

      const syntheticMix = mod.parseFormatA(new mod.MixBuffer(syntheticA), "Custom_Gen1");
      const syntheticBoundary = mod.locateGridTrailer(new mod.MixBuffer(syntheticA), formatAHeaderBytes, formatAZeroGap);
      const asciiStrings = mod.extractAsciiStrings(new mod.MixBuffer(Uint8Array.from(asciiBytes("\0\0Dance eJay 1.01\0VOL1\x01ok"))), 4);

      return {
        detect: {
          small: mod.detectFormat(new mod.MixBuffer(new Uint8Array(mod.MIN_FILE_SIZE - 1))),
          formatA: mod.detectFormat(new mod.MixBuffer(buildFormatA(mod.APP_SIG_DANCE1, [{ row: 0, col: 0, id: 42 }]))),
          formatB: mod.detectFormat(new mod.MixBuffer(Uint8Array.from(asciiBytes("xxxx#SKKENNUNG#:1234567xxxx")))),
          formatC: mod.detectFormat(new mod.MixBuffer(Uint8Array.from(asciiBytes("xxxx#SKKENNUNG#:1234567BOOU1_0#\u00b0_#500%\u00b0_%")))),
          formatD: mod.detectFormat(new mod.MixBuffer(Uint8Array.from(asciiBytes("xxxx#SKKENNUNG#:1234567MixVolume1#\u00b0_#500%\u00b0_%")))),
          garbage: mod.detectFormat(new mod.MixBuffer(Uint8Array.from(asciiBytes("abcdefgh")))),
        },
        parseMixNulls: {
          garbage: mod.parseMix(new mod.MixBuffer(Uint8Array.from(asciiBytes("abcdefgh")))),
          truncatedGen23: mod.parseMix(new mod.MixBuffer(Uint8Array.from(asciiBytes("#SKKENNUNG#")))),
          truncatedFormatA: mod.parseMix(new mod.MixBuffer(Uint8Array.from([0x06, 0x0a, 0x00]))),
        },
        mixerKV: mod.parseMixerKV("BOOU1_0#\u00b0_#500%\u00b0_%Empty#\u00b0_#%\u00b0_%BoostEQ_0#\u00b0_#42%\u00b0_%"),
        catalogs: {
          names: parsedCatalogs.catalogs.map((entry: { name: string }) => entry.name),
          endMarker: [...helperCatalogs.slice(parsedCatalogs.endOffset, parsedCatalogs.endOffset + 4)],
          invalidCount: invalidCatalogs.catalogs.length,
          invalidOffset: invalidCatalogs.endOffset,
        },
        syntheticA: {
          product: syntheticMix.product,
          bpm: syntheticMix.bpm,
          trackSummary: syntheticMix.tracks.map((track: { beat: number | null; channel: number | null; sampleRef: { rawId: number } }) => ({
            beat: track.beat,
            channel: track.channel,
            rawId: track.sampleRef.rawId,
          })),
          boundary: syntheticBoundary,
          asciiStrings,
        },
        syntheticCBrowser: {
          format: syntheticCBrowser?.format,
          product: syntheticCBrowser?.product,
        },
        syntheticC: {
          format: syntheticC.format,
          product: syntheticC.product,
          author: syntheticC.author,
          registration: syntheticC.registration,
          bpmAdjusted: syntheticC.bpmAdjusted,
          trackCount: syntheticC.tracks.length,
          firstTrack: syntheticC.tracks[0]
            ? {
                rawId: syntheticC.tracks[0].sampleRef.rawId,
                displayName: syntheticC.tracks[0].sampleRef.displayName,
                dataLength: syntheticC.tracks[0].sampleRef.dataLength,
              }
            : null,
          mixer: {
            channelCount: syntheticC.mixer.channels.length,
            firstChannel: syntheticC.mixer.channels[0] ?? null,
            eq0: syntheticC.mixer.eq[0],
            compressor: syntheticC.mixer.compressor,
            stereoWide: syntheticC.mixer.stereoWide,
            hasVideoMix: Object.prototype.hasOwnProperty.call(syntheticC.mixer.raw, "VideoMix"),
          },
        },
        syntheticDMinimal: {
          format: syntheticDMinimal.format,
          product: syntheticDMinimal.product,
          title: syntheticDMinimal.title,
          author: syntheticDMinimal.author,
          registration: syntheticDMinimal.registration,
          trackCount: syntheticDMinimal.tracks.length,
        },
        syntheticDRich: {
          format: syntheticDRich.format,
          product: syntheticDRich.product,
          title: syntheticDRich.title,
          author: syntheticDRich.author,
          registration: syntheticDRich.registration,
          mixer: {
            firstChannel: syntheticDRich.mixer.channels[0] ?? null,
            eq0: syntheticDRich.mixer.eq[0],
            compressor: syntheticDRich.mixer.compressor,
            stereoWide: syntheticDRich.mixer.stereoWide,
          },
          drumMachine: syntheticDRich.drumMachine
            ? {
                padCount: syntheticDRich.drumMachine.pads.length,
                firstPad: syntheticDRich.drumMachine.pads[0],
                masterVolume: syntheticDRich.drumMachine.masterVolume,
                effects: syntheticDRich.drumMachine.effects,
              }
            : null,
        },
        dance1: {
          format: dance1?.format,
          product: dance1?.product,
          trackCount: dance1?.tracks.length,
          firstTrack: dance1?.tracks[0]?.sampleRef.rawId ?? null,
          mixerChannelCount: dance1?.mixer.channels.length ?? null,
        },
        dance2: {
          format: dance2.format,
          product: dance2.product,
          title: dance2.title,
          author: dance2.author,
          catalogCount: dance2.catalogs.length,
          tickerCount: dance2.tickerText.length,
          firstTrack: dance2.tracks[0]?.sampleRef.internalName ?? null,
        },
        dance3: {
          format: dance3.format,
          product: dance3.product,
          title: dance3.title,
          author: dance3.author,
          trackCount: dance3.tracks.length,
          firstDisplayName: dance3.tracks[0]?.sampleRef.displayName ?? null,
          mixerKeys: Object.keys(dance3.mixer.raw).length,
        },
        hiphop3: {
          format: hiphop3?.format,
          title: hiphop3?.title,
          author: hiphop3?.author,
          trackCount: hiphop3?.tracks.length,
          firstDisplayName: hiphop3?.tracks[0]?.sampleRef.displayName ?? null,
          beatIsNull: hiphop3?.tracks[0]?.beat === null,
          channelIsNull: hiphop3?.tracks[0]?.channel === null,
        },
        hiphop4: {
          format: hiphop4.format,
          product: hiphop4.product,
          title: hiphop4.title,
          author: hiphop4.author,
          trackCount: hiphop4.tracks.length,
          padCount: hiphop4.drumMachine?.pads.length ?? 0,
          firstDisplayName: hiphop4.tracks[0]?.sampleRef.displayName ?? null,
        },
        xtreme: {
          format: xtreme.format,
          product: xtreme.product,
          trackCount: xtreme.tracks.length,
          hasVideoMix: Object.prototype.hasOwnProperty.call(xtreme.mixer.raw, "VideoMix"),
        },
      };
    }, PARSER_MOD);

    expect(result.detect).toEqual({
      small: null,
      formatA: "A",
      formatB: "B",
      formatC: "C",
      formatD: "D",
      garbage: null,
    });
    expect(result.parseMixNulls).toEqual({
      garbage: null,
      truncatedGen23: null,
      truncatedFormatA: null,
    });
    expect(result.mixerKV).toEqual({ BOOU1_0: "500", Empty: "", BoostEQ_0: "42" });
    expect(result.catalogs.names).toEqual(["Dance eJay 2.0", "DanceMachine Samples"]);
    expect(result.catalogs.endMarker).toEqual([0x02, 0x00, 0x00, 0x01]);
    expect(result.catalogs.invalidCount).toBe(0);
    expect(result.catalogs.invalidOffset).toBe(0);
    expect(result.syntheticA.product).toBe("Custom_Gen1");
    expect(result.syntheticA.bpm).toBe(90);
    expect(result.syntheticA.trackSummary).toEqual([
      { beat: 0, channel: 1, rawId: 1231 },
      { beat: 1, channel: 3, rawId: 746 },
    ]);
    expect(result.syntheticA.boundary.gridEnd).toBe(25);
    expect(result.syntheticA.boundary.trailerStart - result.syntheticA.boundary.gridEnd).toBeGreaterThan(32);
    expect(result.syntheticA.asciiStrings).toEqual(["Dance eJay 1.01", "VOL1"]);
    expect(result.syntheticCBrowser).toEqual({ format: "C", product: "Browser_Hint" });
    expect(result.syntheticC).toMatchObject({
      format: "C",
      product: "Synthetic_Gen3",
      author: "Synth Author",
      registration: "REGCODE",
      bpmAdjusted: 130,
      trackCount: 1,
      firstTrack: {
        rawId: 0,
        displayName: "SynthKick",
        dataLength: null,
      },
      mixer: {
        channelCount: 1,
        eq0: 42,
        stereoWide: 44,
        hasVideoMix: false,
      },
    });
    expect(result.syntheticC.mixer.firstChannel).toMatchObject({
      index: 0,
      volume1: 500,
      volume2: 250,
      pan: null,
      eq: 75,
      muted: false,
      solo: false,
    });
    expect(result.syntheticC.mixer.compressor).toMatchObject({
      drive: 11,
      gain: 22,
      speed: 33,
      enabled: true,
    });
    expect(result.syntheticDMinimal).toEqual({
      format: "D",
      product: "HipHop_eJay4",
      title: null,
      author: null,
      registration: null,
      trackCount: 0,
    });
    expect(result.syntheticDRich).toMatchObject({
      format: "D",
      product: "HipHop_eJay4",
      title: "Synthetic D",
      author: "Late Author",
      registration: "LATE",
    });
    expect(result.syntheticDRich.mixer.firstChannel).toMatchObject({
      index: 0,
      volume1: 400,
      volume2: null,
      pan: 60,
      eq: null,
      muted: true,
      solo: true,
    });
    expect(result.syntheticDRich.mixer.eq0).toBe(70);
    expect(result.syntheticDRich.mixer.compressor).toMatchObject({
      drive: 3,
      gain: 4,
      speed: 5,
      enabled: true,
    });
    expect(result.syntheticDRich.mixer.stereoWide).toBe(55);
    expect(result.syntheticDRich.drumMachine).toMatchObject({
      padCount: 1,
      masterVolume: 650,
      firstPad: {
        index: 1,
        name: "Kick",
        volume: 600,
        pan: 40,
        pitch: 2,
        reversed: true,
        fx: "wet",
      },
    });
    expect(result.syntheticDRich.drumMachine).not.toBeNull();
    expect(result.syntheticDRich.drumMachine?.effects).toMatchObject({
      chorus: { enabled: true },
      echo: { enabled: true },
      eq: { enabled: true },
      overdrive: { enabled: true },
      reverb: { enabled: true },
    });
    expect(result.dance1).toMatchObject({
      format: "A",
      product: "Dance_eJay1",
      firstTrack: 1186,
      mixerChannelCount: 0,
    });
    expect(result.dance1.trackCount).toBeGreaterThan(150);
    expect(result.dance2).toMatchObject({
      format: "B",
      title: "Duck Dance",
      author: "MC Magic",
      firstTrack: "humn.9",
    });
    expect(result.dance2.catalogCount).toBeGreaterThan(5);
    expect(result.dance2.tickerCount).toBeGreaterThan(10);
    expect(result.dance3).toMatchObject({
      format: "C",
      title: "Dance eJay 3 Demo Mix",
      author: "marc",
      firstDisplayName: "kick12",
    });
    expect(result.dance3.trackCount).toBeGreaterThan(10);
    expect(result.dance3.mixerKeys).toBeGreaterThan(50);
    expect(result.hiphop3).toMatchObject({
      format: "C",
      title: "-",
      author: "-",
      trackCount: 16,
      firstDisplayName: "Kick90",
      beatIsNull: true,
      channelIsNull: true,
    });
    expect(result.hiphop4).toMatchObject({
      format: "D",
      title: "nothingbutCRAP",
      author: "laborda-gonzales",
      firstDisplayName: null,
    });
    expect(result.hiphop4.trackCount).toBe(16);
    expect(result.hiphop4.padCount).toBe(16);
    expect(result.xtreme).toEqual({
      format: "C",
      product: result.xtreme.product,
      trackCount: 0,
      hasVideoMix: false,
    });
  });

  test("mix-player executes playback-plan, graph, and fetch helper paths in the browser", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

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
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

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
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

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
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

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

  test("main covers mix selection failure, playback caching, and cleanup branches", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);

      const asciiBytes = (value: string): number[] => [...value].map((char) => char.charCodeAt(0));
      const buildFormatA = (appSig: number, cells: Array<{ row: number; col: number; id: number }>): Uint8Array => {
        const headerBytes = 4;
        const rowBytes = 16;
        const cellBytes = 2;
        const maxRow = cells.reduce((highest, cell) => Math.max(highest, cell.row), 0);
        const bytes = new Uint8Array(headerBytes + ((maxRow + 1) * rowBytes));
        const view = new DataView(bytes.buffer);
        view.setUint16(0, appSig, true);
        for (const cell of cells) {
          const offset = headerBytes + (cell.row * rowBytes) + (cell.col * cellBytes);
          view.setUint16(offset, cell.id, true);
        }
        return bytes;
      };

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      let audioFetchCount = 0;
      let closedContexts = 0;
      let samplePlayCalls = 0;
      const originalFetch = globalThis.fetch;
      const originalMediaPlay = HTMLMediaElement.prototype.play;
      const originalMediaPause = HTMLMediaElement.prototype.pause;

      class FakeAudioContext {
        sampleRate = 44100;
        currentTime = 1;
        state: "running" | "suspended" | "closed" = "running";
        destination = { connect: () => {}, disconnect: () => {} };

        async resume(): Promise<void> {
          this.state = "running";
        }

        async close(): Promise<void> {
          this.state = "closed";
          closedContexts += 1;
        }

        createGain() {
          return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
        }

        createStereoPanner() {
          return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} };
        }

        createBufferSource() {
          return {
            buffer: null,
            playbackRate: { value: 1 },
            connect: () => {},
            disconnect: () => {},
            start: () => {},
            stop: () => {},
          };
        }

        decodeAudioData(data: ArrayBuffer): Promise<unknown> {
          return Promise.resolve({ decodedBytes: data.byteLength });
        }
      }

      (window as typeof window & { AudioContext: typeof AudioContext }).AudioContext = FakeAudioContext as unknown as typeof AudioContext;
      HTMLMediaElement.prototype.play = function () {
        samplePlayCalls += 1;
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {};

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [
            {
              id: "_userdata/sets",
              name: "User: sets",
              mixes: [
                { filename: "BAD.MIX", sizeBytes: 4, format: "A" },
                { filename: "GOOD.MIX", sizeBytes: 36, format: "A" },
              ],
            },
          ],
          sampleIndex: {
            Dance_eJay1: {
              byAlias: {},
              bySource: {},
              byStem: {},
              byInternalName: {},
              bySampleId: {},
              byGen1Id: { "42": "Drum/kick.wav", "300": "Drum/kick.wav" },
            },
          },
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 }];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }] };
      };

      library.FetchLibrary.prototype.dispose = function () {};

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/mix/_userdata%2Fsets/BAD.MIX")) {
          return new Response(Uint8Array.from(asciiBytes("junk")), { status: 200 });
        }
        if (url.endsWith("/mix/_userdata%2Fsets/GOOD.MIX")) {
          return new Response(buildFormatA(0x0a06, [
            { row: 0, col: 0, id: 42 },
            { row: 2, col: 0, id: 300 },
          ]) as unknown as BodyInit, { status: 200 });
        }
        if (url.endsWith("output/Drum/kick.wav")) {
          audioFetchCount += 1;
          return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
        }
        return originalFetch(input, init);
      };

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      document.querySelector<HTMLElement>(".archive-sidebar")?.click();
      await waitFor(() => document.querySelectorAll(".mix-tree-item").length === 2);

      const items = [...document.querySelectorAll<HTMLButtonElement>(".mix-tree-item")];
      const bad = items.find((item) => item.textContent?.includes("BAD.MIX"));
      const good = items.find((item) => item.textContent?.includes("GOOD.MIX"));
      if (!bad || !good) {
        throw new Error("Expected mix tree items were not rendered");
      }

      bad.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => (document.getElementById("error-toast")?.textContent ?? "").includes("Could not load selected .mix file."));
      const sawBadMixErrorToast = true;

      good.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => (document.querySelector<HTMLElement>(".context-mix-name")?.textContent ?? "").includes("GOOD"));
      await waitFor(() => document.querySelectorAll(".sequencer-event").length === 2);
      await waitFor(() => document.querySelectorAll(".sequencer-beat-number").length >= 3);

      const home = document.querySelector<HTMLButtonElement>(".seq-home-btn");
      const play = document.querySelector<HTMLButtonElement>(".seq-play-btn");
      const stop = document.querySelector<HTMLButtonElement>(".seq-stop-btn");
      if (!home || !play || !stop) {
        throw new Error("Missing transport buttons");
      }

      const lane = document.querySelector<HTMLElement>(".sequencer-lane");
      const events = [...document.querySelectorAll<HTMLElement>(".sequencer-event")];
      if (!lane || events.length < 2) {
        throw new Error("Expected sequencer lane and bubbles");
      }

      await waitFor(() => play.disabled === false);

      const laneRect = lane.getBoundingClientRect();
      lane.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: laneRect.left + 160 + 48 + 4,
        clientY: laneRect.top + (laneRect.height / 2),
      }));
      await waitFor(() => /^Bar\s+2\s+\//.test(document.querySelector<HTMLElement>(".seq-position")?.textContent ?? ""));
      await waitFor(() => stop.disabled === false);

      home.click();
      await waitFor(() => /^Bar\s+1\s+\//.test(document.querySelector<HTMLElement>(".seq-position")?.textContent ?? ""));

      events[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => stop.disabled === true);
      await waitFor(() => samplePlayCalls > 0);

      events[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => /^Bar\s+3\s+\//.test(document.querySelector<HTMLElement>(".seq-position")?.textContent ?? ""));

      await waitFor(() => stop.disabled === false);
      await waitFor(() => stop.disabled === true, 260);

      home.click();
      await waitFor(() => /^Bar\s+1\s+\//.test(document.querySelector<HTMLElement>(".seq-position")?.textContent ?? ""));

      window.dispatchEvent(new Event("beforeunload"));
      await flush();

      HTMLMediaElement.prototype.play = originalMediaPlay;
      HTMLMediaElement.prototype.pause = originalMediaPause;
      globalThis.fetch = originalFetch;

      return {
        mixName: document.querySelector<HTMLElement>(".context-mix-name")?.textContent ?? "",
        sawBadMixErrorToast,
        beatCount: document.querySelectorAll(".sequencer-beat-number").length,
        eventCount: document.querySelectorAll(".sequencer-event").length,
        audioFetchCount,
        closedContexts,
        samplePlayCalls,
      };
    }, "/src/library.ts");

    expect(result.mixName).toContain("GOOD");
    expect(result.sawBadMixErrorToast).toBe(true);
    expect(result.beatCount).toBeGreaterThan(0);
    expect(result.eventCount).toBe(2);
    expect(result.audioFetchCount).toBe(1);
    expect(result.closedContexts).toBe(1);
    expect(result.samplePlayCalls).toBeGreaterThan(0);
  });

  test("main covers empty mixes and no-WebAudio playback warnings", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);

      const buildFormatA = (appSig: number, cells: Array<{ row: number; col: number; id: number }>): Uint8Array => {
        const headerBytes = 4;
        const rowBytes = 16;
        const cellBytes = 2;
        const maxRow = cells.reduce((highest, cell) => Math.max(highest, cell.row), 0);
        const bytes = new Uint8Array(headerBytes + ((maxRow + 1) * rowBytes));
        const view = new DataView(bytes.buffer);
        view.setUint16(0, appSig, true);
        for (const cell of cells) {
          const offset = headerBytes + (cell.row * rowBytes) + (cell.col * cellBytes);
          view.setUint16(offset, cell.id, true);
        }
        return bytes;
      };

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [
            {
              id: "Dance_eJay1",
              name: "Dance eJay 1",
              mixes: [
                { filename: "EMPTY.MIX", sizeBytes: 4, format: "A" },
                { filename: "NOWEB.MIX", sizeBytes: 20, format: "A" },
              ],
            },
          ],
          sampleIndex: {
            Dance_eJay1: {
              byAlias: {},
              bySource: {},
              byStem: {},
              byInternalName: {},
              bySampleId: {},
              byGen1Id: { "300": "Drum/kick.wav" },
            },
          },
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 }];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }] };
      };

      library.FetchLibrary.prototype.dispose = function () {};

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/mix/Dance_eJay1/EMPTY.MIX")) {
          return new Response(Uint8Array.from([0x06, 0x0a, 0x00, 0x00]), { status: 200 });
        }
        if (url.endsWith("/mix/Dance_eJay1/NOWEB.MIX")) {
          return new Response(buildFormatA(0x0a06, [{ row: 0, col: 0, id: 300 }]) as unknown as BodyInit, { status: 200 });
        }
        return originalFetch(input, init);
      };

      delete (window as Window & { AudioContext?: typeof AudioContext }).AudioContext;
      delete (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      document.querySelector<HTMLElement>(".archive-sidebar")?.click();
      await waitFor(() => document.querySelectorAll(".mix-tree-item").length === 2);

      const items = [...document.querySelectorAll<HTMLButtonElement>(".mix-tree-item")];
      const empty = items.find((item) => item.textContent?.includes("EMPTY.MIX"));
      const noWeb = items.find((item) => item.textContent?.includes("NOWEB.MIX"));
      if (!empty || !noWeb) {
        throw new Error("Expected mix tree items were not rendered");
      }

      empty.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => (document.querySelector<HTMLElement>(".sequencer-placeholder")?.textContent ?? "").includes("Parsed successfully"));

      const play = document.querySelector<HTMLButtonElement>(".seq-play-btn");
      const stop = document.querySelector<HTMLButtonElement>(".seq-stop-btn");
      if (!play || !stop) {
        throw new Error("Missing transport buttons");
      }
      const emptyPlaceholder = document.querySelector<HTMLElement>(".sequencer-placeholder")?.textContent ?? "";
      const emptyPlayDisabled = play.disabled;

      noWeb.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => (document.querySelector<HTMLElement>(".context-mix-name")?.textContent ?? "").includes("NOWEB"));
      await waitFor(() => play.disabled === false);

      play.click();
      await waitFor(() => stop.disabled === false);
      await waitFor(() => (document.getElementById("error-toast")?.textContent ?? "").includes("Starting timeline playback without resolved audio"));
      stop.click();
      await waitFor(() => stop.disabled === true);

      globalThis.fetch = originalFetch;

      return {
        emptyPlaceholder,
        emptyPlayDisabled,
        finalToast: document.getElementById("error-toast")?.textContent ?? "",
        beatCount: document.querySelectorAll(".sequencer-beat-number").length,
      };
    }, "/src/library.ts");

    expect(result.emptyPlaceholder).toContain("Parsed successfully");
    expect(result.emptyPlayDisabled).toBe(true);
    expect(result.finalToast).toContain("Starting timeline playback without resolved audio");
    expect(result.beatCount).toBeGreaterThan(0);
  });

  test("main covers partial decode failures while playable events continue", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);

      const buildFormatA = (appSig: number, cells: Array<{ row: number; col: number; id: number }>): Uint8Array => {
        const headerBytes = 4;
        const rowBytes = 16;
        const cellBytes = 2;
        const maxRow = cells.reduce((highest, cell) => Math.max(highest, cell.row), 0);
        const bytes = new Uint8Array(headerBytes + ((maxRow + 1) * rowBytes));
        const view = new DataView(bytes.buffer);
        view.setUint16(0, appSig, true);
        for (const cell of cells) {
          const offset = headerBytes + (cell.row * rowBytes) + (cell.col * cellBytes);
          view.setUint16(offset, cell.id, true);
        }
        return bytes;
      };

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      let audioFetchCount = 0;
      const originalFetch = globalThis.fetch;

      class FakeAudioContext {
        sampleRate = 44100;
        currentTime = 1;
        state: "running" | "suspended" | "closed" = "running";
        destination = { connect: () => {}, disconnect: () => {} };

        async resume(): Promise<void> {
          this.state = "running";
        }

        async close(): Promise<void> {
          this.state = "closed";
        }

        createGain() {
          return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
        }

        createStereoPanner() {
          return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} };
        }

        createBufferSource() {
          return {
            buffer: null,
            playbackRate: { value: 1 },
            connect: () => {},
            disconnect: () => {},
            start: () => {},
            stop: () => {},
          };
        }

        decodeAudioData(data: ArrayBuffer): Promise<unknown> {
          return Promise.resolve({ decodedBytes: data.byteLength });
        }
      }

      (window as typeof window & { AudioContext: typeof AudioContext }).AudioContext = FakeAudioContext as unknown as typeof AudioContext;

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [
            {
              id: "Dance_eJay1",
              name: "Dance eJay 1",
              mixes: [{ filename: "PARTIAL.MIX", sizeBytes: 36, format: "A" }],
            },
          ],
          sampleIndex: {
            Dance_eJay1: {
              byAlias: {},
              bySource: {},
              byStem: {},
              byInternalName: {},
              bySampleId: {},
              byGen1Id: { "42": "Drum/good.wav", "300": "Drum/bad.wav" },
            },
          },
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 }];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }] };
      };

      library.FetchLibrary.prototype.dispose = function () {};

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/mix/Dance_eJay1/PARTIAL.MIX")) {
          return new Response(buildFormatA(0x0a06, [
            { row: 0, col: 0, id: 42 },
            { row: 1, col: 0, id: 300 },
          ]) as unknown as BodyInit, { status: 200 });
        }
        if (url.endsWith("output/Drum/good.wav")) {
          audioFetchCount += 1;
          return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
        }
        if (url.endsWith("output/Drum/bad.wav")) {
          audioFetchCount += 1;
          return new Response(Uint8Array.from([9, 9, 9]), { status: 500 });
        }
        return originalFetch(input, init);
      };

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      document.querySelector<HTMLElement>(".archive-sidebar")?.click();
      await waitFor(() => document.querySelectorAll(".mix-tree-item").length === 1);

      const mixButton = document.querySelector<HTMLButtonElement>(".mix-tree-item");
      const play = document.querySelector<HTMLButtonElement>(".seq-play-btn");
      const stop = document.querySelector<HTMLButtonElement>(".seq-stop-btn");
      if (!mixButton || !play || !stop) {
        throw new Error("Missing mix tree or transport buttons");
      }

      mixButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(() => (document.querySelector<HTMLElement>(".context-mix-name")?.textContent ?? "").includes("PARTIAL"));
      await waitFor(() => document.querySelectorAll(".sequencer-event").length === 2);

      await waitFor(() => play.disabled === false);

      play.click();
      await waitFor(() => stop.disabled === false);
      stop.click();
      await waitFor(() => stop.disabled === true);

      globalThis.fetch = originalFetch;

      return {
        audioFetchCount,
        missingEventCount: document.querySelectorAll(".sequencer-event.is-missing").length,
        transportLabel: document.querySelector<HTMLElement>(".seq-position")?.textContent ?? "",
      };
    }, "/src/library.ts");

    // Preload fetches both samples at selection time, then playback retries the
    // failed decode path once more for the unresolved URL.
    expect(result.audioFetchCount).toBe(3);
    expect(result.missingEventCount).toBe(0);
    expect(result.transportLabel).toMatch(/ready|Loading samples/i);
  });

  test("main covers tab selection and watcher refresh no-op and error branches", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);
      // @ts-expect-error Vite serves /src/data.ts during page-eval tests; not resolvable by tsc.
      const data = await import(/* @vite-ignore */ "/src/data.ts");

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      let loadSamplesCalls = 0;
      let loadCategoryConfigCalls = 0;
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0] ?? ""));
      };

      const stableConfig = {
        categories: [
          { id: "Drum", name: "Drum", subcategories: ["kick", "snare"] },
          { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
        ],
      };

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "snare"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
          sampleIndex: {},
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function (options?: { force?: boolean }) {
        loadSamplesCalls += 1;
        if (options?.force) {
          throw new Error("forced refresh failed");
        }
        return [
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 },
          { filename: "snare.wav", alias: "Snare", category: "Drum", subcategory: "snare", bpm: 120, beats: 1 },
          { filename: "bass.wav", alias: "Bass", category: "Bass", subcategory: "unsorted", bpm: 120, beats: 1 },
        ];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        loadCategoryConfigCalls += 1;
        return stableConfig;
      };

      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => document.querySelectorAll(".category-btn").length >= 2);

      const loadJsonButton = document.querySelector<HTMLButtonElement>(".load-json-btn");
      loadJsonButton?.click();

      const snareTab = [...document.querySelectorAll<HTMLButtonElement>(".subcategory-tab")]
        .find((button) => (button.textContent ?? "").includes("snare"));
      if (!snareTab) {
        throw new Error("Missing snare tab");
      }
      snareTab.click();

      await waitFor(() => document.querySelector<HTMLButtonElement>(".subcategory-tab.is-active")?.textContent?.includes("snare") ?? false);
      await waitFor(() => document.querySelectorAll("#sample-grid button").length === 1);

      window.dispatchEvent(new Event(data.CATEGORY_CONFIG_UPDATED_EVENT));
      window.dispatchEvent(new Event(data.SAMPLE_METADATA_UPDATED_EVENT));
      await waitFor(() => loadCategoryConfigCalls > 1);
      await waitFor(() => warnings.some((entry) => entry.includes("Failed to refresh sample metadata.")));

      console.warn = originalWarn;

      return {
        activeTab: document.querySelector<HTMLButtonElement>(".subcategory-tab.is-active")?.textContent ?? "",
        visibleSamples: [...document.querySelectorAll<HTMLElement>("#sample-grid button")].map((node) => node.textContent ?? ""),
        loadSamplesCalls,
        loadCategoryConfigCalls,
        warnings,
      };
    }, "/src/library.ts");

    expect(result.activeTab).toContain("snare");
    expect(result.visibleSamples).toHaveLength(1);
    expect(result.visibleSamples[0]).toContain("Snare");
    expect(result.loadSamplesCalls).toBeGreaterThan(1);
    expect(result.loadCategoryConfigCalls).toBeGreaterThan(1);
    expect(result.warnings).toContain("Failed to refresh sample metadata.");
  });

  test("main covers the empty-library branch when no categories are available", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [],
          mixLibrary: [],
          sampleIndex: {},
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [] };
      };

      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => (document.querySelector<HTMLElement>(".sample-grid-empty")?.textContent ?? "").includes("No categories found in this library."));

      return {
        emptyMessage: document.querySelector<HTMLElement>(".sample-grid-empty")?.textContent ?? "",
        categoryButtons: document.querySelectorAll(".category-btn").length,
        activeCategoryButtons: document.querySelectorAll(".category-btn.is-active").length,
      };
    }, "/src/library.ts");

    expect(result.emptyMessage).toContain("No categories found in this library.");
    expect(result.categoryButtons).toBe(0);
    expect(result.activeCategoryButtons).toBe(0);
  });

  test("main covers sample playback state transitions through the app shell", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 4;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          this.paused = false;
          return Promise.resolve();
        }
        pause(): void {
          this.paused = true;
        }
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [],
          sampleIndex: {},
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 }];
      };

      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }] };
      };

      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };

      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => document.querySelectorAll(".sample-block").length === 1);

      const block = document.querySelector<HTMLElement>(".sample-block");
      if (!block) {
        throw new Error("Missing sample block");
      }
      block.click();

      await waitFor(() => (document.getElementById("transport-name")?.textContent ?? "") === "kick");
      await waitFor(() => document.querySelector<HTMLElement>(".sample-block.is-playing") !== null);

      return {
        transportName: document.getElementById("transport-name")?.textContent ?? "",
        playingBlocks: document.querySelectorAll(".sample-block.is-playing").length,
        progressValue: Number((document.getElementById("transport-progress") as HTMLProgressElement | null)?.value ?? 0),
      };
    }, "/src/library.ts");

    expect(result.transportName).toBe("kick");
    expect(result.playingBlocks).toBe(1);
    expect(result.progressValue).toBeGreaterThanOrEqual(0);
  });

  test("main covers exact-path startup when loadCategoryConfig is unavailable", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (libraryModPath) => {
      const library = await import(/* @vite-ignore */ libraryModPath);
      // @ts-expect-error Vite serves /src/data.ts during page-eval tests; not resolvable by tsc.
      const data = await import(/* @vite-ignore */ "/src/data.ts");

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitFor = async (predicate: () => boolean, attempts = 40): Promise<void> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return;
          await flush();
        }
        throw new Error("Timed out waiting for predicate");
      };

      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [],
          sampleIndex: {},
        };
      };

      library.FetchLibrary.prototype.loadSamples = async function () {
        return [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 120, beats: 1 }];
      };

      delete (library.FetchLibrary.prototype as { loadCategoryConfig?: unknown }).loadCategoryConfig;
      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => document.querySelectorAll(".category-btn").length > 0);

      window.dispatchEvent(new Event(data.CATEGORY_CONFIG_UPDATED_EVENT));
      await flush();

      return {
        activeCategory: document.querySelector<HTMLElement>(".category-btn.is-active")?.textContent ?? "",
        addButtonDisabled: document.getElementById("subcategory-add") instanceof HTMLButtonElement
          ? (document.getElementById("subcategory-add") as HTMLButtonElement).disabled
          : null,
      };
    }, "/src/library.ts");

    expect(result.activeCategory).toContain("Drum");
    expect(typeof result.addButtonDisabled).toBe("boolean");
  });

  test("main covers shell splitter keyboard and pointer branches", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const splitter = page.locator(".shell-splitter");
    await expect(splitter).toBeVisible();

    await splitter.focus();
    await splitter.press("ArrowDown");
    await splitter.press("ArrowUp");
    await splitter.press("PageDown");
    await splitter.press("PageUp");
    await splitter.press("Home");
    await splitter.press("End");
    await splitter.press("Enter");

    await splitter.dispatchEvent("pointerdown", { button: 2, clientY: 260 });

    const box = await splitter.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const centerX = box.x + (box.width / 2);
      const centerY = box.y + (box.height / 2);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX, centerY + 24);
      await page.mouse.up();
    }

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.setViewportSize({ width: viewport.width - 24, height: viewport.height - 16 });
    await page.setViewportSize(viewport);

    const result = await splitter.evaluate((node) => {
      const element = node as HTMLElement;
      const shell = element.closest(".spa-shell") as HTMLElement | null;
      return {
        ariaValueNow: element.getAttribute("aria-valuenow"),
        isDragging: element.classList.contains("is-dragging"),
        editorHeight: shell?.style.getPropertyValue("--shell-editor-height") ?? "",
      };
    });

    expect(result.ariaValueNow).not.toBeNull();
    expect(result.isDragging).toBe(false);
    expect(result.editorHeight).toMatch(/\d+px/);
  });

  test("mix-file-browser covers GenerationPack and userdata label branches", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (sidebar.querySelector(".mix-tree-group-label") || sidebar.querySelector(".archive-tree-empty")) {
            return;
          }
          await flush();
        }
      };

      const makeFileHandle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        async getFile() {
          return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
        },
      });

      const makeDirHandle = (name: string, children: Record<string, unknown>) => ({
        kind: "directory",
        name,
        async *entries() {
          for (const [childName, handle] of Object.entries(children)) {
            yield [childName, handle];
          }
        },
      });

      const archiveRoot = makeDirHandle("archive", {
        Dance_SuperPack: makeDirHandle("Dance_SuperPack", {
          MIX: makeDirHandle("MIX", {
            "start.mix": makeFileHandle("start.mix", [0x06, 0x0a, 0x00, 0x00]),
          }),
        }),
        GenerationPack1: makeDirHandle("GenerationPack1", {
          Dance: makeDirHandle("Dance", {
            MIX: makeDirHandle("MIX", {
              "gp1.mix": makeFileHandle("gp1.mix", [0x06, 0x0a, 0x00, 0x00]),
            }),
          }),
        }),
        _userdata: makeDirHandle("_userdata", {
          _DMKIT2: makeDirHandle("_DMKIT2", {
            "user.mix": makeFileHandle("user.mix", [0x07, 0x0a, 0x00, 0x00]),
          }),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => archiveRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-coverage" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-coverage")!;
      initMixFileBrowser(sidebar, { isDev: false, onSelectFile: () => {} });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        secondGroupHidden: sidebar.querySelectorAll<HTMLElement>(".mix-tree-items")[1]?.hidden ?? null,
      };
    }, MIX_FILE_BROWSER_MOD);

    expect(result.groupLabels).toEqual([
      "Dance SuperPack",
      "GenerationPack1 Dance",
      "User: DMKIT2",
    ]);
    expect(result.secondGroupHidden).toBe(true);
  });

  test("mix-file-browser covers unprefixed root grouping and repeated group accumulation", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (sidebar.querySelector(".mix-tree-group-label") || sidebar.querySelector(".archive-tree-empty")) {
            return;
          }
          await flush();
        }
      };

      const makeFileHandle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        async getFile() {
          return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
        },
      });

      const makeDirHandle = (name: string, children: Record<string, unknown>) => ({
        kind: "directory",
        name,
        async *entries() {
          for (const [childName, handle] of Object.entries(children)) {
            yield [childName, handle];
          }
        },
      });

      const customRoot = makeDirHandle("custom-root", {
        alpha: makeDirHandle("alpha", {
          "one.mix": makeFileHandle("one.mix", [0x06, 0x0a, 0x00, 0x00]),
          "two.mix": makeFileHandle("two.mix", [0x07, 0x0a, 0x00, 0x00]),
        }),
        beta: makeDirHandle("beta", {
          "three.mix": makeFileHandle("three.mix", [0x08, 0x0a, 0x00, 0x00]),
        }),
      });

      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => customRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-custom" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-custom")!;
      initMixFileBrowser(sidebar, { isDev: false, onSelectFile: () => {} });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        counts: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-count")].map((node) => node.textContent ?? ""),
      };
    }, MIX_FILE_BROWSER_MOD);

    expect(result.groupLabels).toEqual(["alpha", "beta"]);
    expect(result.counts).toEqual(["2", "1"]);
  });
});