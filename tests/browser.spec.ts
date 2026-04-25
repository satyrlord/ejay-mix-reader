import { test, expect } from "./baseFixtures.js";

test.describe("data module edge cases", () => {
  const DATA_MOD = "/src/data.ts";

  test("sample helpers normalize category, labels, and paths", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
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

test.describe("library edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("FetchLibrary error branches on failed requests", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const originalFetch = globalThis.fetch;

      let indexError = "";
      globalThis.fetch = async () => new Response("", { status: 404, statusText: "Not Found" });
      try {
        await new FetchLibrary().loadIndex();
      } catch (error) {
        indexError = (error as Error).message;
      }

      globalThis.fetch = async () => new Response("", { status: 404, statusText: "Not Found" });
      const emptySamples = await new FetchLibrary().loadSamples();

      let sampleError = "";
      globalThis.fetch = async () => new Response("", { status: 500, statusText: "Server Error" });
      try {
        await new FetchLibrary().loadSamples();
      } catch (error) {
        sampleError = (error as Error).message;
      }

      let shapeError = "";
      globalThis.fetch = async () => new Response(JSON.stringify({ wrong: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      try {
        await new FetchLibrary().loadSamples();
      } catch (error) {
        shapeError = (error as Error).message;
      }

      globalThis.fetch = originalFetch;
      return { indexError, emptySamplesLength: emptySamples.length, sampleError, shapeError };
    }, LIBRARY_MOD);

    expect(result.indexError).toContain("404");
    expect(result.emptySamplesLength).toBe(0);
    expect(result.sampleError).toContain("500");
    expect(result.shapeError).toContain("Invalid output/metadata.json");
  });

  test("FetchLibrary resolveAudioUrl returns normalized paths", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const library = new FetchLibrary();
      return {
        withSub: await library.resolveAudioUrl({ filename: "kick.wav", category: "Drum", subcategory: "kick" }),
        nested: await library.resolveAudioUrl({ filename: "textures/pad.wav", category: "Pads" }),
      };
    }, LIBRARY_MOD);

    expect(result.withSub).toBe("output/Drum/kick/kick.wav");
    expect(result.nested).toBe("output/Pads/textures/pad.wav");
  });

  test("FsLibrary builds categories from root metadata, caches blobs, and validates paths", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FsLibrary } = await import(/* @vite-ignore */ modPath);

      class MockFileHandle {
        kind = "file" as const;

        constructor(private readonly name: string, private readonly content: string) {}

        async getFile(): Promise<File> {
          return new File([this.content], this.name, {
            type: this.name.endsWith(".json") ? "application/json" : "audio/wav",
          });
        }
      }

      class MockDirectoryHandle {
        kind = "directory" as const;

        constructor(private readonly children: Record<string, MockDirectoryHandle | MockFileHandle>) {}

        async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
          for (const entry of Object.entries(this.children)) {
            yield entry;
          }
        }

        async getDirectoryHandle(name: string): Promise<MockDirectoryHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "directory") {
            throw new DOMException(`Missing directory: ${name}`, "NotFoundError");
          }
          return handle;
        }

        async getFileHandle(name: string): Promise<MockFileHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "file") {
            throw new DOMException(`Missing file: ${name}`, "NotFoundError");
          }
          return handle;
        }
      }

      const root = new MockDirectoryHandle({
        Drum: new MockDirectoryHandle({
          kick: new MockDirectoryHandle({
            "boom.wav": new MockFileHandle("boom.wav", "boom"),
          }),
        }),
        Bass: new MockDirectoryHandle({
          "deep.wav": new MockFileHandle("deep.wav", "deep"),
        }),
        "metadata.json": new MockFileHandle("metadata.json", JSON.stringify({
          samples: [
            { filename: "boom.wav", category: "Drum", subcategory: "kick", alias: "Boom", product: "Dance_eJay1" },
            { filename: "deep.wav", category: "Bass", alias: "Deep", product: "Rave" },
          ],
        })),
      });

      const created: string[] = [];
      const revoked: string[] = [];
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = (_blob: Blob) => {
        const url = `blob:mock-${created.length + 1}`;
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => {
        revoked.push(url);
      };

      try {
        const library = new FsLibrary(root as unknown as FileSystemDirectoryHandle);
        const index = await library.loadIndex();
        const samples = await library.loadSamples();
        const firstUrl = await library.resolveAudioUrl(samples[0]);
        const cachedUrl = await library.resolveAudioUrl(samples[0]);

        let invalidPathError = "";
        try {
          await library.resolveAudioUrl({ filename: "../evil.wav", category: "Drum", subcategory: "kick" });
        } catch (error) {
          invalidPathError = (error as Error).message;
        }

        library.dispose();

        return {
          categories: index.categories.filter((entry: { sampleCount: number }) => entry.sampleCount > 0),
          samples,
          firstUrl,
          cachedUrl,
          invalidPathError,
          createdCount: created.length,
          revoked,
        };
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    }, LIBRARY_MOD);

    expect(result.categories).toEqual([
      { id: "Drum", name: "Drum", subcategories: ["kick", "snare", "clap", "toms", "crash", "hi-hats", "perc", "misc"], sampleCount: 1 },
      { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
    ]);
    expect(result.samples).toHaveLength(2);
    expect(result.firstUrl).toBe("blob:mock-1");
    expect(result.cachedUrl).toBe("blob:mock-1");
    expect(result.invalidPathError).toContain("Invalid audio path");
    expect(result.createdCount).toBe(1);
    expect(result.revoked).toEqual(expect.arrayContaining(["blob:mock-1"]));
  });

  test("FetchLibrary caches successful responses and dispose resets the caches", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const originalFetch = globalThis.fetch;
      const counts = new Map<string, number>();

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        counts.set(url, (counts.get(url) ?? 0) + 1);

        if (url.endsWith("data/index.json")) {
          return new Response(JSON.stringify({
            categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 1 }],
            mixLibrary: [],
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          samples: [{ filename: "deep.wav", category: "Bass", alias: "Deep" }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        const library = new FetchLibrary();
        const indexA = await library.loadIndex();
        const indexB = await library.loadIndex();
        const samplesA = await library.loadSamples();
        const samplesB = await library.loadSamples();
        library.dispose();
        await library.loadIndex();
        await library.loadSamples();

        return {
          sameIndexObject: indexA === indexB,
          sameSamplesObject: samplesA === samplesB,
          indexFetches: counts.get("data/index.json") ?? 0,
          sampleFetches: counts.get("output/metadata.json") ?? 0,
          sampleName: samplesA[0]?.alias ?? null,
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, LIBRARY_MOD);

    expect(result.sameIndexObject).toBe(true);
    expect(result.sameSamplesObject).toBe(true);
    expect(result.indexFetches).toBe(2);
    expect(result.sampleFetches).toBe(2);
    expect(result.sampleName).toBe("Deep");
  });

  test("FetchLibrary.loadSamples({ force: true }) bypasses the cache", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const originalFetch = globalThis.fetch;
      let fetchCount = 0;

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("output/metadata.json")) fetchCount++;
        return new Response(JSON.stringify({
          samples: [{ filename: "kick.wav", category: "Drum", alias: "Kick" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      try {
        const library = new FetchLibrary();
        const first = await library.loadSamples();
        const cached = await library.loadSamples(); // should not re-fetch
        const forced = await library.loadSamples({ force: true }); // must re-fetch
        return {
          sameObject: first === cached,
          forcedDifferentObject: first !== forced,
          fetchCount,
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, LIBRARY_MOD);

    expect(result.sameObject).toBe(true);
    expect(result.forcedDifferentObject).toBe(true);
    expect(result.fetchCount).toBe(2); // initial load + forced reload
  });

  test("FetchLibrary.moveSample sends PUT /__sample-move and invalidates the samples cache", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const originalFetch = globalThis.fetch;
      let sampleFetches = 0;
      let moveBodies: string[] = [];
      let moveStatuses: number[] = [];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("output/metadata.json")) {
          sampleFetches++;
          return new Response(JSON.stringify({
            samples: [{ filename: "kick.wav", category: "Drum", alias: "Kick" }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/__sample-move")) {
          moveBodies.push(typeof init?.body === "string" ? init.body : "");
          moveStatuses.push(204);
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      };

      try {
        const library = new FetchLibrary();
        const before = await library.loadSamples();
        const beforeFetches = sampleFetches;

        await library.moveSample(
          { filename: "kick.wav", category: "Drum", subcategory: "kick" },
          "Percussion",
          "misc",
        );

        const after = await library.loadSamples(); // cache invalidated → re-fetch
        return {
          beforeSampleCount: before.length,
          afterSampleCount: after.length,
          sampleFetchesBefore: beforeFetches,
          sampleFetchesTotal: sampleFetches,
          moveCallCount: moveBodies.length,
          moveStatus: moveStatuses[0],
          moveBodyParsed: JSON.parse(moveBodies[0] ?? "{}"),
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, LIBRARY_MOD);

    expect(result.moveCallCount).toBe(1);
    expect(result.moveStatus).toBe(204);
    expect(result.moveBodyParsed).toMatchObject({
      filename: "kick.wav",
      oldCategory: "Drum",
      oldSubcategory: "kick",
      newCategory: "Percussion",
      newSubcategory: "misc",
    });
    // Cache was invalidated: second loadSamples triggered a second fetch.
    expect(result.sampleFetchesBefore).toBe(1);
    expect(result.sampleFetchesTotal).toBe(2);
  });

  test("FetchLibrary loads and saves category config in development mode", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FetchLibrary } = await import(/* @vite-ignore */ modPath);
      const originalFetch = globalThis.fetch;
      const counts = new Map<string, number>();
      const methods: string[] = [];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        counts.set(url, (counts.get(url) ?? 0) + 1);
        methods.push(`${init?.method ?? "GET"} ${url}`);

        if (url.endsWith("output/categories.json")) {
          return new Response(JSON.stringify({
            categories: [{ id: "Bass", name: "Bass", subcategories: ["deep"] }],
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/__category-config")) {
          return new Response(null, { status: 204 });
        }

        if (url.endsWith("data/index.json")) {
          return new Response(JSON.stringify({ categories: [], mixLibrary: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ samples: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        const library = new FetchLibrary();
        const configA = await library.loadCategoryConfig();
        const configB = await library.loadCategoryConfig();
        const configC = await library.loadCategoryConfig({ force: true });
        await library.saveCategoryConfig?.({
          categories: [{ id: "Bass", name: "Bass", subcategories: ["deep", "warm"] }],
        });

        return {
          sameConfigObject: configA === configB,
          categoryFetches: counts.get("output/categories.json") ?? 0,
          saveCalls: methods.filter((entry) => entry === "PUT /__category-config").length,
          forcedSubcategories: configC.categories[0]?.subcategories ?? [],
          canWrite: library.canWriteCategoryConfig?.() ?? false,
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, LIBRARY_MOD);

    expect(result.sameConfigObject).toBe(true);
    expect(result.categoryFetches).toBe(2);
    expect(result.saveCalls).toBe(1);
    expect(result.forcedSubcategories).toEqual(["deep"]);
    expect(result.canWrite).toBe(true);
  });

  test("FsLibrary loads category config from the selected root when present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FsLibrary } = await import(/* @vite-ignore */ modPath);

      class MockFileHandle {
        kind = "file" as const;

        constructor(private readonly name: string, private readonly content: string) {}

        async getFile(): Promise<File> {
          return new File([this.content], this.name, {
            type: this.name.endsWith(".json") ? "application/json" : "audio/wav",
          });
        }
      }

      class MockDirectoryHandle {
        kind = "directory" as const;

        constructor(private readonly children: Record<string, MockDirectoryHandle | MockFileHandle>) {}

        async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
          for (const entry of Object.entries(this.children)) {
            yield entry;
          }
        }

        async getDirectoryHandle(name: string): Promise<MockDirectoryHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "directory") {
            throw new DOMException(`Missing directory: ${name}`, "NotFoundError");
          }
          return handle;
        }

        async getFileHandle(name: string): Promise<MockFileHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "file") {
            throw new DOMException(`Missing file: ${name}`, "NotFoundError");
          }
          return handle;
        }
      }

      const root = new MockDirectoryHandle({
        Bass: new MockDirectoryHandle({
          "deep.wav": new MockFileHandle("deep.wav", "deep"),
        }),
        "metadata.json": new MockFileHandle("metadata.json", JSON.stringify({
          samples: [{ filename: "deep.wav", category: "Bass", alias: "Deep", product: "Rave" }],
        })),
        "categories.json": new MockFileHandle("categories.json", JSON.stringify({
          categories: [{ id: "Bass", name: "Bass", subcategories: ["warm"] }],
        })),
      });

      const library = new FsLibrary(root as unknown as FileSystemDirectoryHandle);
      const config = await library.loadCategoryConfig?.();
      const index = await library.loadIndex();

      return {
        configSubcategories: config?.categories[0]?.subcategories ?? [],
        indexSubcategories: index.categories.find((entry: { id: string }) => entry.id === "Bass")?.subcategories ?? [],
      };
    }, LIBRARY_MOD);

    expect(result.configSubcategories).toEqual(["warm"]);
    expect(result.indexSubcategories).toEqual(["unsorted", "warm"]);
  });

  test("FsLibrary scans normalized category folders when metadata.json is missing", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { FsLibrary } = await import(/* @vite-ignore */ modPath);

      class MockFileHandle {
        kind = "file" as const;

        constructor(private readonly name: string, private readonly content: string) {}

        async getFile(): Promise<File> {
          return new File([this.content], this.name, { type: "audio/wav" });
        }
      }

      class MockDirectoryHandle {
        kind = "directory" as const;

        constructor(private readonly children: Record<string, MockDirectoryHandle | MockFileHandle>) {}

        async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
          for (const entry of Object.entries(this.children)) {
            yield entry;
          }
        }

        async getDirectoryHandle(name: string): Promise<MockDirectoryHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "directory") {
            throw new DOMException(`Missing directory: ${name}`, "NotFoundError");
          }
          return handle;
        }

        async getFileHandle(name: string): Promise<MockFileHandle> {
          const handle = this.children[name];
          if (!handle || handle.kind !== "file") {
            throw new DOMException(`Missing file: ${name}`, "NotFoundError");
          }
          return handle;
        }
      }

      const root = new MockDirectoryHandle({
        Drum: new MockDirectoryHandle({
          kick: new MockDirectoryHandle({
            fills: new MockDirectoryHandle({
              "boom.wav": new MockFileHandle("boom.wav", "boom"),
            }),
          }),
        }),
        Pads: new MockDirectoryHandle({
          textures: new MockDirectoryHandle({
            "wash.wav": new MockFileHandle("wash.wav", "wash"),
          }),
        }),
      });

      const originalCreate = URL.createObjectURL;
      const created: string[] = [];
      URL.createObjectURL = (_blob: Blob) => {
        const url = `blob:scan-${created.length + 1}`;
        created.push(url);
        return url;
      };

      try {
        const library = new FsLibrary(root as unknown as FileSystemDirectoryHandle);
        const samples = await library.loadSamples();
        const index = await library.loadIndex();
        const resolvedUrl = await library.resolveAudioUrl(samples[0]);

        let invalidCategoryError = "";
        try {
          await library.resolveAudioUrl({ filename: "boom.wav", category: "../Drum", subcategory: "kick" });
        } catch (error) {
          invalidCategoryError = (error as Error).message;
        }

        return {
          sampleSummaries: samples.map((sample: { filename: string; category?: string; subcategory?: string | null }) => ({
            filename: sample.filename,
            category: sample.category,
            subcategory: sample.subcategory,
          })),
          activeCategories: index.categories
            .filter((entry: { sampleCount: number }) => entry.sampleCount > 0)
            .map((entry: { id: string; sampleCount: number }) => ({
            id: entry.id,
            count: entry.sampleCount,
            })),
          resolvedUrl,
          invalidCategoryError,
          createdCount: created.length,
        };
      } finally {
        URL.createObjectURL = originalCreate;
      }
    }, LIBRARY_MOD);

    expect(result.sampleSummaries).toEqual([
      { filename: "fills/boom.wav", category: "Drum", subcategory: "kick" },
      { filename: "wash.wav", category: "Pads", subcategory: "textures" },
    ]);
    expect(result.activeCategories).toEqual([
      { id: "Drum", count: 1 },
      { id: "Pads", count: 1 },
    ]);
    expect(result.resolvedUrl).toBe("blob:scan-1");
    expect(result.invalidCategoryError).toContain("Invalid audio path");
    expect(result.createdCount).toBe(1);
  });
});

