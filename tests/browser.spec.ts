import { test, expect } from "./baseFixtures.js";

test.describe("data module edge cases", () => {
  const DATA_MOD = "/src/data.ts";

  test("sample helpers normalize category, labels, and paths", async ({ page }) => {
    await page.goto("/");
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

  test("data helpers keep configured tabs only and handle empty configured subcategory lists", async ({ page }) => {
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
    expect(result.bassSubcategories).toEqual(["unsorted"]);
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
        tabCount: tabs.querySelectorAll(".subcategory-tab").length,
        activeTab: tabs.querySelector(".subcategory-tab.is-active")?.getAttribute("data-tab-id"),
        plusVisible: Boolean(tabs.querySelector("#subcategory-add")),
        plusDisabled: Boolean((tabs.querySelector("#subcategory-add") as HTMLButtonElement | null)?.disabled),
      };
    }, RENDER_MOD);

    expect(result.categoryCount).toBe(2);
    expect(result.activeCategory).toBe("Drum");
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
        legacyTabsRowPresent: Boolean(shellHost.querySelector(".spa-tabs-row")),
        gridId: shell.grid.id,
        bpmValue: shell.bpm.value,
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
    expect(result.legacyTabsRowPresent).toBe(false);
    expect(result.gridId).toBe("sample-grid");
    expect(result.bpmValue).toBe("140");
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

    expect(result.laneCount).toBe(2);
    expect(result.firstSpan).toBe("6");
    expect(result.secondSpan).toBe("4");
    expect(result.thirdSpan).toBe("3");
    expect(result.firstColor).toContain("--channel-bass");
    expect(result.firstResolvedPath).toBe("mock://long.wav");
    expect(result.toggled).toEqual(["mock://long.wav"]);
    expect(result.transportName).toBe("long");
    expect(result.transportProgress).toBe(50);
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
      await new Promise((resolve) => setTimeout(resolve, 1100));
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

    await page.waitForTimeout(1100);

    expect(categoryFetches).toBeGreaterThan(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:snare"]')).toBeVisible();
    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(3);
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
    await page.waitForTimeout(1100);
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

  test("the real app hardcodes special tabs and removes only user subcategories through the context menu", async ({ page }) => {
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
    await page.locator("#subcategory-context-menu .subcategory-context-menu-item").click();
    await saveResponse;

    expect(saveCalls).toBe(1);
    expect(categoryConfig).toEqual({
      categories: [{ id: "Drum", name: "Drum", subcategories: ["kick"] }],
    });

    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:fills"]')).toHaveCount(0);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:kick"]')).toBeVisible();
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]')).toBeVisible();

    await page.locator('.subcategory-tab[data-tab-id="subcategory:misc"]').click();
    await expect(page.locator(".sample-grid")).toContainText("Fill");
  });

  test("the real app alerts when saving an inline subcategory fails", async ({ page }) => {
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

    const dialogPromise = page.waitForEvent("dialog");
    await page.locator("#subcategory-add").click();
    await page.locator("#subcategory-add-input").fill("fills");
    await page.locator("#subcategory-add-confirm").click();

    const dialog = await dialogPromise;
    expect(dialog.message()).toBe("Could not save categories.json.");
    await dialog.dismiss();

    expect(saveCalls).toBe(1);
    await expect(page.locator("#subcategory-add-input")).toBeVisible();
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
    await expect(page.locator(".subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toContainText("unsorted");
    await expect(page.locator(".sample-block")).toHaveCount(2);
    await expect(page.locator(".sample-grid")).toContainText("Bass 140");
    await expect(page.locator(".sample-grid")).toContainText("Bass Riff");

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

  test("main shows the hardcoded unsorted tab and keeps unmatched samples visible when a category has no configured subcategories", async ({ page }) => {
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

    await expect(page.locator("#subcategory-tabs .subcategory-tab")).toHaveCount(1);
    await expect(page.locator('.subcategory-tab[data-tab-id="subcategory:unsorted"]')).toBeVisible();
    await expect(page.locator("#subcategory-add")).toBeVisible();
    await expect(page.locator(".sample-block")).toHaveCount(2);
    await expect(page.locator(".sample-grid")).toContainText("Bass Plain");
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

  test("main warns on category refresh failures and alerts when saving categories fails", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (modPath) => {
      const library = await import(/* @vite-ignore */ modPath);
      const warnings: string[] = [];
      const alerts: string[] = [];
      const originalWarn = console.warn;
      const originalAlert = window.alert;
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
      window.alert = (message?: string) => {
        alerts.push(String(message ?? ""));
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
        await new Promise((resolve) => setTimeout(resolve, 1100));
        (document.querySelector("#subcategory-add") as HTMLButtonElement).click();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).value = "fills";
        (document.querySelector("#subcategory-add-input") as HTMLInputElement).dispatchEvent(
          new Event("input", { bubbles: true }),
        );
        (document.querySelector("#subcategory-add-confirm") as HTMLButtonElement).click();
        await Promise.resolve();
        await Promise.resolve();

        return { warnings, alerts };
      } finally {
        console.warn = originalWarn;
        window.alert = originalAlert;
      }
    }, LIBRARY_MOD);

    expect(result.warnings.some((message) => message.includes("Failed to refresh category config."))).toBe(true);
    expect(result.alerts).toContain("Could not save categories.json.");
  });
});