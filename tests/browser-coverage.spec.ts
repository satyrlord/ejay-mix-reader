import { test, expect } from "./baseFixtures.js";

test.describe("browser coverage gap", () => {
  const BUFFER_MOD = "/src/mix-buffer.ts";
  const PARSER_MOD = "/src/mix-parser.ts";
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
      const formatAHeaderBytes = 4;
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
      const dance2 = mod.parseFormatB(new mod.MixBuffer(await fetchBytes("/mix/Dance_eJay2/STEP.MIX")));
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
    expect(result.syntheticA.boundary.gridEnd).toBe(27);
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
        rawId: 23,
        displayName: "SynthKick",
        dataLength: 4096,
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

      (window as typeof window & { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => archiveRoot;

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

      (window as typeof window & { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => customRoot;

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