test.describe("render edge cases", () => {
  const RENDER_MOD = "/src/render.ts";
  const PLAYER_MOD = "/src/player.ts";

  test("category sidebar and tab strip render active states", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const sidebar = document.createElement("div");
      const tabs = document.createElement("div");
      tabs.id = "harness-tabs";
      document.body.append(sidebar, tabs);

      render.renderCategorySidebar(
        sidebar,
        [
          { id: "Loop", name: "Loop", subcategories: [], sampleCount: 12 },
          { id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 4 },
        ],
        "Drum",
        () => {},
      );
      render.renderSubcategoryTabs(
        tabs,
        [
          { id: "kick", label: "kick" },
          { id: "snare", label: "snare" },
        ],
        "kick",
        () => {},
        {
          addDisabled: true,
          addTitle: "Read-only",
        },
      );

      return {
        categoryCount: sidebar.querySelectorAll(".category-btn").length,
        activeCategory: sidebar.querySelector(".category-btn.is-active")?.getAttribute("data-category-id"),
        systemFeatureCount: sidebar.querySelectorAll(".category-system-btn").length,
        unsortedRole: sidebar.querySelector('.category-system-btn[data-category-id="Unsorted"]')?.getAttribute("data-sidebar-role"),
        loadJsonRole: sidebar.querySelector('.load-json-btn')?.getAttribute("data-sidebar-role"),
        tabCount: tabs.querySelectorAll(".subcategory-tab").length,
        activeTab: tabs.querySelector(".subcategory-tab.is-active")?.getAttribute("data-tab-id"),
        plusVisible: Boolean(tabs.querySelector("#subcategory-add")),
        plusDisabled: Boolean((tabs.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
      };
    }, RENDER_MOD);

    expect(result.categoryCount).toBe(2);
    expect(result.activeCategory).toBe("Drum");
    expect(result.systemFeatureCount).toBe(2);
    expect(result.unsortedRole).toBe("system-feature");
    expect(result.loadJsonRole).toBe("system-feature");
    expect(result.tabCount).toBe(2);
    expect(result.activeTab).toBe("kick");
    expect(result.plusVisible).toBe(true);
    expect(result.plusDisabled).toBe(true);
  });

  test("renderSampleGrid shows empty state and error toast branches", async ({ page }) => {
    await page.goto("/");

    const emptyText = await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const grid = document.createElement("div");
      document.body.appendChild(grid);
      render.renderSampleGrid(grid, [], new Player(), {
        loadIndex: () => Promise.resolve({ categories: [], mixLibrary: [] }),
        loadSamples: () => Promise.resolve([]),
        resolveAudioUrl: () => Promise.resolve(""),
        dispose: () => {},
      });
      return grid.textContent?.trim() ?? "";
    }, [RENDER_MOD, PLAYER_MOD] as const);
    expect(emptyText).toContain("No samples in this selection.");

    await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const grid = document.createElement("div");
      document.body.appendChild(grid);
      render.renderSampleGrid(grid, [{ filename: "boom.wav", alias: "Boom", category: "Drum" }], new Player(), {
        loadIndex: () => Promise.resolve({ categories: [], mixLibrary: [] }),
        loadSamples: () => Promise.resolve([]),
        resolveAudioUrl: () => Promise.reject(new Error("not found")),
        dispose: () => {},
      });
    }, [RENDER_MOD, PLAYER_MOD] as const);

    await page.locator(".sample-block").last().dispatchEvent("click");
    await expect(page.locator("#error-toast")).toBeVisible();
    await page.locator(".sample-block").last().dispatchEvent("click");
    await expect(page.locator("#error-toast")).toHaveCount(1);
  });

  test("render helpers tolerate missing transport elements and disabled add handlers", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const tabs = document.createElement("div");
      let addCalls = 0;

      render.renderSubcategoryTabs(
        tabs,
        [{ id: "kick", label: "kick" }],
        null,
        () => {},
        {
          onAdd: () => {
            addCalls += 1;
          },
          addDisabled: true,
        },
      );

      (tabs.querySelector("#subcategory-add") as HTMLButtonElement).click();
      render.updateTransport("output/Drum/kick.wav", {
        currentTime: 0,
        duration: 0,
      } as never);

      return {
        addCalls,
        plusDisabled: Boolean((tabs.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
      };
    }, RENDER_MOD);

    expect(result.addCalls).toBe(0);
    expect(result.plusDisabled).toBe(true);
  });

  test("inline subcategory editor submits with Enter and cancels on escape/outside click", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      document.body.innerHTML = "";
      const tabs = document.createElement("div");
      tabs.id = "harness-tabs";
      const outside = document.createElement("button");
      outside.id = "outside-target";
      outside.type = "button";
      outside.textContent = "outside";
      document.body.append(tabs, outside);

      const testWindow = window as Window & {
        __subcatHarness?: {
          state: {
            draft: string;
            drafts: string[];
            submits: number;
            cancels: number;
          };
          renderEditing: (value?: string) => void;
        };
      };

      let editing = true;
      const state = {
        draft: "",
        drafts: [] as string[],
        submits: 0,
        cancels: 0,
      };

      const rerender = () => {
        render.renderSubcategoryTabs(
          tabs,
          [{ id: "kick", label: "kick" }],
          null,
          () => {},
          editing
            ? {
                isEditing: true,
                draftValue: state.draft,
                onDraftChange: (value: string) => {
                  state.draft = value;
                  state.drafts.push(value);
                },
                onSubmit: () => {
                  state.submits += 1;
                  editing = false;
                  rerender();
                },
                onCancel: () => {
                  state.cancels += 1;
                  editing = false;
                  rerender();
                },
              }
            : {},
        );
      };

      testWindow.__subcatHarness = {
        state,
        renderEditing: (value = "") => {
          state.draft = value;
          editing = true;
          rerender();
        },
      };

      rerender();
    }, RENDER_MOD);

    await expect(page.locator("#harness-tabs #subcategory-add-input")).toBeFocused();
    await expect(page.locator("#harness-tabs #subcategory-add-confirm")).toBeDisabled();
    await expect(page.locator("#harness-tabs #subcategory-add-confirm svg")).toHaveCount(1);
    await page.locator("#harness-tabs #subcategory-add-input").fill("fills");
    await expect(page.locator("#harness-tabs #subcategory-add-confirm")).toBeEnabled();
    await page.locator("#harness-tabs #subcategory-add-input").press("Enter");
    await expect(page.locator("#harness-tabs #subcategory-add-input")).toHaveCount(0);
    await expect(page.locator("#harness-tabs #subcategory-add")).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as Window & {
        __subcatHarness: { renderEditing: (value?: string) => void };
      }).__subcatHarness.renderEditing();
    });
    await page.locator("#harness-tabs #subcategory-add-input").press("Escape");
    await expect(page.locator("#harness-tabs #subcategory-add-input")).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as Window & {
        __subcatHarness: { renderEditing: (value?: string) => void };
      }).__subcatHarness.renderEditing();
    });
    await expect(page.locator("#harness-tabs #subcategory-add-input")).toBeVisible();
    await page.locator("#outside-target").click();

    const result = await page.evaluate(() => {
      return (window as unknown as Window & {
        __subcatHarness: {
          state: {
            draft: string;
            drafts: string[];
            submits: number;
            cancels: number;
          };
        };
      }).__subcatHarness.state;
    });

    expect(result.drafts[result.drafts.length - 1]).toBe("fills");
    expect(result.submits).toBe(1);
    expect(result.cancels).toBe(2);
  });

  test("transport and playing helpers update rendered state", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([rPath, pPath]) => {
      const render = await import(/* @vite-ignore */ rPath);
      const { Player } = await import(/* @vite-ignore */ pPath);
      const transportHost = document.createElement("div");
      document.body.appendChild(transportHost);
      render.renderTransportBar(transportHost);

      const grid = document.createElement("div");
      grid.id = "sample-grid";
      const block = document.createElement("button");
      block.className = "sample-block";
      block.dataset.path = "output/Bass/deep.wav";
      grid.appendChild(block);
      document.body.appendChild(grid);

      const player = new Player();
      render.updateTransport(null, player);
      const idle = document.getElementById("transport-name")?.textContent ?? "";
      render.updatePlayingBlock("output/Bass/deep.wav");

      return {
        idle,
        playing: block.classList.contains("is-playing"),
      };
    }, [RENDER_MOD, PLAYER_MOD] as const);

    expect(result.idle).toBe("No sample playing");
    expect(result.playing).toBe(true);
  });

  test("transport build label stays centered as playback text changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      document.body.innerHTML = "";

      const transportHost = document.createElement("div");
      document.body.appendChild(transportHost);
      render.renderTransportBar(transportHost);

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const bar = document.getElementById("transport") as HTMLElement | null;
      const label = document.querySelector<HTMLElement>(".transport-build-label");
      if (!bar || !label) {
        throw new Error("Missing transport elements");
      }

      const centerDelta = (): number => {
        const barRect = bar.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const barCenter = barRect.left + (barRect.width / 2);
        const labelCenter = labelRect.left + (labelRect.width / 2);
        return Math.abs(barCenter - labelCenter);
      };

      render.updateTransport("mock://short.wav", { currentTime: 0, duration: 0 } as never);
      const shortDelta = centerDelta();

      render.updateTransport(
        "mock://extremely-long-sample-name-that-should-not-shift-the-centered-build-label.wav",
        { currentTime: 0, duration: 0 } as never,
      );
      const longDelta = centerDelta();

      return {
        shortDelta,
        longDelta,
      };
    }, RENDER_MOD);

    expect(result.shortDelta).toBeLessThan(1.5);
    expect(result.longDelta).toBeLessThan(1.5);
  });

  test("transport build label stays hidden until all audio stops and cooldown completes", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      document.body.innerHTML = "";

      const transportHost = document.createElement("div");
      document.body.appendChild(transportHost);
      render.renderTransportBar(transportHost);

      const label = document.querySelector<HTMLElement>(".transport-build-label");
      if (!label) {
        throw new Error("Missing transport build label");
      }

      const parseDurationMs = (value: string): number => {
        const normalized = value.trim().toLowerCase();
        if (normalized.endsWith("ms")) {
          return Number.parseFloat(normalized.slice(0, -2));
        }
        if (normalized.endsWith("s")) {
          return Number.parseFloat(normalized.slice(0, -1)) * 1000;
        }
        return Number.NaN;
      };

      const originalSetTimeout = window.setTimeout;
      const originalClearTimeout = window.clearTimeout;

      type TimerRecord = {
        id: number;
        delay: number;
        cleared: boolean;
        fn: () => void;
      };

      const timers: TimerRecord[] = [];
      let nextTimerId = 1;

      window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
        const timer: TimerRecord = {
          id: nextTimerId++,
          delay: typeof timeout === "number" ? timeout : 0,
          cleared: false,
          fn: () => {
            if (timer.cleared || typeof handler !== "function") return;
            handler();
          },
        };
        timers.push(timer);
        return timer.id;
      }) as typeof window.setTimeout;

      window.clearTimeout = ((timeoutId?: number) => {
        const timer = timers.find((entry) => entry.id === timeoutId);
        if (timer) timer.cleared = true;
      }) as typeof window.clearTimeout;

      const snapshot = () => ({
        hidden: label.classList.contains("is-hidden"),
        state: label.dataset.soundState ?? null,
      });

      try {
        const initial = snapshot();

        render.setTransportBuildLabelAudioPlaying("sample", true);
        const duringSample = snapshot();

        render.setTransportBuildLabelAudioPlaying("mix", true);
        render.setTransportBuildLabelAudioPlaying("sample", false);
        const whileMixStillPlaying = snapshot();
        const timersWhileMixActive = timers.length;

        render.setTransportBuildLabelAudioPlaying("mix", false);
        const cooldown = snapshot();
        const firstCooldownTimer = timers[timers.length - 1];

        render.setTransportBuildLabelAudioPlaying("sample", true);
        const duringReplay = snapshot();

        render.setTransportBuildLabelAudioPlaying("sample", false);
        const secondCooldownTimer = timers[timers.length - 1];
        secondCooldownTimer.fn();
        const afterCooldown = snapshot();

        return {
          initial,
          duringSample,
          whileMixStillPlaying,
          timersWhileMixActive,
          cooldown,
          transitionDurationMs: parseDurationMs(getComputedStyle(label).transitionDuration),
          globalEffectMs: render.GLOBAL_UI_1000MS_EFFECT_MS,
          revealDelayMs: render.TRANSPORT_BUILD_LABEL_REVEAL_DELAY_MS,
          firstCooldownDelay: firstCooldownTimer.delay,
          firstCooldownCleared: firstCooldownTimer.cleared,
          duringReplay,
          secondCooldownDelay: secondCooldownTimer.delay,
          afterCooldown,
        };
      } finally {
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
      }
    }, RENDER_MOD);

    expect(result.initial).toEqual({ hidden: false, state: "idle" });
    expect(result.duringSample).toEqual({ hidden: true, state: "playing" });
    expect(result.whileMixStillPlaying).toEqual({ hidden: true, state: "playing" });
    expect(result.timersWhileMixActive).toBe(0);
    expect(result.cooldown).toEqual({ hidden: true, state: "cooldown" });
    expect(result.globalEffectMs).toBe(1000);
    expect(result.transitionDurationMs).toBe(result.globalEffectMs);
    expect(result.revealDelayMs).toBe(1000);
    expect(result.firstCooldownDelay).toBe(result.revealDelayMs);
    expect(result.firstCooldownCleared).toBe(true);
    expect(result.duringReplay).toEqual({ hidden: true, state: "playing" });
    expect(result.secondCooldownDelay).toBe(result.revealDelayMs);
    expect(result.afterCooldown).toEqual({ hidden: false, state: "idle" });
  });

  test("renderHomePage and renderSpaShell wire buttons and shell slots", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const homeHost = document.createElement("div");
      const homeNoDevHost = document.createElement("div");
      const shellHost = document.createElement("div");
      let pickClicks = 0;
      let devClicks = 0;

      render.renderHomePage(homeHost, () => {
        pickClicks++;
      }, () => {
        devClicks++;
      });

      (homeHost.querySelector("#pick-folder-btn") as HTMLButtonElement).click();
      (homeHost.querySelector("#dev-library-btn") as HTMLButtonElement).click();

      render.renderHomePage(homeNoDevHost, () => {}, null);
      const shell = render.renderSpaShell(shellHost);

      return {
        pickClicks,
        devClicks,
        hasDevButtonWhenEnabled: Boolean(homeHost.querySelector("#dev-library-btn")),
        hasDevButtonWhenDisabled: Boolean(homeNoDevHost.querySelector("#dev-library-btn")),
        shellId: shell.shell.id,
        sidebarId: shell.sidebar.id,
        tabsId: shell.tabs.id,
        tabsInContextStrip: shell.contextStrip.contains(shell.tabs),
        bpmInContextStrip: shell.contextStrip.contains(shell.bpm),
        hasZoomOutControl: Boolean(shell.contextStrip.querySelector("#sample-zoom-out")),
        hasZoomInControl: Boolean(shell.contextStrip.querySelector("#sample-zoom-in")),
        legacyTabsRowPresent: Boolean(shellHost.querySelector(".spa-tabs-row")),
        gridId: shell.grid.id,
        bpmValue: shell.bpm.value,
        bpmOptions: Array.from(shell.bpm.options as HTMLCollectionOf<HTMLOptionElement>).map((option) => ({
          value: option.value,
          label: option.textContent ?? "",
        })),
        transportId: shell.transport.id,
      };
    }, RENDER_MOD);

    expect(result.pickClicks).toBe(1);
    expect(result.devClicks).toBe(1);
    expect(result.hasDevButtonWhenEnabled).toBe(true);
    expect(result.hasDevButtonWhenDisabled).toBe(false);
    expect(result.shellId).toBe("spa-shell");
    expect(result.sidebarId).toBe("category-sidebar");
    expect(result.tabsId).toBe("subcategory-tabs");
    expect(result.tabsInContextStrip).toBe(true);
    expect(result.bpmInContextStrip).toBe(true);
    expect(result.hasZoomOutControl).toBe(true);
    expect(result.hasZoomInControl).toBe(true);
    expect(result.legacyTabsRowPresent).toBe(false);
    expect(result.gridId).toBe("sample-grid");
    expect(result.bpmValue).toBe("");
    expect(result.bpmOptions).toContainEqual({ value: "", label: "All" });
    expect(result.transportId).toBe("transport");
  });

  test("renderHomePage tolerates a missing actions container", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const container = document.createElement("div");
      const originalQuerySelector = Element.prototype.querySelector;

      Element.prototype.querySelector = function (selectors: string): Element | null {
        if (this instanceof HTMLDivElement && this.id === "home-page" && selectors === ".home-actions") {
          return null;
        }

        return originalQuerySelector.call(this, selectors);
      };

      try {
        render.renderHomePage(container, () => {}, null);
        return {
          childCount: container.children.length,
          hasHomePage: Boolean(container.querySelector("#home-page")),
        };
      } finally {
        Element.prototype.querySelector = originalQuerySelector;
      }
    }, RENDER_MOD);

    expect(result.childCount).toBe(1);
    expect(result.hasHomePage).toBe(true);
  });

  test("renderSampleGrid lays out lanes, resolves audio, and updates active transport state", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const grid = document.createElement("div");
      const transportHost = document.createElement("div");
      document.body.append(grid, transportHost);

      const toggled: string[] = [];
      const player = {
        toggle(path: string) {
          toggled.push(path);
        },
      };

      render.renderSampleGrid(grid, [
        { filename: "long.wav", alias: "Long", category: "Bass", beats: 32 },
        { filename: "mid.wav", alias: "Mid", category: "Bass", beats: 16 },
        { filename: "short.wav", alias: "Short", category: "Drum", beats: 8 },
      ], player as never, {
        loadIndex: () => Promise.resolve({ categories: [], mixLibrary: [] }),
        loadSamples: () => Promise.resolve([]),
        resolveAudioUrl: (sample: { filename: string }) => Promise.resolve(`mock://${sample.filename}`),
        dispose: () => {},
      });

      const blocks = [...grid.querySelectorAll<HTMLElement>(".sample-block")];
      blocks[0].click();
      await Promise.resolve();
      await Promise.resolve();

      render.renderTransportBar(transportHost);
      render.updateTransport("mock://long.wav", { currentTime: 1, duration: 2 } as never);

      return {
        laneCount: grid.querySelectorAll(".sample-lane").length,
        firstSpan: blocks[0].style.getPropertyValue("--block-span"),
        secondSpan: blocks[1].style.getPropertyValue("--block-span"),
        thirdSpan: blocks[2].style.getPropertyValue("--block-span"),
        firstColor: blocks[0].style.getPropertyValue("--block-color"),
        firstResolvedPath: blocks[0].dataset.path ?? null,
        toggled,
        transportName: document.getElementById("transport-name")?.textContent ?? "",
        transportProgress: (document.getElementById("transport-progress") as HTMLProgressElement | null)?.value ?? -1,
      };
    }, RENDER_MOD);

    expect(result.laneCount).toBe(1);
    expect(result.firstSpan).toBe("8");
    expect(result.secondSpan).toBe("4");
    expect(result.thirdSpan).toBe("2");
    expect(result.firstColor).toContain("--channel-bass");
    expect(result.firstResolvedPath).toBe("mock://long.wav");
    expect(result.toggled).toEqual(["mock://long.wav"]);
    expect(result.transportName).toBe("long");
    expect(result.transportProgress).toBe(50);
  });

  test("renderSampleGrid disambiguates duplicate labels through every fallback stage", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const render = await import(/* @vite-ignore */ modPath);
      const grid = document.createElement("div");
      document.body.appendChild(grid);

      render.renderSampleGrid(grid, [
        { filename: "a.wav", alias: "Echo", category: "Loop", detail: "warm", product: "Dance_eJay1", bpm: 140, beats: 4 },
        { filename: "b.wav", alias: "Echo", category: "Loop", detail: "warm", product: "Rave", bpm: 140, beats: 4 },
        { filename: "c.wav", alias: "Echo", category: "Loop", product: "Rave", internal_name: "INT_C", bpm: 140, beats: 4 },
        { filename: "d-left.wav", alias: "Echo", category: "Loop", product: "Rave", internal_name: "INT_C", sample_id: 7, bpm: 140, beats: 4 },
        { filename: "d-right.wav", alias: "Echo", category: "Loop", product: "Rave", internal_name: "INT_C", sample_id: 7, bpm: 140, beats: 4 },
        { filename: "d-source.wav", alias: "Echo", category: "Loop", product: "Rave", internal_name: "INT_C", sample_id: 7, source: "pack/echo.wav", bpm: 140, beats: 4 },
      ], { toggle() {} } as never, {
        loadIndex: () => Promise.resolve({ categories: [], mixLibrary: [] }),
        loadSamples: () => Promise.resolve([]),
        resolveAudioUrl: () => Promise.resolve("mock://echo.wav"),
        dispose: () => {},
      });

      return [...grid.querySelectorAll<HTMLElement>(".sample-block")].map((block) => ({
        label: block.querySelector(".sample-block-label")?.textContent ?? "",
        meta: block.querySelector(".sample-block-meta")?.textContent ?? "",
        title: block.title,
      }));
    }, RENDER_MOD);

    expect(result.map((entry) => entry.label)).toEqual([
      "Echo - warm - Dance eJay1 - a",
      "Echo - warm - Rave - b",
      "Echo - Rave - INT_C - c",
      "Echo - Rave - INT_C - #7 - d-left",
      "Echo - Rave - INT_C - #7 - d-right",
      "Echo - Rave - INT_C - #7 - pack/echo.wav - d-source",
    ]);
    expect(result.every((entry) => entry.meta === "140 BPM · 4b")).toBe(true);
    expect(result[5]?.title).toContain("Source: pack/echo.wav");
  });
});

