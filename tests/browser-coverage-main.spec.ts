import { test, expect } from "./baseFixtures.js";
import { openCoverageHarnessAndWaitForNetworkIdle } from "./playwright-test-helpers.js";

test.describe("browser coverage gap", () => {
  test("main covers mix selection failure, playback caching, and cleanup branches", async ({ page }) => {
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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
    await openCoverageHarnessAndWaitForNetworkIdle(page);

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

});

