import { test, expect } from "./baseFixtures.js";

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
      const moveBodies: string[] = [];
      const moveStatuses: number[] = [];

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


