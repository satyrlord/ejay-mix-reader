import { test, expect } from "./baseFixtures.js";

test.describe("browser coverage react shell", () => {
  test("main boots through react-shell query flag", async ({ page }) => {
    await page.goto("/coverage-harness.html?react-shell=1");
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

      library.FetchLibrary.prototype.dispose = function () {};

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => document.querySelector(".archive-sidebar") !== null);

      const hasReactShellRoot = document.querySelector(".react-shell-root") !== null;
      const hasArchiveSidebar = document.querySelector(".archive-sidebar") !== null;

      window.dispatchEvent(new Event("beforeunload"));
      await flush();

      return {
        hasReactShellRoot,
        hasArchiveSidebar,
      };
    }, "/src/library.ts");

    expect(result.hasReactShellRoot).toBe(true);
    expect(result.hasArchiveSidebar).toBe(true);
  });

  test("main bridges local runtime fetches through desktop IPC", async ({ page }) => {
    await page.goto("/coverage-harness.html?react-shell=1");
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

      library.FetchLibrary.prototype.dispose = function () {};

      const desktopRequests: Array<{ method: string; url: string }> = [];
      (window as Window & {
        ejayDesktop?: {
          mode: "desktop";
          platform: string;
          request: (request: { method: string; url: string }) => Promise<{
            status: number;
            headers: Array<[string, string]>;
            body: ArrayBuffer;
          }>;
        };
      }).ejayDesktop = {
        mode: "desktop",
        platform: "win32",
        async request(request) {
          desktopRequests.push({ method: request.method, url: request.url });
          if (request.url === "/__path-config") {
            return {
              status: 200,
              headers: [["content-type", "application/json; charset=utf-8"]],
              body: new TextEncoder().encode(JSON.stringify({
                repoRoot: "D:/dev/eJay",
                configPath: "D:/dev/eJay/data/path-config.json",
                source: "defaults",
                parseError: null,
                config: {
                  archiveRoots: ["D:/dev/eJay/archive"],
                  outputRoot: "D:/dev/eJay/output",
                },
                validation: {
                  ok: true,
                  errors: [],
                  warnings: [],
                },
              })).buffer,
            };
          }

          if (request.url === "/data/index.json") {
            return {
              status: 200,
              headers: [["content-type", "application/json; charset=utf-8"]],
              body: new TextEncoder().encode(JSON.stringify({ bridged: true })).buffer,
            };
          }

          if (request.url.startsWith("/mix/")) {
            return {
              status: 200,
              headers: [["content-type", "application/octet-stream"]],
              body: Uint8Array.from([1, 2, 3, 4]).buffer,
            };
          }

          if (request.url.startsWith("/output/")) {
            return {
              status: 200,
              headers: [["content-type", "audio/wav"]],
              body: Uint8Array.from([5, 6, 7, 8]).buffer,
            };
          }

          if (request.url === "/__category-config" || request.url === "/__sample-move") {
            return {
              status: 204,
              headers: [["content-type", "text/plain; charset=utf-8"]],
              body: new ArrayBuffer(0),
            };
          }

          return {
            status: 404,
            headers: [["content-type", "text/plain; charset=utf-8"]],
            body: new TextEncoder().encode("Not found").buffer,
          };
        },
      };

      // @ts-expect-error Vite serves browser modules from /src during page-eval tests.
      await import("/src/main.ts");
      await waitFor(() => document.querySelector(".archive-sidebar") !== null);

      const response = await fetch("/data/index.json");
      const payload = await response.json() as { bridged?: boolean };
      const mixResponse = await fetch("/mix/TestProduct/TEST.MIX");
      const outputResponse = await fetch("/output/Drum/kick.wav");
      const pathConfigResponse = await fetch("/__path-config");
      const categoryConfigResponse = await fetch("/__category-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: [] }),
      });
      const sampleMoveResponse = await fetch("/__sample-move", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "kick.wav",
          oldCategory: "Drum",
          oldSubcategory: "kick",
          newCategory: "Drum",
          newSubcategory: "snare",
        }),
      });
      const nonBridgedResponse = await fetch("/favicon.ico");

      window.dispatchEvent(new Event("beforeunload"));
      await flush();

      return {
        status: response.status,
        bridged: payload.bridged === true,
        mixStatus: mixResponse.status,
        outputStatus: outputResponse.status,
        pathConfigStatus: pathConfigResponse.status,
        categoryConfigStatus: categoryConfigResponse.status,
        sampleMoveStatus: sampleMoveResponse.status,
        nonBridgedStatus: nonBridgedResponse.status,
        requestCount: desktopRequests.length,
        requestedUrls: desktopRequests.map((entry) => entry.url),
      };
    }, "/src/library.ts");

    expect(result.status).toBe(200);
    expect(result.bridged).toBe(true);
    expect(result.mixStatus).toBe(200);
    expect(result.outputStatus).toBe(200);
    expect(result.pathConfigStatus).toBe(200);
    expect(result.categoryConfigStatus).toBe(204);
    expect(result.sampleMoveStatus).toBe(204);
    expect(result.nonBridgedStatus).toBe(200);
    expect(result.requestCount).toBeGreaterThan(0);
    expect(result.requestedUrls).toContain("/data/index.json");
    expect(result.requestedUrls).toContain("/mix/TestProduct/TEST.MIX");
    expect(result.requestedUrls).toContain("/output/Drum/kick.wav");
    expect(result.requestedUrls).toContain("/__path-config");
    expect(result.requestedUrls).toContain("/__category-config");
    expect(result.requestedUrls).toContain("/__sample-move");
    expect(result.requestedUrls).not.toContain("/favicon.ico");
  });
});