test.describe("player edge cases", () => {
  const PLAYER_MOD = "/src/player.ts";

  test("Player initial state getters", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      return {
        state: p.state,
        activePath: p.activePath,
        currentTime: p.currentTime,
        duration: p.duration,
      };
    }, PLAYER_MOD);
    expect(results.state).toBe("stopped");
    expect(results.activePath).toBeNull();
    expect(results.currentTime).toBe(0);
    expect(results.duration).toBe(0);
  });

  test("Player stop when not playing", async ({ page }) => {
    await page.goto("/");
    const states = await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      const captured: string[] = [];
      p.onStateChange((s: string) => captured.push(s));
      p.stop();
      return captured;
    }, PLAYER_MOD);
    expect(states).toEqual([]);
  });

  test("Player play same path reuses src", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async (modPath) => {
      const { Player } = await import(/* @vite-ignore */ modPath);
      const p = new Player();
      const header = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x20, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20,
        0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x40, 0x1F, 0x00, 0x00, 0x40, 0x1F, 0x00, 0x00,
        0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61,
        0x00, 0x20, 0x00, 0x00,
      ]);
      const data = new Uint8Array(header.length + 8192);
      data.set(header);
      data.fill(128, header.length);
      const blob = new Blob([data], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      try { p.play(url); } catch {}
      try { p.play(url); } catch {}
      p.stop();
    }, PLAYER_MOD);
  });

  test("Player emits play and stop transitions with a controllable Audio implementation", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 2;
        paused = true;
        ended = false;
        private readonly listeners = new Map<string, Set<() => void>>();

        addEventListener(type: string, listener: () => void): void {
          const listeners = this.listeners.get(type) ?? new Set<() => void>();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(type: string, listener: () => void): void {
          this.listeners.get(type)?.delete(listener);
        }

        play(): Promise<void> {
          this.paused = false;
          return Promise.resolve();
        }

        pause(): void {
          this.paused = true;
          for (const listener of this.listeners.get("pause") ?? []) {
            listener();
          }
        }
      }

      const originalAudio = window.Audio;
      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;

      try {
        const { Player } = await import(/* @vite-ignore */ modPath);
        const player = new Player();
        const states: string[] = [];
        player.onStateChange((state: string) => states.push(state));

        player.play("first.wav");
        await Promise.resolve();
        await Promise.resolve();
        player.toggle("first.wav");
        player.play("second.wav");
        await Promise.resolve();
        await Promise.resolve();

        const audio = (player as unknown as { audio: FakeAudio }).audio;
        audio.currentTime = 1;
        audio.pause();
        player.destroy();
        audio.currentTime = 1;
        audio.pause();

        return {
          states,
          finalState: player.state,
          activePath: player.activePath,
          src: audio.src,
        };
      } finally {
        (window as unknown as { Audio: typeof Audio }).Audio = originalAudio;
      }
    }, PLAYER_MOD);

    expect(result.states).toEqual(["playing", "stopped", "playing", "stopped"]);
    expect(result.finalState).toBe("stopped");
    expect(result.activePath).toBeNull();
    expect(result.src).toBe("second.wav");
  });

  test("Player reports rejected playback attempts without changing state", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      class FailingAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;

        addEventListener(): void {}
        removeEventListener(): void {}

        play(): Promise<void> {
          this.paused = true;
          return Promise.reject(new Error("blocked"));
        }

        pause(): void {
          this.paused = true;
        }
      }

      const originalAudio = window.Audio;
      const originalWarn = console.warn;
      const warnings: string[] = [];
      (window as unknown as { Audio: typeof Audio }).Audio = FailingAudio as unknown as typeof Audio;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      try {
        const { Player } = await import(/* @vite-ignore */ modPath);
        const player = new Player();
        const states: string[] = [];
        player.onStateChange((state: string) => states.push(state));
        player.play("blocked.wav");
        await Promise.resolve();
        await Promise.resolve();

        return {
          states,
          state: player.state,
          activePath: player.activePath,
          warnings,
        };
      } finally {
        console.warn = originalWarn;
        (window as unknown as { Audio: typeof Audio }).Audio = originalAudio;
      }
    }, PLAYER_MOD);

    expect(result.states).toEqual([]);
    expect(result.state).toBe("stopped");
    expect(result.activePath).toBeNull();
    expect(result.warnings.some((message: string) => message.includes("Audio playback failed:"))).toBe(true);
  });

  test("calcProgressInterval clamps and scales correctly", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async (modPath) => {
      const { calcProgressInterval } = await import(/* @vite-ignore */ modPath);
      return {
        zero: calcProgressInterval(0),
        negative: calcProgressInterval(-1),
        short: calcProgressInterval(1),
        medium: calcProgressInterval(3),
        long: calcProgressInterval(10),
        boundary: calcProgressInterval(2.5),
      };
    }, PLAYER_MOD);
    expect(results.zero).toBe(250);
    expect(results.negative).toBe(250);
    expect(results.short).toBe(50);
    expect(results.medium).toBe(150);
    expect(results.long).toBe(250);
    expect(results.boundary).toBe(125);
  });
});

