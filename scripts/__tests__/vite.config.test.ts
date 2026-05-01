import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin, UserConfig } from "vite";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_INCLUDE_MIX = process.env.EJAY_INCLUDE_MIX_IN_DIST;

function restoreProcessState(): void {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_INCLUDE_MIX === undefined) {
    delete process.env.EJAY_INCLUDE_MIX_IN_DIST;
  } else {
    process.env.EJAY_INCLUDE_MIX_IN_DIST = ORIGINAL_INCLUDE_MIX;
  }
}

async function loadBuildConfig(): Promise<UserConfig> {
  const mod = await import("../../vite.config.ts");
  const configFactory = mod.default as (env: { command: "build"; mode: string }) => UserConfig;
  return configFactory({ command: "build", mode: "test" });
}

function pluginNames(config: UserConfig): string[] {
  return (config.plugins ?? [])
    .map((entry) => (typeof entry === "object" && entry !== null && "name" in entry ? entry.name : null))
    .filter((name): name is string => typeof name === "string");
}

async function runCloseBundle(plugin: Plugin): Promise<void> {
  const hook = plugin.closeBundle;
  if (!hook) throw new Error("Plugin has no closeBundle hook");
  const fn = typeof hook === "function" ? hook : hook.handler;
  await fn();
}

afterEach(() => {
  restoreProcessState();
  vi.resetModules();
});

describe("vite.config build plugins", () => {
  it("always includes copy-runtime-index and gates copy-mix-files by env flag", async () => {
    process.env.EJAY_INCLUDE_MIX_IN_DIST = "false";
    vi.resetModules();
    const withoutMix = await loadBuildConfig();
    const withoutMixNames = pluginNames(withoutMix);
    expect(withoutMixNames).toContain("copy-runtime-index");
    expect(withoutMixNames).not.toContain("copy-mix-files");

    process.env.EJAY_INCLUDE_MIX_IN_DIST = "true";
    vi.resetModules();
    const withMix = await loadBuildConfig();
    const withMixNames = pluginNames(withMix);
    expect(withMixNames).toContain("copy-runtime-index");
    expect(withMixNames).toContain("copy-mix-files");
  });

  it("copy-runtime-index plugin copies data/index.json into dist/data", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "vite-config-copy-index-"));
    try {
      process.chdir(tempRoot);
      process.env.EJAY_INCLUDE_MIX_IN_DIST = "false";
      mkdirSync(join(tempRoot, "data"), { recursive: true });
      writeFileSync(join(tempRoot, "data", "index.json"), '{"ok":true}\n', "utf-8");

      vi.resetModules();
      const config = await loadBuildConfig();
      const runtimeIndexPlugin = (config.plugins ?? []).find(
        (entry): entry is Plugin =>
          typeof entry === "object" && entry !== null && "name" in entry && entry.name === "copy-runtime-index",
      );

      expect(runtimeIndexPlugin).toBeDefined();
      await runCloseBundle(runtimeIndexPlugin!);

      const copiedPath = join(tempRoot, "dist", "data", "index.json");
      expect(existsSync(copiedPath)).toBe(true);
      expect(readFileSync(copiedPath, "utf-8")).toBe('{"ok":true}\n');
    } finally {
      process.chdir(ORIGINAL_CWD);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
