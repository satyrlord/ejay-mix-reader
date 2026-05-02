import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserConfig } from "vite";

async function loadConfig(command: "build" | "serve"): Promise<UserConfig> {
  const mod = await import("../../vite.config.ts");
  const configFactory = mod.default as (env: { command: "build" | "serve"; mode: string }) => UserConfig;
  return configFactory({ command, mode: "test" });
}

function pluginNames(config: UserConfig): string[] {
  return (config.plugins ?? [])
    .map((entry) => (typeof entry === "object" && entry !== null && "name" in entry ? entry.name : null))
    .filter((name): name is string => typeof name === "string");
}

afterEach(() => {
  vi.resetModules();
});

describe("vite.config", () => {
  it("uses root base path", async () => {
    const config = await loadConfig("build");
    expect(config.base).toBe("/");
  });

  it("does not include dist copy plugins", async () => {
    const config = await loadConfig("build");
    const names = pluginNames(config);
    expect(names.some((name) => name.startsWith("copy-"))).toBe(false);
  });

  it("keeps serve-mix-files plugin wired", async () => {
    const buildConfig = await loadConfig("build");
    const serveConfig = await loadConfig("serve");
    expect(pluginNames(buildConfig)).toContain("serve-mix-files");
    expect(pluginNames(serveConfig)).toContain("serve-mix-files");
  });
});