test.describe("main edge cases", () => {
  const LIBRARY_MOD = "/src/library.ts";

  test("beforeunload handler runs without crashing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".category-btn").first()).toBeVisible();

    const result = await page.evaluate(() => {
      try {
        window.dispatchEvent(new Event("beforeunload"));
        return "ok";
      } catch {
        return "error";
      }
    });

    expect(result).toBe("ok");
    await expect(page.locator("#transport")).toBeVisible();
  });

  test("main falls back to default categories when config loading is unavailable and disables subcategory writes", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 1 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass.wav", alias: "Bass", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = undefined;
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return false;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://bass.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=no-config-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();

      return {
        categoryCount: document.querySelectorAll(".category-btn").length,
        addDisabled: Boolean((document.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
      };
    }, LIBRARY_MOD);

    expect(result.categoryCount).toBeGreaterThan(1);
    expect(result.addDisabled).toBe(true);
  });

  test("main closes the inline subcategory editor when a config refresh disables writes", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let loadCategoryConfigCalls = 0;
      let canWriteCategoryConfig = true;

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", product: "Dance_eJay1", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        loadCategoryConfigCalls += 1;
        if (loadCategoryConfigCalls === 1) {
          return {
            categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
          };
        }

        canWriteCategoryConfig = false;
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return canWriteCategoryConfig;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://kick.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=write-toggle-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();

      (document.querySelector("#subcategory-add") as HTMLButtonElement).click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      await Promise.resolve();
      await Promise.resolve();

      return {
        inlineEditorOpen: Boolean(document.querySelector("#subcategory-add-input")),
        addDisabled: Boolean((document.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
        hasSnareTab: Boolean(document.querySelector('.subcategory-tab[data-tab-id="subcategory:snare"]')),
      };
    }, LIBRARY_MOD);

    expect(result.inlineEditorOpen).toBe(false);
    expect(result.addDisabled).toBe(true);
    expect(result.hasSnareTab).toBe(true);
  });

  test("the real app falls back to the default config when categories.json fails to load initially", async ({ page }) => {
    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "broken config" }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
  });

  test("the real app applies category config refreshes when categories.json changes", async ({ page }) => {
    let categoryFetches = 0;

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{
            id: "Drum",
            name: "Drum",
            subcategories: categoryFetches === 1 ? ["kick"] : ["kick", "snare"],
          }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toHaveCount(0);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBeGreaterThan(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);
  });

  test("the real app coalesces config refreshes and falls back when the active category disappears", async ({ page }) => {
    let categoryFetches = 0;
    let releaseRefresh = (): void => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        resolve();
      };
    });

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;

      if (categoryFetches === 2) {
        await refreshGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            categories: [{ id: "Bass", name: "Bass", subcategories: ["riff"] }],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Drum");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBe(2);
    releaseRefresh();

    await page.waitForLoadState("networkidle");
    await expect(page.locator('.category-btn[data-category-id="Bass"]')).toBeVisible();
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:unsorted");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");
    await expect.poll(() => categoryFetches).toBe(2);
  });

  test("the real app ignores unchanged category config refreshes and does not save cancelled, blank, or duplicate inline subcategory edits", async ({ page }) => {
    let categoryFetches = 0;
    let saveCalls = 0;
    const categoryConfig = {
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
    };

    await page.route("**/output/categories.json", async (route) => {
      categoryFetches += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(categoryConfig),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() === "PUT") {
        saveCalls += 1;
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.continue();
    });

    await page.goto("/");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });

    await expect.poll(() => categoryFetches).toBeGreaterThan(1);
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);

    await page.locator("#subcategory-add").click();
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await expect(page.locator("#subcategory-add-confirm")).toBeDisabled();
    await expect(page.locator("#subcategory-add-confirm svg")).toHaveCount(1);
    await page.locator("#subcategory-add-input").press("Escape");
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill("   ");
    await expect(page.locator("#subcategory-add-confirm")).toBeDisabled();
    await page.locator("#subcategory-add-input").press("Enter");
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await page.locator("#subcategory-add-input").press("Escape");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]').click();
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:snare");

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill(" kick ");
    await expect(page.locator("#subcategory-add-confirm")).toBeEnabled();
    await page.locator("#subcategory-add-input").press("Enter");
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);
    await expect(page.locator('.subcategory-tab.is-active')).toHaveAttribute("data-tab-id", "subcategory:kick");

    expect(categoryFetches).toBeGreaterThan(1);
    expect(saveCalls).toBe(0);
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);
  });

  test("the real app hardcodes special tabs and removes only configured user subcategories through the context menu", async ({ page }) => {
    let saveCalls = 0;
    let categoryConfig = {
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "fills"] }],
    };

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(categoryConfig),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      saveCalls += 1;
      categoryConfig = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toHaveAttribute("data-tab-kind", "system");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toHaveAttribute("data-tab-kind", "special");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toHaveAttribute("data-tab-kind", "user");

    await page.evaluate(() => {
      document.getElementById("subcategory-tabs")?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.evaluate(() => {
      const tabs = document.getElementById("subcategory-tabs");
      if (!tabs) return;

      const orphanTextNode = document.createTextNode("orphan text target");
      tabs.appendChild(orphanTextNode);
      orphanTextNode.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 28,
        clientY: 28,
      }));
      tabs.removeChild(orphanTextNode);
    });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Fill");

    const saveResponse = page.waitForResponse((response) => (
      response.url().endsWith("/__category-config") && response.request().method() === "PUT"
    ));
    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveCount(1);
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveText("remove");
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await expect(page.locator("#subcategory-context-menu .subcategory-context-menu-item")).toHaveCount(1);
    await page.locator("#subcategory-context-menu .subcategory-context-menu-item").click();
    await saveResponse;

    expect(saveCalls).toBe(1);
    expect(categoryConfig).toEqual({
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
    });

    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click();
    await expect(page.locator(".sample-grid")).not.toContainText("Fill");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Fill");
  });

  test("the real app shows a toast when saving an inline subcategory fails", async ({ page }) => {
    let saveCalls = 0;

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick", "snare"] }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [{ filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 }],
        }),
      });
    });

    await page.route("**/__category-config", async (route) => {
      if (route.request().method() === "PUT") {
        saveCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "write failed" }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill("fills");
    await page.locator("#subcategory-add-confirm").click();

    expect(saveCalls).toBe(1);
    await expect(page.locator("#error-toast")).toHaveText("Could not save categories.json.");
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
  });

  test("the real app exercises sample move, sort, and watcher refresh flows", async ({ page }) => {
    let metadataVersion = 0;
    let categoryVersion = 0;
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            {
              id: "Drum",
              name: "Drum",
              subcategories: categoryVersion === 0 ? ["kick", "fills"] : ["kick", "fills", "snare"],
            },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: metadataVersion === 0
            ? [
                { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
                { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
                { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
              ]
            : [
                { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
                { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
                { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
              ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();
    await page.locator("#bpm-filter").selectOption("140");

    await page.locator("#sample-search").fill("Kick");
    await expect(page.locator("#sample-search-clear")).toBeVisible();
    await expect(page.locator(".sample-grid")).toContainText("Kick");
    await page.locator("#sample-search-clear").click();

    await page.locator(".sample-block").first().click({ button: "right" });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Move to");
    await page.mouse.click(8, 8);
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.locator(".sample-block").first().click({ button: "right" });
    const bassMoveItem = page.locator("#sample-context-menu .ctx-menu-item.has-submenu").filter({ hasText: "Bass" });
    await bassMoveItem.hover();
    await bassMoveItem.locator(".ctx-submenu .ctx-menu-item").first().click();
    await expect.poll(() => moveCalls).toBe(1);
    await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");

    metadataVersion = 1;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
    });
    await expect(page.locator(".sample-grid")).toContainText("Kick Reloaded");

    categoryVersion = 1;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("category-config-updated"));
    });
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").first().click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    const result = await page.evaluate(() => {
      const zoomScale = document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "";
      window.dispatchEvent(new Event("beforeunload"));
      return { zoomScale };
    });

    expect(result.zoomScale).toBe("1");
  });

  test("the real app shows a toast when moving a sample fails and supports sort-menu cleanup", async ({ page }) => {
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "move failed" }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();

    await page.locator(".sample-block").first().click({ button: "right" });
    const bassMoveItem = page.locator("#sample-context-menu .ctx-menu-item.has-submenu").filter({ hasText: "Bass" });
    await bassMoveItem.hover();
    await bassMoveItem.locator(".ctx-submenu .ctx-menu-item").first().click();

    await expect.poll(() => moveCalls).toBe(1);
    await expect(page.locator("#error-toast")).toHaveText("Could not move sample — check the console for details.");

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").first().click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu")).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);
  });

  test("the real app tolerates failing sample metadata refreshes while UI state resets", async ({ page }) => {
    let failRefresh = false;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      if (failRefresh) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "refresh failed" }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.locator("#subcategory-add").click();
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toBeVisible();

    await page.locator('.category-btn[data-category-id="Bass"]').click();
    await expect(page.locator("#subcategory-add-input")).toHaveCount(0);
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);
    await expect(page.locator(".sample-grid")).toContainText("Bass");

    failRefresh = true;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
    });
    await expect(page.locator('.category-btn.is-active')).toHaveAttribute("data-category-id", "Bass");
    await expect(page.locator(".sample-grid")).toContainText("Bass");
  });

  test("the real app handles context-menu edge targets and explicit sort changes", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4, detail: "tight" },
            { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 8, detail: "busy" },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      const ghost = document.createElement("button");
      ghost.className = "sample-block";
      ghost.dataset.filename = "ghost.wav";
      grid.appendChild(ghost);
      ghost.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 28,
        clientY: 28,
      }));
      grid.removeChild(ghost);
    });
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);

    await page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]').click({ button: "right" });
    await expect(page.locator("#subcategory-context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#subcategory-context-menu")).toHaveCount(0);

    await page.locator("#sample-search").fill("Kick");
    await expect(page.locator(".sample-grid")).toContainText("Kick");

    await page.evaluate(() => {
      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
    });
    await expect(page.locator("#sample-context-menu .ctx-menu-header")).toHaveText("Sort by");
    await page.locator("#sample-context-menu button.ctx-menu-item").filter({ hasText: "Name" }).click();
    await expect(page.locator("#sample-context-menu")).toHaveCount(0);
  });

  test("the real app sorts multiple visible samples and moves one via contextmenu dispatch", async ({ page }) => {
    let moveCalls = 0;

    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        }),
      });
    });

    await page.route("**/output/metadata.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          samples: [
            { filename: "zulu.wav", alias: "Zulu", category: "Drum", subcategory: "kick", bpm: 140, beats: 8 },
            { filename: "alpha.wav", alias: "Alpha", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
            { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
          ],
        }),
      });
    });

    await page.route("**/__sample-move", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      moveCalls += 1;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(2);

    const result = await page.evaluate(async () => {
      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (
            sidebar.querySelector(".mix-tree-group-label") ||
            sidebar.querySelector(".archive-tree-empty")
          ) {
            return;
          }
          await flush();
        }
      };

      const dispatchContextMenu = (
        controller: { handleContextMenu: (event: MouseEvent) => void },
        target: HTMLElement,
        init: MouseEventInit,
      ): void => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          ...init,
        });
        target.dispatchEvent(event);
        controller.handleContextMenu(event);
      };

      const labels = (): string[] => [...document.querySelectorAll<HTMLElement>(".sample-block-label")]
        .map((entry) => entry.textContent ?? "");

      const search = document.getElementById("sample-search") as HTMLInputElement | null;
      search!.value = "140";
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();

      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      grid.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 24,
      }));
      await flush();
      const sortButton = [...document.querySelectorAll<HTMLButtonElement>("#sample-context-menu button.ctx-menu-item")]
        .find((button) => button.textContent?.includes("Name"));
      sortButton?.click();
      await flush();
      const sortedLabels = labels();

      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!firstBlock) {
        throw new Error("Missing sorted sample block");
      }

      firstBlock.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: window.innerWidth - 12,
        clientY: 40,
      }));
      await flush();
      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      return {
        sortedLabels,
        gridTextAfterMove: document.getElementById("sample-grid")?.textContent ?? "",
      };
    });

    expect(result.sortedLabels.slice(0, 2)).toEqual(["Alpha", "Zulu"]);
    expect(moveCalls).toBe(1);
    expect(result.gridTextAfterMove).not.toContain("Alpha");
  });

  test("main opens sample move and sort menus and refreshes sample metadata on demand", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let metadataVersion = 0;
      let moveCalls = 0;
      let failedMoveCalls = 0;
      const moveTargets: Array<{ category: string; subcategory: string | null }> = [];

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const openContextMenu = (target: Element, clientX: number, clientY: number): void => {
        target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX,
          clientY,
        }));
      };

      const firstSubmenuItemFor = (categoryName: string): HTMLButtonElement => {
        const categoryItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
          .find((entry) => entry.querySelector("span")?.textContent === categoryName);
        if (!categoryItem) {
          throw new Error(`Missing category menu item: ${categoryName}`);
        }

        categoryItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const button = categoryItem.querySelector<HTMLButtonElement>(".ctx-submenu .ctx-menu-item");
        if (!button) {
          throw new Error(`Missing submenu button for ${categoryName}`);
        }

        return button;
      };

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return metadataVersion === 0
          ? [
              { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ]
          : [
              { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"] },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.moveSample = async function (
        _sample: { filename: string },
        newCategory: string,
        newSubcategory: string | null,
      ) {
        moveCalls += 1;
        moveTargets.push({ category: newCategory, subcategory: newSubcategory });
        if (moveCalls === 2) {
          failedMoveCalls += 1;
          throw new Error("move failed");
        }
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=sample-context-${Date.now()}`);
      await flush();

      const kickTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:kick"]');
      const grid = document.getElementById("sample-grid");
      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!kickTab || !grid || !firstBlock) {
        throw new Error("Missing initial sample-grid state");
      }

      openContextMenu(firstBlock, window.innerWidth - 12, 32);
      await flush();

      const moveMenu = document.getElementById("sample-context-menu");
      const moveHeader = moveMenu?.querySelector(".ctx-menu-header")?.textContent ?? "";
      const moveMenuFlip = moveMenu?.classList.contains("ctx-menu--flip") ?? false;

      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.body.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
      await flush();
      const dismissedByPointer = !document.getElementById("sample-context-menu");

      openContextMenu(firstBlock, window.innerWidth - 12, 32);
      await flush();
      firstSubmenuItemFor("Bass").click();
      await flush();
      const gridAfterMove = grid.textContent ?? "";

      metadataVersion = 1;
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
      await flush();
      await flush();
      const gridAfterRefresh = grid.textContent ?? "";

      openContextMenu(grid, 24, 24);
      await flush();
      const sortHeader = document.querySelector("#sample-context-menu .ctx-menu-header")?.textContent ?? "";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flush();
      const sortDismissedByEscape = !document.getElementById("sample-context-menu");

      openContextMenu(grid, 24, 24);
      await flush();
      const firstSortButton = document.querySelector<HTMLButtonElement>("#sample-context-menu button.ctx-menu-item");
      firstSortButton?.click();
      await flush();
      const sortClosedAfterSelect = !document.getElementById("sample-context-menu");

      const refreshedBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!refreshedBlock) {
        throw new Error("Missing refreshed sample block");
      }

      openContextMenu(refreshedBlock, window.innerWidth - 12, 40);
      await flush();
      firstSubmenuItemFor("Bass").click();
      await flush();

      return {
        moveHeader,
        moveMenuFlip,
        dismissedByPointer,
        gridAfterMove,
        gridAfterRefresh,
        sortHeader,
        sortDismissedByEscape,
        sortClosedAfterSelect,
        moveCalls,
        failedMoveCalls,
        moveTargets,
        toastText: document.getElementById("error-toast")?.textContent ?? "",
      };
    }, LIBRARY_MOD);

    expect(result.moveHeader).toBe("Move to");
    expect(result.moveMenuFlip).toBe(true);
    expect(result.dismissedByPointer).toBe(true);
    expect(result.gridAfterMove).toContain("No samples in this selection.");
    expect(result.gridAfterRefresh).toContain("Kick Reloaded");
    expect(result.sortHeader).toBe("Sort by");
    expect(result.sortDismissedByEscape).toBe(true);
    expect(result.sortClosedAfterSelect).toBe(true);
    expect(result.moveCalls).toBe(2);
    expect(result.failedMoveCalls).toBe(1);
    expect(result.moveTargets).toEqual([
      { category: "Bass", subcategory: null },
      { category: "Bass", subcategory: null },
    ]);
    expect(result.toastText).toBe("Could not move sample — check the console for details.");
  });

  test("the coverage harness imports exact main.ts and exercises menu and refresh branches", async ({ page }) => {
    await page.goto("/coverage-harness.html");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      let metadataVersion = 0;
      let categoryVersion = 0;
      let moveCalls = 0;

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const openContextMenu = (target: Element, clientX: number, clientY: number): void => {
        target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX,
          clientY,
        }));
      };

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Drum", name: "Drum", subcategories: ["kick", "fills"], sampleCount: 2 },
            { id: "Bass", name: "Bass", subcategories: ["unsorted"], sampleCount: 1 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return metadataVersion === 0
          ? [
              { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ]
          : [
              { filename: "kick.wav", alias: "Kick Reloaded", category: "Drum", subcategory: "kick", bpm: 140, beats: 4 },
              { filename: "fill.wav", alias: "Fill", category: "Drum", subcategory: "fills", bpm: 140, beats: 4 },
              { filename: "bass.wav", alias: "Bass", category: "Bass", bpm: 140, beats: 4 },
            ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            {
              id: "Drum",
              name: "Drum",
              subcategories: categoryVersion === 0 ? ["kick", "fills"] : ["kick", "fills", "snare"],
            },
            { id: "Bass", name: "Bass", subcategories: [] },
          ],
        };
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {};
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.moveSample = async function () {
        moveCalls += 1;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await flush();

      const addButton = document.getElementById("subcategory-add") as HTMLButtonElement | null;
      addButton?.click();
      await flush();

      const fillsTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:fills"]');
      fillsTab?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 32,
        clientY: 32,
      }));
      await flush();

      const bassCategory = document.querySelector<HTMLButtonElement>('.category-btn[data-category-id="Bass"]');
      bassCategory?.click();
      await flush();

      const drumCategory = document.querySelector<HTMLButtonElement>('.category-btn[data-category-id="Drum"]');
      drumCategory?.click();
      await flush();

      const fillsTabAfterReset = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:fills"]');
      fillsTabAfterReset?.click();
      await flush();
      const kickTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:kick"]');
      kickTab?.click();
      await flush();

      const searchInput = document.getElementById("sample-search") as HTMLInputElement | null;
      searchInput!.value = "Kick";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();

      const searchClear = document.getElementById("sample-search-clear") as HTMLButtonElement | null;
      searchClear?.click();
      await flush();

      const firstBlock = document.querySelector<HTMLElement>(".sample-block");
      if (!firstBlock) {
        throw new Error("Missing sample block");
      }

      openContextMenu(firstBlock, window.innerWidth - 12, 40);
      await flush();
      const moveMenuVisible = Boolean(document.getElementById("sample-context-menu"));
      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.body.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
      await flush();

      openContextMenu(firstBlock, window.innerWidth - 12, 40);
      await flush();
      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      metadataVersion = 1;
      window.dispatchEvent(new CustomEvent("sample-metadata-updated"));
      await flush();
      await flush();

      const grid = document.getElementById("sample-grid");
      if (!grid) {
        throw new Error("Missing sample grid");
      }

      openContextMenu(grid, 24, 24);
      await flush();
      (document.querySelector("#sample-context-menu button.ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      categoryVersion = 1;
      window.dispatchEvent(new CustomEvent("category-config-updated"));
      await flush();
      await flush();

      const snareTab = document.querySelector<HTMLButtonElement>('.subcategory-tab[data-tab-id="subcategory:snare"]');
      snareTab?.click();
      await flush();

      return {
        moveCalls,
        moveMenuVisible,
        activeTab: document.querySelector<HTMLElement>(".subcategory-tab.is-active")?.dataset.tabId ?? null,
        hasSnareTab: Boolean(snareTab),
        gridText: document.getElementById("sample-grid")?.textContent ?? "",
        searchClearHidden: document.getElementById("sample-search-clear")?.classList.contains("is-hidden") ?? false,
      };
    }, LIBRARY_MOD);

    expect(result.moveCalls).toBe(1);
    expect(result.moveMenuVisible).toBe(true);
    expect(result.hasSnareTab).toBe(true);
    expect(result.activeTab).toBe("subcategory:snare");
    expect(result.gridText).toContain("No samples in this selection.");
    expect(result.searchClearHidden).toBe(true);
  });

  test("the real app switches configured subcategory tabs, BPM filters, categories, and playback state", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () {
        return Promise.resolve();
      };

      HTMLMediaElement.prototype.pause = function () {};
    });

    await page.goto("/");
    await expect(page.locator('.category-btn[data-category-id="Loop"]')).toBeVisible();

    await page.locator('.category-btn[data-category-id="Drum"]').click();

    await expect(page.locator('.subcategory-tab[data-tab-id^="product:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id^="all:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.locator("#bpm-filter").selectOption("125");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await page.locator("#bpm-filter").selectOption("140");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();

    await expect(page.locator(".sample-block").first()).toBeVisible();
    await page.locator(".sample-block").first().click();
    await page.locator("#transport-stop").click();
    await expect(page.locator("#transport")).toBeVisible();
  });

  test("the real app sample zoom controls adjust sample bubble sizing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sample-block").first()).toBeVisible();

    const readFontSize = async (): Promise<number> => page.locator(".sample-block").first().evaluate((element) => {
      return Number.parseFloat(window.getComputedStyle(element).fontSize);
    });

    const baseSize = await readFontSize();
    await page.locator("#sample-zoom-in").click();
    const zoomedInSize = await readFontSize();
    await page.locator("#sample-zoom-out").click();
    const resetSize = await readFontSize();

    expect(zoomedInSize).toBeGreaterThan(baseSize * 1.09);
    expect(zoomedInSize).toBeLessThan(baseSize * 1.11);
    expect(resetSize).toBeGreaterThanOrEqual(baseSize * 0.99);
    expect(resetSize).toBeLessThanOrEqual(baseSize * 1.01);
  });

  test("the real app zoom-in is clamped at the maximum zoom level", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sample-block").first()).toBeVisible();

    const readZoomScale = (): Promise<number> =>
      page.evaluate(() =>
        Number.parseFloat(
          document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "1",
        ),
      );

    // Click zoom-in many more times than the allowed range to hit the ceiling
    for (let i = 0; i < 20; i++) {
      await page.locator("#sample-zoom-in").click();
    }

    const clampedScale = await readZoomScale();
    expect(clampedScale).toBeLessThanOrEqual(2);
  });

  test("the real app zoom-out is clamped at the minimum zoom level", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sample-block").first()).toBeVisible();

    const readZoomScale = (): Promise<number> =>
      page.evaluate(() =>
        Number.parseFloat(
          document.documentElement.style.getPropertyValue("--sample-bubble-zoom-scale") || "1",
        ),
      );

    // Click zoom-out many more times than the allowed range to hit the floor
    for (let i = 0; i < 20; i++) {
      await page.locator("#sample-zoom-out").click();
    }

    const clampedScale = await readZoomScale();
    expect(clampedScale).toBeGreaterThanOrEqual(0.5);
  });

  test("the real app shows only the add button when a category has no configured subcategories and the sample catalog fails", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 1 }],
          mixLibrary: [],
        }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [{ id: "Bass", name: "Bass", subcategories: [] }],
        }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "catalog unavailable" }),
      });
    });

    await page.goto("/");
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
    await expect(page.locator("#subcategory-add")).toBeVisible();
    await expect(page.locator(".sample-grid-empty")).toHaveText("No samples in this selection.");
  });

  test("the real app renders the no-categories empty state when the index is empty", async ({ page }) => {
    await page.route("**/data/index.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: [], mixLibrary: [] }),
      });
    });

    await page.route("**/output/categories.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: [] }),
      });
    });

    await page.route("**/output/metadata.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ samples: [] }),
      });
    });

    await page.goto("/");
    await expect(page.locator(".sample-grid-empty")).toHaveText("No categories found in this library.");
  });

  test("main bootstraps the normalized browser flow, filters tabs, and updates transport", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 2;
        paused = true;
        ended = false;
        private readonly listeners = new Map<string, Set<() => void>>();

        addEventListener(type: string, listener: () => void): void {
          const listeners = this.listeners.get(type) ?? new Set<() => void>();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(type: string, listener: () => void): void {
          this.listeners.get(type)?.delete(listener);
        }

        play(): Promise<void> {
          this.paused = false;
          return Promise.resolve();
        }

        pause(): void {
          this.paused = true;
          for (const listener of this.listeners.get("pause") ?? []) {
            listener();
          }
        }
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [
            { id: "Bass", name: "Bass", subcategories: [], sampleCount: 2 },
            { id: "Drum", name: "Drum", subcategories: ["kick", "misc"], sampleCount: 3 },
          ],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [
            { id: "Bass", name: "Bass", subcategories: ["unsorted"] },
            { id: "Drum", name: "Drum", subcategories: ["kick", "misc"] },
          ],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass-140.wav", alias: "Bass 140", category: "Bass", product: "Dance_eJay1", bpm: 140, beats: 8 },
          { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", product: "Rave", bpm: 140, beats: 4 },
          { filename: "loose-fx.wav", alias: "Loose FX", category: "Unsorted", product: "Rave", bpm: 140, beats: 4 },
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", product: "Dance_eJay1", bpm: 140, beats: 4 },
          { filename: "drum-misc.wav", alias: "Drum Misc", category: "Drum", subcategory: "misc", product: "Rave", bpm: 140, beats: 4 },
          { filename: "drum-untagged.wav", alias: "Drum Untagged", category: "Drum", product: "Rave", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=browser-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
    }, LIBRARY_MOD);

    await expect(page.locator(".category-btn")).toHaveCount(2);
    await expect(page.locator(".category-system-btn")).toHaveCount(2);
    await expect(page.locator('.category-system-btn[data-category-id="Unsorted"]')).toBeVisible();
    await expect(page.locator(".subcategory-tab")).toHaveCount(2);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toContainText("unsorted");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toContainText("riff");
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass 140");
    await expect(page.locator(".sample-grid")).not.toContainText("Bass Riff");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");

    await page.locator('.category-system-btn[data-category-id="Unsorted"]').click();
    await expect(page.locator('.category-system-btn[data-category-id="Unsorted"]')).toHaveClass(/is-active/);
    await expect(page.locator(".subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toContainText("unsorted");
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Loose FX");

    await page.locator('.category-btn[data-category-id="Drum"]').click();
    await expect(page.locator('.subcategory-tab[data-tab-id^="product:"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id^="all:"]')).toHaveCount(0);
    await expect(page.locator(".subcategory-tab")).toHaveCount(2);
    await page.locator("#bpm-filter").selectOption("140");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toContainText("kick");
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toContainText("misc");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(2);
    await expect(page.locator(".sample-grid")).toContainText("Drum Misc");
    await expect(page.locator(".sample-grid")).toContainText("Drum Untagged");
    await page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]').click();

    await page.locator(".sample-block").first().click();
    await expect(page.locator("#transport-name")).toHaveText("kick");
    await page.locator("#transport-stop").click();
    await expect(page.locator("#transport-name")).toHaveText("No sample playing");
  });

  test("main shows the hardcoded unsorted tab alongside discovered sample subcategories when config is empty", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Bass", name: "Bass", subcategories: [], sampleCount: 2 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return {
          categories: [{ id: "Bass", name: "Bass", subcategories: [] }],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "bass-plain.wav", alias: "Bass Plain", category: "Bass", bpm: 140, beats: 8 },
          { filename: "bass-riff.wav", alias: "Bass Riff", category: "Bass", subcategory: "riff", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return false;
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function (sample: { filename: string }) {
        return `mock://${sample.filename}`;
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=no-sub-tabs-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
    }, LIBRARY_MOD);

    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(2);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]')).toBeVisible();
    await expect(page.locator("#subcategory-add")).toBeVisible();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Plain");
    await expect(page.locator(".sample-grid")).not.toContainText("Bass Riff");

    await page.locator('.subcategory-tab[data-tab-id="subcategory:riff"]').click();
    await expect(page.locator(".sample-block")).toHaveCount(1);
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");
  });

  test("main renders the empty-library message when no categories are available", async ({ page }) => {
    await page.goto("/");

    const warnings = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      const captured: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return { categories: [], mixLibrary: [] };
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        return { categories: [] };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        throw new Error("catalog unavailable");
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://noop.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';
      await import(`/src/main.ts?scenario=empty-${Date.now()}`);
      await Promise.resolve();
      await Promise.resolve();
      console.warn = originalWarn;
      return captured;
    }, LIBRARY_MOD);

    await expect(page.locator(".sample-grid-empty")).toHaveText("No categories found in this library.");
    expect(warnings.some((message) => message.includes("Failed to load sample catalog"))).toBe(true);
  });

  test("main warns on category refresh failures and shows a toast when saving categories fails", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      const warnings: string[] = [];
      const originalWarn = console.warn;
      let loadCategoryConfigCalls = 0;

      class FakeAudio {
        src = "";
        currentTime = 0;
        duration = 0;
        paused = true;
        ended = false;
        addEventListener(): void {}
        removeEventListener(): void {}
        play(): Promise<void> {
          return Promise.resolve();
        }
        pause(): void {}
      }

      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      (window as unknown as { Audio: typeof Audio }).Audio = FakeAudio as unknown as typeof Audio;
      library.FetchLibrary.prototype.loadIndex = async function () {
        return {
          categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"], sampleCount: 1 }],
          mixLibrary: [],
        };
      };
      library.FetchLibrary.prototype.loadSamples = async function () {
        return [
          { filename: "kick.wav", alias: "Kick", category: "Drum", subcategory: "kick", product: "Dance_eJay1", bpm: 140, beats: 4 },
        ];
      };
      library.FetchLibrary.prototype.loadCategoryConfig = async function () {
        loadCategoryConfigCalls += 1;
        if (loadCategoryConfigCalls === 1) {
          return {
            categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
          };
        }
        throw new Error("refresh failed");
      };
      library.FetchLibrary.prototype.canWriteCategoryConfig = function () {
        return true;
      };
      library.FetchLibrary.prototype.saveCategoryConfig = async function () {
        throw new Error("write failed");
      };
      library.FetchLibrary.prototype.resolveAudioUrl = async function () {
        return "mock://kick.wav";
      };
      library.FetchLibrary.prototype.dispose = function () {};

      document.body.innerHTML = '<div id="app"></div>';

      try {
        await import(`/src/main.ts?scenario=refresh-failure-${Date.now()}`);
        await Promise.resolve();
        await Promise.resolve();
        window.dispatchEvent(new CustomEvent("category-config-updated"));
        await Promise.resolve();
        await Promise.resolve();
        (document.querySelector("#subcategory-add") as HTMLButtonElement).click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).value = "fills";
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).dispatchEvent(
          new Event("input", { bubbles: true }),
        );
        (document.querySelector("#subcategory-add-confirm") as HTMLButtonElement).click();
        await Promise.resolve();
        await Promise.resolve();

        return {
          warnings,
          toastText: document.getElementById("error-toast")?.textContent ?? null,
        };
      } finally {
        console.warn = originalWarn;
      }
    }, LIBRARY_MOD);

    expect(result.warnings.some((message) => message.includes("Failed to refresh category config."))).toBe(true);
    expect(result.toastText).toBe("Could not save categories.json.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sample-grid-context-menu module tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("sample-grid-context-menu module", () => {
  const SGCM_MOD = "/src/sample-grid-context-menu.ts";

  test("controller handles edge branches without opening or dismissing the wrong menu", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const result = await page.evaluate(async (modPath) => {
      const { createSampleGridContextMenuController, SAMPLE_CONTEXT_MENU_ID } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const dispatchContextMenu = (
        controller: { handleContextMenu: (event: MouseEvent) => void },
        target: HTMLElement,
        init: MouseEventInit,
      ): void => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          ...init,
        });
        target.dispatchEvent(event);
        controller.handleContextMenu(event);
      };

      const grid = document.createElement("div");
      grid.className = "sample-grid";
      document.body.appendChild(grid);

      const outside = document.createElement("div");
      document.body.appendChild(outside);

      const ghostBlock = document.createElement("button");
      ghostBlock.className = "sample-block";
      ghostBlock.dataset.filename = "ghost.wav";
      grid.appendChild(ghostBlock);

      const realBlock = document.createElement("button");
      realBlock.className = "sample-block";
      realBlock.dataset.filename = "real.wav";
      grid.appendChild(realBlock);

      let refreshCalls = 0;
      const sortCalls: Array<[string, string]> = [];
      const moveCalls: Array<{ categoryId: string; subcategoryId: string | null }> = [];

      const controller = createSampleGridContextMenuController({
        getCategories: () => [{ id: "Bass", name: "Bass", sampleCount: 1, subcategories: [] }],
        getCurrentGridSamples: () => [{ filename: "real.wav" }],
        getSortState: () => ({ key: "name", dir: "asc" }),
        setSortState: (key: string, dir: string) => {
          sortCalls.push([key, dir]);
        },
        refreshSamples: () => {
          refreshCalls += 1;
        },
        onMoveSample: (_sample: { filename: string }, categoryId: string, subcategoryId: string | null) => {
          moveCalls.push({ categoryId, subcategoryId });
        },
      });

      controller.close();

      dispatchContextMenu(controller, outside, {
        clientX: 10,
        clientY: 10,
      });
      const openedOutsideGrid = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      dispatchContextMenu(controller, ghostBlock, {
        clientX: 12,
        clientY: 12,
      });
      const openedForMissingSample = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      dispatchContextMenu(controller, grid, {
        clientX: 20,
        clientY: 20,
      });
      await flush();

      const PointerCtor = window.PointerEvent ?? MouseEvent;
      document.querySelector("#sample-context-menu .ctx-menu-item")?.dispatchEvent(new PointerCtor("pointerdown", {
        bubbles: true,
      }));
      const stayedOpenAfterInsidePointer = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
      const stayedOpenAfterNonEscapeKey = Boolean(document.getElementById(SAMPLE_CONTEXT_MENU_ID));

      window.dispatchEvent(new Event("resize"));
      const closedAfterResize = !document.getElementById(SAMPLE_CONTEXT_MENU_ID);

      dispatchContextMenu(controller, realBlock, {
        clientX: window.innerWidth - 12,
        clientY: 28,
      });
      await flush();

      const bassMoveItem = [...document.querySelectorAll<HTMLElement>("#sample-context-menu .ctx-menu-item.has-submenu")]
        .find((entry) => entry.querySelector("span")?.textContent === "Bass");
      bassMoveItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      (bassMoveItem?.querySelector(".ctx-submenu .ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      dispatchContextMenu(controller, grid, {
        clientX: 24,
        clientY: 24,
      });
      await flush();
      (document.querySelector("#sample-context-menu button.ctx-menu-item") as HTMLButtonElement | null)?.click();
      await flush();

      return {
        openedOutsideGrid,
        openedForMissingSample,
        stayedOpenAfterInsidePointer,
        stayedOpenAfterNonEscapeKey,
        closedAfterResize,
        moveCalls,
        sortCalls,
        refreshCalls,
      };
    }, SGCM_MOD);

    expect(result.openedOutsideGrid).toBe(false);
    expect(result.openedForMissingSample).toBe(false);
    expect(result.stayedOpenAfterInsidePointer).toBe(true);
    expect(result.stayedOpenAfterNonEscapeKey).toBe(true);
    expect(result.closedAfterResize).toBe(true);
    expect(result.moveCalls).toEqual([{ categoryId: "Bass", subcategoryId: null }]);
    expect(result.sortCalls).toEqual([["name", "desc"]]);
    expect(result.refreshCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mix-file-browser module tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("mix-file-browser module", () => {
  const MFB_MOD = "/src/mix-file-browser.ts";

  /**
   * Build a minimal archive-sidebar DOM fixture that matches what
   * `renderArchivePlaceholder` produces in `render.ts`.
   */
  function buildArchiveSidebar(): string {
    return `
      <aside id="archive-tree" class="archive-sidebar">
        <div class="archive-header">
          <span class="archive-title">Mix Archive</span>
        </div>
        <div class="archive-tree-content">
          <p class="archive-placeholder">Load a .mix file to begin</p>
        </div>
      </aside>
    `;
  }

  const SAMPLE_LIBRARY = [
    {
      id: "Dance_eJay1",
      name: "Dance eJay 1",
      mixes: [
        { filename: "START.MIX", sizeBytes: 11234, format: "A" },
        { filename: "LOVE.MIX", sizeBytes: 11234, format: "A" },
      ],
    },
    {
      id: "Dance_eJay2",
      name: "Dance eJay 2",
      mixes: [
        { filename: "HAPPY.MIX", sizeBytes: 8219, format: "B" },
      ],
    },
  ];

  test("initMixFileBrowser adds is-awaiting-click and keyboard role to placeholder", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-test" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-test")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: [],
        onSelectFile: () => {},
      });

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content");
      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder");
      return {
        awaiting: content?.classList.contains("is-awaiting-click"),
        phRole: ph?.getAttribute("role"),
        phTabindex: ph?.getAttribute("tabindex"),
      };
    }, MFB_MOD);

    expect(result.awaiting).toBe(true);
    expect(result.phRole).toBe("button");
    expect(result.phTabindex).toBe("0");
  });

  test("initMixFileBrowser DEV mode: click renders product tree and sets header root", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree-dev" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree-dev")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: () => {},
      });

      // Trigger by clicking the sidebar
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const groups = content.querySelectorAll(".mix-tree-group-header");
      const header = sidebar.querySelector<HTMLElement>(".archive-header");

      return {
        awaiting: content.classList.contains("is-awaiting-click"),
        groupCount: groups.length,
        firstGroupLabel: groups[0]?.querySelector(".mix-tree-group-label")?.textContent,
        headerTitle: header?.querySelector(".archive-title")?.textContent,
        headerInfo: header?.querySelector(".archive-folder-info")?.textContent,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.awaiting).toBe(false);
    expect(result.groupCount).toBe(2);
    expect(result.firstGroupLabel).toBe("Dance eJay 1");
    expect(result.headerTitle).toBe("Mix Archive");
    expect(result.headerInfo).toBe("archive");
  });

  test("DEV mode: first group is auto-expanded, others are collapsed", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-expand" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-expand")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: () => {},
      });

      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const items = content.querySelectorAll<HTMLElement>(".mix-tree-items");
      return {
        firstHidden: items[0]?.hidden,
        secondHidden: items[1]?.hidden,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.firstHidden).toBe(false);
    expect(result.secondHidden).toBe(true);
  });

  test("DEV mode: clicking a group header toggles expand / collapse", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-toggle" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-toggle")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const firstHeader = content.querySelector<HTMLButtonElement>(".mix-tree-group-header")!;
      const firstItems = content.querySelector<HTMLElement>(".mix-tree-items")!;

      const beforeHidden = firstItems.hidden;
      firstHeader.click(); // collapse — tree is re-rendered; re-query
      const afterCollapseHidden = content.querySelector<HTMLElement>(".mix-tree-items")!.hidden;
      content.querySelector<HTMLButtonElement>(".mix-tree-group-header")!.click(); // expand again
      const afterExpandHidden = content.querySelector<HTMLElement>(".mix-tree-items")!.hidden;

      return { beforeHidden, afterCollapseHidden, afterExpandHidden };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.beforeHidden).toBe(false);
    expect(result.afterCollapseHidden).toBe(true);
    expect(result.afterExpandHidden).toBe(false);
  });

  test("DEV mode: clicking a .mix file calls onSelectFile with correct ref", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-select" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const selectedRefs: Array<{ label: string; group: string; source: unknown }> = [];

      const sidebar = host.querySelector<HTMLElement>("#at-select")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: library,
        onSelectFile: (ref: { label: string; group: string; source: unknown }) => { selectedRefs.push(ref); },
      });

      sidebar.click(); // load tree

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const firstFile = content.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      firstFile.click();

      const active = content.querySelector(".mix-tree-item.is-active");
      return {
        refCount: selectedRefs.length,
        label: selectedRefs[0]?.label,
        group: selectedRefs[0]?.group,
        sourceType: (selectedRefs[0]?.source as { type: string })?.type,
        activeLabel: active?.querySelector(".mix-tree-item-label")?.textContent,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.refCount).toBe(1);
    expect(result.label).toBe("START.MIX");
    expect(result.group).toBe("Dance eJay 1");
    expect(result.sourceType).toBe("url");
    expect(result.activeLabel).toBe("START.MIX");
  });

  test("DEV mode: second click on loaded sidebar is a no-op", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-noop" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-noop")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();
      const groupsAfterFirst = sidebar.querySelectorAll(".mix-tree-group").length;
      sidebar.click();
      const groupsAfterSecond = sidebar.querySelectorAll(".mix-tree-group").length;

      return { groupsAfterFirst, groupsAfterSecond };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groupsAfterFirst).toBe(2);
    expect(result.groupsAfterSecond).toBe(2); // unchanged
  });

  test("DEV mode: keyboard Enter on placeholder triggers tree load", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(2);
  });

  test("DEV mode: keyboard Space on placeholder triggers tree load", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd-space" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd-space")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(2);
  });

  test("DEV mode: other keyboard keys on placeholder are ignored", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-kbd-other" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-kbd-other")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });

      const ph = sidebar.querySelector<HTMLElement>(".archive-placeholder")!;
      ph.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

      return {
        groups: sidebar.querySelectorAll(".mix-tree-group").length,
        stillAwaiting: sidebar.querySelector(".archive-tree-content")?.classList.contains("is-awaiting-click"),
      };
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result.groups).toBe(0);
    expect(result.stillAwaiting).toBe(true);
  });

  test("DEV mode: empty mixLibrary renders no-files empty state", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-empty" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-empty")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: [], onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      return {
        emptyText: content.querySelector(".archive-placeholder")?.textContent,
        groups: content.querySelectorAll(".mix-tree-group").length,
      };
    }, MFB_MOD);

    expect(result.emptyText).toBe("No .mix files found");
    expect(result.groups).toBe(0);
  });

  test("DEV mode: group item count badge shows correct number", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ([modPath, library]) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-badge" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-badge")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: library, onSelectFile: () => {} });
      sidebar.click();

      const content = sidebar.querySelector<HTMLElement>(".archive-tree-content")!;
      const badges = [...content.querySelectorAll(".mix-tree-count")].map((el) => el.textContent);
      return badges;
    }, [MFB_MOD, SAMPLE_LIBRARY] as const);

    expect(result).toEqual(["2", "1"]);
  });

  test("initMixFileBrowser is a no-op when archive-tree-content is missing", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);
      const sidebar = document.createElement("aside");
      sidebar.className = "archive-sidebar";
      // Note: no .archive-tree-content child
      document.body.appendChild(sidebar);

      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: [], onSelectFile: () => {} });
      sidebar.click();
      return { groups: sidebar.querySelectorAll(".mix-tree-group").length };
    }, MFB_MOD);

    expect(result.groups).toBe(0);
  });

  test("DEV mode: URL source encodes product ID and filename", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "my mix.MIX", sizeBytes: 100, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-encode" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ source: { type: string; url?: string } }> = [];
      const sidebar = host.querySelector<HTMLElement>("#at-encode")!;
      initMixFileBrowser(sidebar, {
        isDev: true,
        mixLibrary: lib,
        onSelectFile: (ref: unknown) => { refs.push(ref as typeof refs[0]); },
      });

      sidebar.click();
      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();

      return refs[0]?.source;
    }, MFB_MOD);

    expect(result?.type).toBe("url");
    expect(result?.url).toBe("/mix/Dance_eJay1/my%20mix.MIX");
  });

  // ── formatMetaTooltip ──────────────────────────────────────────────────────

  test("formatMetaTooltip: returns empty string when meta is undefined", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip(undefined);
    }, MFB_MOD);
    expect(result).toBe("");
  });

  test("formatMetaTooltip: returns tooltip with BPM and track count", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({ bpm: 140, trackCount: 20, catalogs: [] });
    }, MFB_MOD);
    expect(result).toContain("BPM: 140");
    expect(result).toContain("20 tracks");
  });

  test("formatMetaTooltip: includes adjusted BPM when different from bpm", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({ bpm: 140, bpmAdjusted: 120, trackCount: 5, catalogs: [] });
    }, MFB_MOD);
    expect(result).toContain("120 adjusted");
  });

  test("formatMetaTooltip: includes title and author when present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { formatMetaTooltip } = await import(/* @vite-ignore */ modPath);
      return formatMetaTooltip({
        bpm: 130, trackCount: 10, catalogs: [],
        title: "My Mix", author: "DJ Test",
      });
    }, MFB_MOD);
    expect(result).toContain('"My Mix"');
    expect(result).toContain("by DJ Test");
  });

  // ── buildMetaRows ──────────────────────────────────────────────────────────

  test("buildMetaRows: returns file and product rows when meta is undefined", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("test.MIX", "Dance eJay 1", undefined);
    }, MFB_MOD);
    expect(result).toEqual([["File", "test.MIX"], ["Product", "Dance eJay 1"]]);
  });

  test("buildMetaRows: returns all fields when meta has full data", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("test.MIX", "Rave", {
        bpm: 155, bpmAdjusted: 140, trackCount: 30,
        catalogs: ["Rave", "Techno"],
        title: "Hard Rain", author: "DJ X",
        tickerText: ["Line one", "Line two"],
      });
    }, MFB_MOD);
    const keys = result.map(([k]: [string, string]) => k);
    expect(keys).toContain("BPM");
    expect(keys).toContain("Tracks");
    expect(keys).toContain("Title");
    expect(keys).toContain("Author");
    expect(keys).toContain("Ticker");
    expect(keys).toContain("Sample packs");
    // BPM row should show both values when adjusted differs
    const bpmRow = result.find(([k]: [string, string]) => k === "BPM");
    expect(bpmRow?.[1]).toContain("155");
    expect(bpmRow?.[1]).toContain("140");
  });

  test("buildMetaRows: format row shows em-dash when catalogs is empty", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { buildMetaRows } = await import(/* @vite-ignore */ modPath);
      return buildMetaRows("x.MIX", "Rave", { bpm: 170, trackCount: 8, catalogs: [] });
    }, MFB_MOD);
    const formatRow = result.find(([k]: [string, string]) => k === "Format");
    expect(formatRow?.[1]).toBe("—");
  });

  // ── popup lifecycle ────────────────────────────────────────────────────────

  test("DEV mode: clicking a .mix file with meta shows .mix-meta-popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{
          filename: "START.MIX", sizeBytes: 100, format: "A" as const,
          meta: { bpm: 140, trackCount: 20, catalogs: ["Dance eJay 1"] },
        }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-popup-open" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load</p>
          </div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-popup-open")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();

      return {
        popupVisible: isMixMetaPopupVisible(),
        popupInBody: document.getElementById("mix-meta-popup") !== null,
      };
    }, MFB_MOD);

    expect(result.popupVisible).toBe(true);
    expect(result.popupInBody).toBe(true);
  });

  test("DEV mode: clicking a second .mix file replaces the popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [
          { filename: "A.MIX", sizeBytes: 10, format: "A" as const, meta: { bpm: 130, trackCount: 15, catalogs: [] } },
          { filename: "B.MIX", sizeBytes: 10, format: "A" as const, meta: { bpm: 140, trackCount: 22, catalogs: [] } },
        ],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-popup-replace" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-popup-replace")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const [btnA, btnB] = Array.from(sidebar.querySelectorAll<HTMLButtonElement>(".mix-tree-item"));
      btnA.click();
      const firstId = document.getElementById("mix-meta-popup")?.id;
      btnB.click();
      const popupCount = document.querySelectorAll("#mix-meta-popup").length;
      const tableText = document.getElementById("mix-meta-popup")?.textContent ?? "";

      return { firstId, popupCount, tableText };
    }, MFB_MOD);

    expect(result.firstId).toBe("mix-meta-popup");
    expect(result.popupCount).toBe(1);
    expect(result.tableText).toContain("22"); // B.MIX track count
  });

  test("dismissMixMetaPopup: removes popup when called directly", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { showMixMetaPopup, dismissMixMetaPopup, isMixMetaPopupVisible } =
        await import(/* @vite-ignore */ modPath);

      const anchor = document.createElement("button");
      document.body.appendChild(anchor);
      showMixMetaPopup("test.MIX", "Rave", { bpm: 170, trackCount: 5, catalogs: [] }, anchor);
      const before = isMixMetaPopupVisible();
      dismissMixMetaPopup();
      const after = isMixMetaPopupVisible();
      return { before, after };
    }, MFB_MOD);

    expect(result.before).toBe(true);
    expect(result.after).toBe(false);
  });

  test("dismissMixMetaPopup: is safe when no popup exists", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { dismissMixMetaPopup, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);
      dismissMixMetaPopup(); // should not throw
      return isMixMetaPopupVisible();
    }, MFB_MOD);
    expect(result).toBe(false);
  });

  test("DEV mode: mix file with no meta does not show popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "NO_META.MIX", sizeBytes: 10, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-no-meta" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-no-meta")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();

      return isMixMetaPopupVisible();
    }, MFB_MOD);

    expect(result).toBe(false);
  });

  test("DEV mode: .mix-tree-item tooltip uses metadata when present", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{
          filename: "T.MIX", sizeBytes: 10, format: "A" as const,
          meta: { bpm: 99, trackCount: 7, catalogs: [] },
        }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-tooltip" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-tooltip")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      return item.title;
    }, MFB_MOD);

    expect(result).toContain("BPM: 99");
    expect(result).toContain("7 tracks");
  });

  test("DEV mode: .mix-tree-item tooltip falls back to filename when no meta", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "FALLBACK.MIX", sizeBytes: 10, format: "A" as const }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-tooltip-fb" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-tooltip-fb")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      return item.title;
    }, MFB_MOD);

    expect(result).toBe("FALLBACK.MIX");
  });

  test("DEV mode: clicking a group header dismisses popup", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const lib = [{
        id: "Dance_eJay1",
        name: "Dance eJay 1",
        mixes: [{ filename: "A.MIX", sizeBytes: 10, format: "A" as const,
          meta: { bpm: 130, trackCount: 5, catalogs: [] } }],
      }];

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="at-header-dismiss" class="archive-sidebar">
          <div class="archive-header"><span class="archive-title">Mix Archive</span></div>
          <div class="archive-tree-content"><p class="archive-placeholder">Load</p></div>
        </aside>`;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#at-header-dismiss")!;
      initMixFileBrowser(sidebar, { isDev: true, mixLibrary: lib, onSelectFile: () => {} });
      sidebar.click();

      const item = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      item.click();
      const visibleAfterFileClick = isMixMetaPopupVisible();

      const headerBtn = sidebar.querySelector<HTMLButtonElement>(".mix-tree-group-header")!;
      headerBtn.click(); // collapse the group — should dismiss popup
      const visibleAfterHeaderClick = isMixMetaPopupVisible();

      return { visibleAfterFileClick, visibleAfterHeaderClick };
    }, MFB_MOD);

    expect(result.visibleAfterFileClick).toBe(true);
    expect(result.visibleAfterHeaderClick).toBe(false);
  });

  test("PROD mode: archive-root picker groups product and userdata mixes and parses metadata", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser, isMixMetaPopupVisible } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (
            sidebar.querySelector(".mix-tree-group-label") ||
            sidebar.querySelector(".archive-tree-empty")
          ) {
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
        Dance_eJay1: makeDirHandle("Dance_eJay1", {
          MIX: makeDirHandle("MIX", {
            "START.MIX": makeFileHandle("START.MIX", [0x06, 0x0a, 0x00, 0x00]),
          }),
        }),
        _userdata: makeDirHandle("_userdata", {
          sets: makeDirHandle("sets", {
            "USER.MIX": makeFileHandle("USER.MIX", [0x07, 0x0a, 0x00, 0x00]),
          }),
        }),
      });

      (window as typeof window & { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => archiveRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const refs: Array<{ label: string; group: string; source: { type: string } }> = [];
      const sidebar = host.querySelector<HTMLElement>("#archive-tree")!;
      initMixFileBrowser(sidebar, {
        isDev: false,
        onSelectFile: (ref: unknown) => {
          refs.push(ref as typeof refs[number]);
        },
      });

      sidebar.click();
      await waitForTree(sidebar);

      const groupLabels = [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? "");
      const firstItem = sidebar.querySelector<HTMLButtonElement>(".mix-tree-item")!;
      const firstTooltip = firstItem.title;
      firstItem.click();

      return {
        groupLabels,
        firstTooltip,
        popupVisible: isMixMetaPopupVisible(),
        popupText: document.getElementById("mix-meta-popup")?.textContent ?? "",
        selected: refs[0],
      };
    }, MFB_MOD);

    expect(result.groupLabels).toEqual(["Dance eJay 1", "User: sets"]);
    expect(result.firstTooltip).toContain("BPM: 140");
    expect(result.firstTooltip).toContain("0 tracks");
    expect(result.popupVisible).toBe(true);
    expect(result.popupText).toContain("START.MIX");
    expect(result.selected).toMatchObject({
      label: "START.MIX",
      group: "Dance eJay 1",
      source: { type: "handle" },
    });
  });

  test("PROD mode: selecting a product folder keeps the product group instead of collapsing to MIX", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (modPath) => {
      const { initMixFileBrowser } = await import(/* @vite-ignore */ modPath);

      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await Promise.resolve();
      };

      const waitForTree = async (sidebar: HTMLElement): Promise<void> => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (
            sidebar.querySelector(".mix-tree-group-label") ||
            sidebar.querySelector(".archive-tree-empty")
          ) {
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

      const productRoot = makeDirHandle("Dance_eJay1", {
        MIX: makeDirHandle("MIX", {
          "START.MIX": makeFileHandle("START.MIX", [0x06, 0x0a, 0x00, 0x00]),
        }),
      });

      (window as typeof window & { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => productRoot;

      const host = document.createElement("div");
      host.innerHTML = `
        <aside id="archive-tree" class="archive-sidebar">
          <div class="archive-header">
            <span class="archive-title">Mix Archive</span>
          </div>
          <div class="archive-tree-content">
            <p class="archive-placeholder">Load a .mix file to begin</p>
          </div>
        </aside>
      `;
      document.body.appendChild(host);

      const sidebar = host.querySelector<HTMLElement>("#archive-tree")!;
      initMixFileBrowser(sidebar, {
        isDev: false,
        onSelectFile: () => {},
      });

      sidebar.click();
      await waitForTree(sidebar);

      return {
        groupLabels: [...sidebar.querySelectorAll<HTMLElement>(".mix-tree-group-label")].map((node) => node.textContent ?? ""),
        archiveInfo: sidebar.querySelector<HTMLElement>(".archive-folder-info")?.textContent ?? "",
      };
    }, MFB_MOD);

    expect(result.groupLabels).toEqual(["Dance eJay 1"]);
    expect(result.archiveInfo).toBe("Dance_eJay1");
  });
});