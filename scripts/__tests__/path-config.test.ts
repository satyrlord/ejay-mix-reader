import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPathConfigStore,
  formatPathValidationSummary,
  loadPathConfigSnapshot,
  PATH_CONFIG_FILENAME,
  updatePathConfigSnapshot,
} from "../path-config.js";

describe("path-config", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "path-config-"));
    mkdirSync(join(repoRoot, "data"), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("uses repo-local defaults when no path-config file exists", () => {
    const snapshot = loadPathConfigSnapshot(repoRoot);

    expect(snapshot.source).toBe("defaults");
    expect(snapshot.config.archiveRoots).toEqual([resolve(repoRoot, "archive")]);
    expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "output"));
    expect(snapshot.configPath).toBe(resolve(repoRoot, "data", PATH_CONFIG_FILENAME));
  });

  it("uses .env.local fallback roots when no path-config file exists", () => {
    writeFileSync(join(repoRoot, ".env.local"), [
      "EJAY_DEFAULT_ARCHIVE_ROOTS=env-archive-a;env-archive-b",
      "EJAY_DEFAULT_OUTPUT_ROOT=env-output",
      "",
    ].join("\n"), "utf-8");

    const previousArchiveRoots = process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
    const previousOutputRoot = process.env.EJAY_DEFAULT_OUTPUT_ROOT;
    delete process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
    delete process.env.EJAY_DEFAULT_OUTPUT_ROOT;
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.source).toBe("defaults");
      expect(snapshot.config.archiveRoots).toEqual([
        resolve(repoRoot, "env-archive-a"),
        resolve(repoRoot, "env-archive-b"),
      ]);
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "env-output"));
    } finally {
      if (previousArchiveRoots === undefined) {
        delete process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
      } else {
        process.env.EJAY_DEFAULT_ARCHIVE_ROOTS = previousArchiveRoots;
      }

      if (previousOutputRoot === undefined) {
        delete process.env.EJAY_DEFAULT_OUTPUT_ROOT;
      } else {
        process.env.EJAY_DEFAULT_OUTPUT_ROOT = previousOutputRoot;
      }
    }
  });

  it("prefers process env fallback roots over .env.local values", () => {
    writeFileSync(join(repoRoot, ".env.local"), [
      "EJAY_DEFAULT_ARCHIVE_ROOTS=env-archive",
      "EJAY_DEFAULT_OUTPUT_ROOT=env-output",
      "",
    ].join("\n"), "utf-8");

    const previousArchiveRoots = process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
    const previousOutputRoot = process.env.EJAY_DEFAULT_OUTPUT_ROOT;
    process.env.EJAY_DEFAULT_ARCHIVE_ROOTS = "proc-archive";
    process.env.EJAY_DEFAULT_OUTPUT_ROOT = "proc-output";
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.config.archiveRoots).toEqual([resolve(repoRoot, "proc-archive")]);
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "proc-output"));
    } finally {
      if (previousArchiveRoots === undefined) {
        delete process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
      } else {
        process.env.EJAY_DEFAULT_ARCHIVE_ROOTS = previousArchiveRoots;
      }

      if (previousOutputRoot === undefined) {
        delete process.env.EJAY_DEFAULT_OUTPUT_ROOT;
      } else {
        process.env.EJAY_DEFAULT_OUTPUT_ROOT = previousOutputRoot;
      }
    }
  });

  it("keeps file-configured roots when .env.local defaults exist", () => {
    writeFileSync(join(repoRoot, ".env.local"), [
      "EJAY_DEFAULT_ARCHIVE_ROOTS=env-archive",
      "EJAY_DEFAULT_OUTPUT_ROOT=env-output",
      "",
    ].join("\n"), "utf-8");

    writeFileSync(join(repoRoot, "data", PATH_CONFIG_FILENAME), JSON.stringify({
      version: 1,
      archiveRoots: ["file-archive"],
      outputRoot: "file-output",
    }), "utf-8");

    const previousArchiveRoots = process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
    const previousOutputRoot = process.env.EJAY_DEFAULT_OUTPUT_ROOT;
    delete process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
    delete process.env.EJAY_DEFAULT_OUTPUT_ROOT;
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.source).toBe("file");
      expect(snapshot.config.archiveRoots).toEqual([resolve(repoRoot, "file-archive")]);
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "file-output"));
    } finally {
      if (previousArchiveRoots === undefined) {
        delete process.env.EJAY_DEFAULT_ARCHIVE_ROOTS;
      } else {
        process.env.EJAY_DEFAULT_ARCHIVE_ROOTS = previousArchiveRoots;
      }

      if (previousOutputRoot === undefined) {
        delete process.env.EJAY_DEFAULT_OUTPUT_ROOT;
      } else {
        process.env.EJAY_DEFAULT_OUTPUT_ROOT = previousOutputRoot;
      }
    }
  });

  it("writes portable relative paths and returns a valid snapshot", () => {
    const archiveRoot = join(repoRoot, "archive-a");
    const outputRoot = join(repoRoot, "output-a");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(join(outputRoot, "metadata.json"), JSON.stringify({ samples: [] }), "utf-8");

    const snapshot = updatePathConfigSnapshot(
      {
        archiveRoots: [archiveRoot],
        outputRoot,
      },
      repoRoot,
    );

    expect(snapshot.validation.ok).toBe(true);

    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    const stored = JSON.parse(readFileSync(configPath, "utf-8")) as {
      version: number;
      archiveRoots: string[];
      outputRoot: string;
    };
    expect(stored.version).toBe(1);
    expect(stored.archiveRoots).toEqual(["archive-a"]);
    expect(stored.outputRoot).toBe("output-a");
  });

  it("reports validation errors when configured roots do not exist", () => {
    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      archiveRoots: ["missing-archive"],
      outputRoot: "missing-output",
    }), "utf-8");

    const snapshot = loadPathConfigSnapshot(repoRoot);

    expect(snapshot.source).toBe("file");
    expect(snapshot.validation.ok).toBe(false);
    expect(snapshot.validation.errors.some((issue) => issue.code === "archive_root_missing")).toBe(true);
    expect(snapshot.validation.errors.some((issue) => issue.code === "output_root_missing")).toBe(true);
  });

  it("supports updating archive roots from a newline-delimited string", () => {
    const archiveRootA = join(repoRoot, "archive-A");
    const archiveRootB = join(repoRoot, "archive-B");
    const outputRoot = join(repoRoot, "output-A");
    mkdirSync(archiveRootA, { recursive: true });
    mkdirSync(archiveRootB, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });

    const snapshot = updatePathConfigSnapshot(
      {
        archiveRoots: `${archiveRootA}\n${archiveRootB}`,
        outputRoot,
      },
      repoRoot,
    );

    expect(snapshot.config.archiveRoots).toEqual([
      resolve(archiveRootA),
      resolve(archiveRootB),
    ]);
  });

  it("keeps an in-memory store in sync after updates", () => {
    const archiveRoot = join(repoRoot, "archive-store");
    const outputRoot = join(repoRoot, "output-store");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });

    const store = createPathConfigStore(repoRoot);
    const updated = store.update({
      archiveRoots: [archiveRoot],
      outputRoot,
    });

    expect(updated.config.archiveRoots).toEqual([resolve(archiveRoot)]);
    expect(store.getSnapshot().config.outputRoot).toBe(resolve(outputRoot));
  });

  it("supports EJAY_PATH_CONFIG env overrides", () => {
    const customConfigPath = join(repoRoot, "custom", "paths.json");
    mkdirSync(join(repoRoot, "custom"), { recursive: true });
    writeFileSync(customConfigPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-custom"],
      outputRoot: "output-custom",
    }), "utf-8");

    const previous = process.env.EJAY_PATH_CONFIG;
    process.env.EJAY_PATH_CONFIG = customConfigPath;
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.configPath).toBe(resolve(customConfigPath));
      expect(snapshot.config.archiveRoots[0]).toBe(resolve(repoRoot, "archive-custom"));
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "output-custom"));
    } finally {
      if (previous === undefined) {
        delete process.env.EJAY_PATH_CONFIG;
      } else {
        process.env.EJAY_PATH_CONFIG = previous;
      }
    }
  });

  it("supports EJAY_PATH_PROFILE file selection", () => {
    const profileConfigPath = join(repoRoot, "data", "path-config.assets.json");
    writeFileSync(profileConfigPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-assets"],
      outputRoot: "output-assets",
    }), "utf-8");

    const previousProfile = process.env.EJAY_PATH_PROFILE;
    process.env.EJAY_PATH_PROFILE = "assets";
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.configPath).toBe(resolve(profileConfigPath));
      expect(snapshot.config.archiveRoots).toEqual([resolve(repoRoot, "archive-assets")]);
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "output-assets"));
    } finally {
      if (previousProfile === undefined) {
        delete process.env.EJAY_PATH_PROFILE;
      } else {
        process.env.EJAY_PATH_PROFILE = previousProfile;
      }
    }
  });

  it("prioritizes EJAY_PATH_CONFIG over EJAY_PATH_PROFILE", () => {
    const explicitConfigPath = join(repoRoot, "custom", "paths.json");
    mkdirSync(join(repoRoot, "custom"), { recursive: true });
    writeFileSync(explicitConfigPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-explicit"],
      outputRoot: "output-explicit",
    }), "utf-8");

    const profileConfigPath = join(repoRoot, "data", "path-config.assets.json");
    writeFileSync(profileConfigPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-profile"],
      outputRoot: "output-profile",
    }), "utf-8");

    const previousConfig = process.env.EJAY_PATH_CONFIG;
    const previousProfile = process.env.EJAY_PATH_PROFILE;
    process.env.EJAY_PATH_CONFIG = explicitConfigPath;
    process.env.EJAY_PATH_PROFILE = "assets";
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.configPath).toBe(resolve(explicitConfigPath));
      expect(snapshot.config.archiveRoots).toEqual([resolve(repoRoot, "archive-explicit")]);
      expect(snapshot.config.outputRoot).toBe(resolve(repoRoot, "output-explicit"));
    } finally {
      if (previousConfig === undefined) {
        delete process.env.EJAY_PATH_CONFIG;
      } else {
        process.env.EJAY_PATH_CONFIG = previousConfig;
      }

      if (previousProfile === undefined) {
        delete process.env.EJAY_PATH_PROFILE;
      } else {
        process.env.EJAY_PATH_PROFILE = previousProfile;
      }
    }
  });

  it("falls back to default path-config when EJAY_PATH_PROFILE is invalid", () => {
    const profileConfigPath = join(repoRoot, "data", "path-config.assets.json");
    writeFileSync(profileConfigPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-profile"],
      outputRoot: "output-profile",
    }), "utf-8");

    const previousProfile = process.env.EJAY_PATH_PROFILE;
    process.env.EJAY_PATH_PROFILE = "../assets";
    try {
      const snapshot = loadPathConfigSnapshot(repoRoot);
      expect(snapshot.configPath).toBe(resolve(repoRoot, "data", PATH_CONFIG_FILENAME));
      expect(snapshot.source).toBe("defaults");
    } finally {
      if (previousProfile === undefined) {
        delete process.env.EJAY_PATH_PROFILE;
      } else {
        process.env.EJAY_PATH_PROFILE = previousProfile;
      }
    }
  });

  it("parses legacy archiveRoot and handles malformed JSON gracefully", () => {
    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      archiveRoot: "legacy-archive",
      outputRoot: "legacy-output",
    }), "utf-8");

    const parsedLegacy = loadPathConfigSnapshot(repoRoot);
    expect(parsedLegacy.config.archiveRoots).toEqual([resolve(repoRoot, "legacy-archive")]);
    expect(parsedLegacy.parseError).toBeNull();

    writeFileSync(configPath, "{ broken json", "utf-8");
    const malformed = loadPathConfigSnapshot(repoRoot);
    expect(malformed.source).toBe("file");
    expect(malformed.parseError).toContain("Could not parse");
    expect(malformed.config.archiveRoots).toEqual([resolve(repoRoot, "archive")]);
  });

  it("reports parse errors for invalid typed fields and empty archive root values", () => {
    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      archiveRoots: { bad: true },
      outputRoot: 42,
    }), "utf-8");

    const snapshot = loadPathConfigSnapshot(repoRoot);
    expect(snapshot.parseError).toBe("archiveRoots must be a string or an array of strings.");
    expect(snapshot.validation.errors.some((issue) => issue.code === "archive_roots_required")).toBe(true);
    expect(snapshot.validation.errors.some((issue) => issue.code === "output_root_required")).toBe(true);
  });

  it("supports semicolon-delimited archive roots and de-duplicates paths", () => {
    const archiveRoot = join(repoRoot, "archive-semicolon");
    const outputRoot = join(repoRoot, "output-semicolon");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });

    const snapshot = updatePathConfigSnapshot(
      {
        archiveRoots: `${archiveRoot};${archiveRoot}`,
        outputRoot,
      },
      repoRoot,
    );

    expect(snapshot.config.archiveRoots).toEqual([resolve(archiveRoot)]);
  });

  it("reports unrecognized archive and output metadata warnings", () => {
    const archiveRoot = join(repoRoot, "archive-empty");
    const outputRoot = join(repoRoot, "output-empty");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });

    const snapshot = updatePathConfigSnapshot({
      archiveRoots: [archiveRoot],
      outputRoot,
    }, repoRoot);

    expect(snapshot.validation.ok).toBe(true);
    expect(snapshot.validation.warnings.some((issue) => issue.code === "archive_root_unrecognized")).toBe(true);
    expect(snapshot.validation.warnings.some((issue) => issue.code === "output_metadata_missing")).toBe(true);
  });

  it("reports not-directory validation errors for archive and output paths", () => {
    const archiveFile = join(repoRoot, "archive.txt");
    const outputFile = join(repoRoot, "output.txt");
    writeFileSync(archiveFile, "x", "utf-8");
    writeFileSync(outputFile, "x", "utf-8");

    const snapshot = updatePathConfigSnapshot({
      archiveRoots: [archiveFile],
      outputRoot: outputFile,
    }, repoRoot);

    expect(snapshot.validation.errors.some((issue) => issue.code === "archive_root_not_directory")).toBe(true);
    expect(snapshot.validation.errors.some((issue) => issue.code === "output_root_not_directory")).toBe(true);
  });

  it("throws for invalid update patch payloads", () => {
    expect(() => updatePathConfigSnapshot(null, repoRoot)).toThrow("Path config patch must be a JSON object.");
    expect(() => updatePathConfigSnapshot({ outputRoot: 7 }, repoRoot)).toThrow("outputRoot must be a string.");
  });

  it("reloads store snapshots after on-disk changes", () => {
    const store = createPathConfigStore(repoRoot);
    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      archiveRoots: ["archive-reload"],
      outputRoot: "output-reload",
    }), "utf-8");

    const reloaded = store.reload();
    expect(reloaded.source).toBe("file");
    expect(reloaded.config.archiveRoots).toEqual([resolve(repoRoot, "archive-reload")]);
    expect(reloaded.config.outputRoot).toBe(resolve(repoRoot, "output-reload"));
  });

  it("formats validation summaries for valid and invalid snapshots", () => {
    const validLines = formatPathValidationSummary({
      repoRoot,
      configPath: join(repoRoot, "data", PATH_CONFIG_FILENAME),
      source: "defaults",
      parseError: null,
      config: {
        archiveRoots: [join(repoRoot, "archive")],
        outputRoot: join(repoRoot, "output"),
      },
      validation: {
        ok: true,
        errors: [],
        warnings: [],
      },
    });
    expect(validLines).toEqual(["Path configuration is valid."]);

    const configPath = join(repoRoot, "data", PATH_CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      archiveRoots: ["missing-archive"],
      outputRoot: "",
    }), "utf-8");

    const invalidSnapshot = loadPathConfigSnapshot(repoRoot);
    const lines = formatPathValidationSummary(invalidSnapshot);
    expect(lines.some((line) => line.startsWith("ERROR (archiveRoots[0])"))).toBe(true);
    expect(lines.some((line) => line.startsWith("ERROR (outputRoot)"))).toBe(true);
  });
});
