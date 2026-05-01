import { test, expect } from "./baseFixtures.js";

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


