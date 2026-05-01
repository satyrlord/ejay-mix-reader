import { test, expect } from "./baseFixtures.js";

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
    await expect(page.locator("#harness-tabs #subcategory-add-input")).toHaveCount(0);

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


