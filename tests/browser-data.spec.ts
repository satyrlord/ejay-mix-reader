import { test, expect } from "./baseFixtures.js";
import { openHomeAndWaitForNetworkIdle } from "./playwright-test-helpers.js";

test.describe("data module edge cases", () => {
  const DATA_MOD = "/src/data.ts";

  test("sample helpers normalize category, labels, and paths", async ({ page }) => {
    await openHomeAndWaitForNetworkIdle(page);
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      return {
        category: mod.sampleCategory({ category: "Bass" }),
        fallbackCategory: mod.sampleCategory({}),
        subcategory: mod.sampleSubcategory({ subcategory: " kick " }),
        noSubcategory: mod.sampleSubcategory({}),
        aliasName: mod.sampleDisplayName({ filename: "Bass/BS001.wav", alias: "Deep Tone" }),
        filenameName: mod.sampleDisplayName({ filename: "Bass/BS001.wav" }),
        pathWithSub: mod.sampleAudioPath({ filename: "BS001.wav", category: "Bass", subcategory: "synth" }),
        pathNested: mod.sampleAudioPath({ filename: "layer/BS001.wav", category: "Pads" }),
      };
    }, DATA_MOD);

    expect(result.category).toBe("Bass");
    expect(result.fallbackCategory).toBe("Unsorted");
    expect(result.subcategory).toBe("kick");
    expect(result.noSubcategory).toBeNull();
    expect(result.aliasName).toBe("Deep Tone");
    expect(result.filenameName).toBe("BS001");
    expect(result.pathWithSub).toBe("output/Bass/synth/BS001.wav");
    expect(result.pathNested).toBe("output/Pads/layer/BS001.wav");
  });

  test("buildCategoryEntries keeps canonical order and known subcategories", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const categories = mod.buildCategoryEntries([
        { filename: "kick.wav", category: "Drum", subcategory: "kick" },
        { filename: "vox.wav", category: "Voice", subcategory: "misc" },
        { filename: "bass.wav", category: "Bass" },
        { filename: "mystery.wav", category: "Custom", subcategory: "alpha" },
      ]);

      return {
        ids: categories.map((entry: { id: string }) => entry.id).slice(0, 4),
        drum: categories.find((entry: { id: string }) => entry.id === "Drum"),
        voice: categories.find((entry: { id: string }) => entry.id === "Voice"),
        bass: categories.find((entry: { id: string }) => entry.id === "Bass"),
        hasCustom: categories.some((entry: { id: string }) => entry.id === "Custom"),
      };
    }, DATA_MOD);

    expect(result.ids).toEqual(["Loop", "Drum", "Bass", "Guitar"]);
    expect(result.drum.sampleCount).toBe(1);
    expect(result.drum.subcategories).toEqual([
      "kick",
      "snare",
      "clap",
      "toms",
      "crash",
      "hi-hats",
      "perc",
      "misc",
    ]);
    expect(result.voice.subcategories).toEqual([
      "rap male",
      "rap female",
      "sing male",
      "sing female",
      "robot",
      "misc",
    ]);
    expect(result.bass.subcategories).toEqual(["unsorted"]);
    expect(result.hasCustom).toBe(false);
  });

  test("category config helpers normalize and extend subcategories", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const config = mod.normalizeCategoryConfig({
        categories: [
          { id: "Bass", name: "Bass", subcategories: [" deep  ", "DEEP"] },
        ],
      });
      const nextConfig = mod.addSubcategoryToCategoryConfig(config, "Bass", "  warm pad  ");
      const removedConfig = mod.removeSubcategoryFromCategoryConfig({
        categories: [{ id: "Loop", name: "Loop", subcategories: ["fills", "breaks"] }],
      }, "Loop", "fills");
      const categories = mod.buildCategoryEntries([
        { filename: "tone.wav", category: "Bass" },
      ], nextConfig.categories);

      return {
        subcategories: nextConfig.categories[0]?.subcategories ?? [],
        sampleCount: categories.find((entry: { id: string }) => entry.id === "Bass")?.sampleCount ?? 0,
        kinds: {
          drumMisc: mod.getSubcategoryKind("Drum", "misc"),
          drumKick: mod.getSubcategoryKind("Drum", "kick"),
          loopFills: mod.getSubcategoryKind("Loop", "fills"),
        },
        removedSubcategories: removedConfig.categories[0]?.subcategories ?? [],
      };
    }, DATA_MOD);

    expect(result.subcategories).toEqual(["deep", "warm pad"]);
    expect(result.sampleCount).toBe(1);
    expect(result.kinds).toEqual({
      drumMisc: "special",
      drumKick: "system",
      loopFills: "user",
    });
    expect(result.removedSubcategories).toEqual(["breaks"]);
  });

  test("filterSamples and sortSamplesForGrid respect the normalized browser view", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const samples = [
        { filename: "A.wav", alias: "Alpha", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 8 },
        { filename: "B.wav", alias: "Bravo", category: "Bass", product: "Rave", bpm: 140, beats: 16 },
        { filename: "C.wav", alias: "Charlie", category: "Bass", product: "Rave", bpm: 125, beats: 4 },
        { filename: "D.wav", alias: "Delta", category: "Drum", subcategory: "kick", bpm: 140, beats: 2 },
        { filename: "E.wav", alias: "Echo", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 0 },
        { filename: "F.wav", alias: "Foxtrot", category: "Bass", product: "Dance_eJay1", bpm: 140 },
        { filename: "G.wav", alias: "Ghost", category: "Voice", subcategory: "misc", bpm: 140, beats: 4 },
        { filename: "H.wav", alias: "Hotel", category: "Voice", bpm: 140, beats: 4 },
        { filename: "I.wav", alias: "India", category: "Voice", subcategory: "sing male", bpm: 140, beats: 4 },
      ];

      return {
        byCategory: mod.filterSamples(samples, { category: "Bass", bpm: 140 }).length,
        byProduct: mod.filterSamples(samples, { category: "Bass", product: "Rave", bpm: 140 }).map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        bySubcategory: mod.filterSamples(samples, { category: "Drum", subcategory: "kick", bpm: 140 }).length,
        miscBucket: mod.filterSamples(samples, { category: "Voice", subcategory: "misc", bpm: 140 }).map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        unsortedBucket: mod.filterSamples(samples, { category: "Bass", subcategory: "unsorted", bpm: 140 }).map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        sorted: mod.sortSamplesForGrid(samples.filter((sample: { category: string }) => sample.category === "Bass")).map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        // One-shots (beats=0 or missing) must pass through regardless of BPM
        oneShotBeats0AtWrongBpm: mod.filterSamples(samples, { category: "Bass", bpm: 125 }).map((s: { alias?: string; filename: string }) => mod.sampleDisplayName(s)),
        oneShotNoBeatsMixed: mod.filterSamples(samples, { category: "Bass", bpm: 90 }).map((s: { alias?: string; filename: string }) => mod.sampleDisplayName(s)),
      };
    }, DATA_MOD);

    expect(result.byCategory).toBe(4);
    expect(result.byProduct).toEqual(["Bravo"]);
    expect(result.bySubcategory).toBe(1);
    expect(result.miscBucket).toEqual(["Ghost", "Hotel"]);
    expect(result.unsortedBucket).toEqual(["Alpha", "Bravo", "Echo", "Foxtrot"]);
    expect(result.sorted).toEqual(["Bravo", "Alpha", "Charlie", "Echo", "Foxtrot"]);
    // One-shots bypass BPM filtering: beats=0 and missing-beats samples always show
    expect(result.oneShotBeats0AtWrongBpm).toContain("Echo");
    expect(result.oneShotBeats0AtWrongBpm).toContain("Foxtrot");
    expect(result.oneShotBeats0AtWrongBpm).toContain("Charlie"); // normal 125 BPM match
    expect(result.oneShotBeats0AtWrongBpm).not.toContain("Alpha"); // 140 BPM loop filtered out
    expect(result.oneShotNoBeatsMixed).toEqual(["Echo", "Foxtrot"]); // only one-shots at unmatched BPM 90
  });

  test("data helpers normalize products and reject unsafe paths", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      let invalidCategory = "";
      let invalidFilename = "";

      try {
        mod.sampleAudioPath({ filename: "bass.wav", category: "../Bass" });
      } catch (error) {
        invalidCategory = (error as Error).message;
      }

      try {
        mod.sampleAudioPath({ filename: "../bass.wav", category: "Bass" });
      } catch (error) {
        invalidFilename = (error as Error).message;
      }

      return {
        product: mod.sampleProduct({ product: " Rave " }),
        noProduct: mod.sampleProduct({}),
        humanized: mod.humanizeIdentifier("Dance_eJay1"),
        invalidCategory,
        invalidFilename,
      };
    }, DATA_MOD);

    expect(result.product).toBe("Rave");
    expect(result.noProduct).toBeNull();
    expect(result.humanized).toBe("Dance eJay 1");
    expect(result.invalidCategory).toContain("Invalid sample category");
    expect(result.invalidFilename).toContain("Invalid sample filename");
  });

  test("embedded mix manifest helpers merge overlays and expose sortable metadata", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const manifest = {
        outDir: "D:/dev/eJay/output/Unsorted",
        extractions: [
          {
            mixPath: "D:/archive/A.mix",
            embeddedPath: "riff://A.wav",
            outputPath: "D:/dev/eJay/output/Unsorted/embedded mix/alpha.wav",
            dedupeKept: false,
          },
          {
            mixPath: "D:/archive/B.mix",
            embeddedPath: "riff://B.wav",
            outputPath: "D:/dev/eJay/output/Unsorted/embedded mix/alpha.wav",
            dedupeKept: true,
            duration: 1.5,
            sampleRate: 44100,
            bitDepth: 16,
            channels: 2,
          },
          {
            mixPath: "D:/archive/C.mix",
            embeddedPath: "riff://C.wav",
            outputPath: "D:/dev/eJay/output/Unsorted/solo.wav",
            duration: 0.5,
          },
          {
            mixPath: "D:/archive/D.mix",
            embeddedPath: "riff://D.wav",
            outputPath: "D:/outside/skip.wav",
          },
        ],
      };

      const parsed = mod.parseEmbeddedMixManifest(manifest);
      const samples = mod.embeddedMixSamplesFromManifest(parsed);
      const merged = mod.mergeSamplesByAudioPath(
        [{ filename: "alpha.wav", alias: "Old Alpha", category: "Unsorted", subcategory: "embedded mix" }],
        samples,
      );

      const sortable = [
        { filename: "gamma.wav", alias: "Gamma", category: "Bass", product: "Rave", bpm: 130, beats: 4, detail: "lead", subcategory: "riff", source: "pack/c.wav" },
        { filename: "alpha.wav", alias: "Alpha", category: "Bass", product: "Dance_eJay1", bpm: 120, beats: 8, detail: "arp", subcategory: "pad", source: "pack/a.wav" },
        { filename: "beta.wav", alias: "Beta", category: "Bass", product: "Dance_eJay1", beats: 0 },
      ];

      return {
        mixLabels: ["A", "B", "C", "D"].map((format) => mod.mixFormatLabel(format)),
        invalidManifest: mod.parseEmbeddedMixManifest({ outDir: "D:/dev/eJay/output/Unsorted", extractions: [{ mixPath: "x" }] }),
        sampleSummaries: samples.map((sample: { alias?: string; filename: string; subcategory?: string | null; source_mix?: string; source_mixes?: string[]; detail?: string; dedupe_count?: number; sample_rate?: number; channels?: number; bit_depth?: number }) => ({
          name: mod.sampleDisplayName(sample),
          subcategory: sample.subcategory ?? null,
          sourceMix: sample.source_mix ?? null,
          sourceMixes: sample.source_mixes ?? [],
          detail: sample.detail ?? "",
          dedupeCount: sample.dedupe_count ?? 0,
          sampleRate: sample.sample_rate ?? 0,
          channels: sample.channels ?? 0,
          bitDepth: sample.bit_depth ?? 0,
        })),
        mergedAliases: merged.map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        metadataLine: mod.sampleMetadataLine({ product: "Dance_eJay1", bpm: 140, beats: 8, detail: "layered" }),
        disambiguationLine: mod.sampleDisambiguationLine({ internal_name: "INT_ALPHA", sample_id: 42 }),
        tooltipSingle: mod.sampleTooltip({
          filename: "solo.wav",
          alias: "Solo",
          source: "riff://solo.wav",
          source_mix: "Solo.mix",
          source_mixes: ["Solo.mix"],
          embedded_paths: ["riff://solo.wav"],
        }),
        tooltipMany: mod.sampleTooltip({
          filename: "alpha.wav",
          alias: "Alpha",
          source: "riff://alpha.wav",
          source_mixes: ["A.mix", "B.mix", "C.mix", "D.mix"],
          embedded_paths: ["p1", "p2", "p3", "p4"],
          dedupe_count: 4,
        }),
        humanizedCompact: mod.humanizeIdentifier("SampleKit_DMKIT3", { compactDmkit: true }),
        sortLabels: ["name", "bpm", "beats", "product", "detail", "subcategory", "source"].map((key) => mod.gridSortKeyLabel(key)),
        sortResults: {
          name: mod.sortSamplesByKey(sortable, "name", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          bpm: mod.sortSamplesByKey(sortable, "bpm", "desc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          beats: mod.sortSamplesByKey(sortable, "beats", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          product: mod.sortSamplesByKey(sortable, "product", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          detail: mod.sortSamplesByKey(sortable, "detail", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          subcategory: mod.sortSamplesByKey(sortable, "subcategory", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
          source: mod.sortSamplesByKey(sortable, "source", "asc").map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample)),
        },
        activeSortKeys: mod.activeSortKeys(sortable),
      };
    }, DATA_MOD);

    expect(result.mixLabels).toEqual(["Generation 1", "Generation 2", "Generation 3", "Generation 3b"]);
    expect(result.invalidManifest).toBeNull();
    expect(result.sampleSummaries).toEqual([
      {
        name: "alpha",
        subcategory: "embedded mix",
        sourceMix: "B.mix",
        sourceMixes: ["B.mix", "A.mix"],
        detail: "2 mix sources",
        dedupeCount: 2,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
      },
      {
        name: "solo",
        subcategory: null,
        sourceMix: "C.mix",
        sourceMixes: ["C.mix"],
        detail: "C.mix",
        dedupeCount: 1,
        sampleRate: 0,
        channels: 0,
        bitDepth: 0,
      },
    ]);
    expect(result.mergedAliases).toEqual(["alpha", "solo"]);
    expect(result.metadataLine).toBe("Dance eJay1 · 140 BPM · 8b · layered");
    expect(result.disambiguationLine).toBe("INT_ALPHA · #42");
    expect(result.tooltipSingle).toContain("Mix: Solo.mix");
    expect(result.tooltipMany).toContain("Mixes: A.mix; B.mix; C.mix (+1 more)");
    expect(result.tooltipMany).toContain("Embedded Paths: p1; p2; p3 (+1 more)");
    expect(result.tooltipMany).toContain("Embedded Copies: 4");
    expect(result.humanizedCompact).toBe("SampleKit DMKIT3");
    expect(result.sortLabels).toEqual(["Name", "BPM", "Sample Length", "Product", "Detail", "Subcategory", "Source"]);
    expect(result.sortResults).toEqual({
      name: ["Alpha", "Beta", "Gamma"],
      bpm: ["Gamma", "Alpha", "Beta"],
      beats: ["Beta", "Gamma", "Alpha"],
      product: ["Alpha", "Beta", "Gamma"],
      detail: ["Beta", "Alpha", "Gamma"],
      subcategory: ["Beta", "Alpha", "Gamma"],
      source: ["Beta", "Alpha", "Gamma"],
    });
    expect(result.activeSortKeys).toEqual(["name", "bpm", "beats", "product", "detail", "subcategory", "source"]);
  });

  test("data helpers surface discovered sample subcategories even when the configured list is empty", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const categories = mod.buildCategoryEntries(
        [
          { filename: "z.wav", category: "Custom", subcategory: "zeta" },
          { filename: "tone.wav", category: "Bass", subcategory: "riff" },
          { filename: "plain.wav", category: "Bass" },
        ],
        [{ id: "Bass", name: "Bass", subcategories: [] }],
      );

      return {
        ids: categories.map((entry: { id: string }) => entry.id),
        bassSubcategories: categories.find((entry: { id: string }) => entry.id === "Bass")?.subcategories ?? [],
        bassCount: categories.find((entry: { id: string }) => entry.id === "Bass")?.sampleCount ?? 0,
        rejectedBySubcategory: mod.filterSamples(
          [{ filename: "kick.wav", category: "Drum", subcategory: "kick", bpm: 140 }],
          { category: "Drum", subcategory: "snare", bpm: 140 },
        ).length,
      };
    }, DATA_MOD);

    expect(result.ids).toEqual(["Bass"]);
    expect(result.bassSubcategories).toEqual(["unsorted", "riff"]);
    expect(result.bassCount).toBe(2);
    expect(result.rejectedBySubcategory).toBe(0);
  });

  test("product-mode helpers fall back to all and use default select value", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      const unknown = mod.getProductModeEntry("not-a-real-mode");
      const missing = mod.getProductModeEntry(undefined);
      const select = mod.createProductModeSelect();

      mod.applyProductTheme(mod.getProductModeEntry("rave"));
      const themeAfterRave = document.documentElement.getAttribute("data-product-theme");
      mod.applyProductTheme(mod.getProductModeEntry("all"));
      const themeAfterAll = document.documentElement.getAttribute("data-product-theme");

      return {
        unknownId: unknown.id,
        missingId: missing.id,
        selectValue: select.value,
        optionCount: select.options.length,
        themeAfterRave,
        themeAfterAll,
      };
    }, "/src/product-mode.ts");

    expect(result.unknownId).toBe("all");
    expect(result.missingId).toBe("all");
    expect(result.selectValue).toBe("all");
    expect(result.optionCount).toBeGreaterThan(1);
    expect(result.themeAfterRave).toBe("rave");
    expect(result.themeAfterAll).toBeNull();
  });

  test("sequencer icon factories return SVG elements with expected classes", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);

      const home = mod.createSequencerHomeIcon();
      const play = mod.createSequencerPlayIcon();
      const pause = mod.createSequencerPauseIcon();
      const stop = mod.createSequencerStopIcon();

      return {
        tags: [home.tagName, play.tagName, pause.tagName, stop.tagName],
        classes: [
          home.getAttribute("class"),
          play.getAttribute("class"),
          pause.getAttribute("class"),
          stop.getAttribute("class"),
        ],
        viewBoxes: [
          home.getAttribute("viewBox"),
          play.getAttribute("viewBox"),
          pause.getAttribute("viewBox"),
          stop.getAttribute("viewBox"),
        ],
      };
    }, "/src/render/icons.ts");

    expect(result.tags).toEqual(["svg", "svg", "svg", "svg"]);
    expect(result.classes).toEqual([
      "seq-home-icon",
      "seq-play-icon",
      "seq-pause-icon",
      "seq-stop-icon",
    ]);
    expect(result.viewBoxes).toEqual(["0 0 16 16", "0 0 16 16", "0 0 16 16", "0 0 16 16"]);
  });

  test("special tabs catch samples from removed user subcategories when the browser supplies the visible tab list", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const mod = await import(/* @vite-ignore */ modPath);
      const samples = [
        { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
        { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
        { filename: "untagged.wav", alias: "Untagged", category: "Drum", bpm: 140, beats: 4 },
      ];

      return mod.filterSamples(samples, {
        category: "Drum",
        subcategory: "misc",
        bpm: 140,
        availableSubcategories: ["kick", "misc"],
      }).map((sample: { alias?: string; filename: string }) => mod.sampleDisplayName(sample));
    }, DATA_MOD);

    expect(result).toEqual(["Fill", "Untagged"]);
  });
});



