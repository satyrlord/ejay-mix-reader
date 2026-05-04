import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

export const PATH_CONFIG_FILENAME = "path-config.json";
export const PATH_CONFIG_UPDATED_EVENT = "path-config-updated";

const DEFAULT_ARCHIVE_DIRNAME = "archive";
const DEFAULT_OUTPUT_DIRNAME = "output";
const ENV_LOCAL_FILENAME = ".env.local";
const ENV_CONFIG_PATH = "EJAY_PATH_CONFIG";
const ENV_CONFIG_PROFILE = "EJAY_PATH_PROFILE";
const ENV_DEFAULT_ARCHIVE_ROOTS = "EJAY_DEFAULT_ARCHIVE_ROOTS";
const ENV_DEFAULT_OUTPUT_ROOT = "EJAY_DEFAULT_OUTPUT_ROOT";
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const LIKELY_ARCHIVE_MARKERS = [
  "Dance_eJay1",
  "Dance eJay 1",
  "Dance_eJay2",
  "Dance eJay 2",
  "Rave",
  "Rave eJay",
  "TECHNO_EJAY",
  "HipHop 1",
  "HipHop eJay 1",
  "_userdata",
  "_user",
] as const;

export type PathConfigSource = "defaults" | "file";

export type PathConfigIssueCode =
  | "archive_roots_required"
  | "archive_root_missing"
  | "archive_root_not_directory"
  | "archive_root_unrecognized"
  | "output_root_required"
  | "output_root_missing"
  | "output_root_not_directory"
  | "output_metadata_missing";

export interface PathConfigIssue {
  code: PathConfigIssueCode;
  message: string;
  path: string;
}

export interface PathConfigValidation {
  ok: boolean;
  errors: PathConfigIssue[];
  warnings: PathConfigIssue[];
}

export interface EffectivePathConfig {
  archiveRoots: string[];
  outputRoot: string;
}

export interface PathConfigSnapshot {
  repoRoot: string;
  configPath: string;
  source: PathConfigSource;
  parseError: string | null;
  config: EffectivePathConfig;
  validation: PathConfigValidation;
}

interface StoredPathConfigV1 {
  version: 1;
  archiveRoots: string[];
  outputRoot: string;
}

interface ParsedStoredConfig {
  config: EffectivePathConfig;
  parseError: string | null;
}

interface PathConfigPatch {
  archiveRoots?: unknown;
  outputRoot?: unknown;
}

export interface PathConfigStore {
  getSnapshot(): PathConfigSnapshot;
  reload(): PathConfigSnapshot;
  update(patch: unknown): PathConfigSnapshot;
}

const envLocalCache = new Map<string, Record<string, string>>();

function readEnvLocalValues(repoRoot: string): Record<string, string> {
  const normalizedRepoRoot = resolve(repoRoot);
  const cached = envLocalCache.get(normalizedRepoRoot);
  if (cached) return cached;

  const envPath = resolve(normalizedRepoRoot, ENV_LOCAL_FILENAME);
  if (!existsSync(envPath)) {
    const empty: Record<string, string> = {};
    envLocalCache.set(normalizedRepoRoot, empty);
    return empty;
  }

  let text = "";
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    const empty: Record<string, string> = {};
    envLocalCache.set(normalizedRepoRoot, empty);
    return empty;
  }

  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawValue = line.slice(equalsIndex + 1).trim();
    const value = (
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    )
      ? rawValue.slice(1, -1)
      : rawValue;

    parsed[key] = value;
  }

  envLocalCache.set(normalizedRepoRoot, parsed);
  return parsed;
}

function resolveEnvValue(repoRoot: string, key: string): string {
  const processValue = process.env[key]?.trim();
  if (processValue && processValue.length > 0) {
    return processValue;
  }

  const envLocalValue = readEnvLocalValues(repoRoot)[key]?.trim();
  if (envLocalValue && envLocalValue.length > 0) {
    return envLocalValue;
  }

  return "";
}

function normalizeForCompare(pathValue: string): string {
  const resolvedPath = resolve(pathValue);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function isContainedPath(pathValue: string, rootPath: string): boolean {
  const normalizedPath = normalizeForCompare(pathValue);
  const normalizedRoot = normalizeForCompare(rootPath);
  const normalizedPrefix = normalizedRoot.endsWith(sep)
    ? normalizedRoot
    : `${normalizedRoot}${sep}`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedPrefix);
}

function toPortablePath(repoRoot: string, absolutePath: string): string {
  const repo = resolve(repoRoot);
  const target = resolve(absolutePath);
  if (!isContainedPath(target, repo)) {
    return target;
  }

  const relPath = relative(repo, target);
  if (relPath === "") return ".";
  return relPath.replace(/\\/g, "/");
}

function resolvePathValue(repoRoot: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return resolve(repoRoot, trimmed);
}

function dedupePaths(paths: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of paths) {
    const normalized = normalizeForCompare(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(candidate);
  }
  return unique;
}

function parseArchiveRootsValue(repoRoot: string, value: unknown): string[] {
  if (typeof value === "string") {
    const parts = value
      .split(/\r?\n|;/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => resolvePathValue(repoRoot, item));
    return dedupePaths(parts);
  }

  if (Array.isArray(value)) {
    const parts = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => resolvePathValue(repoRoot, item));
    return dedupePaths(parts);
  }

  return [];
}

function resolveConfigPath(repoRoot: string, configPathOverride?: string): string {
  const override = configPathOverride?.trim() || resolveEnvValue(repoRoot, ENV_CONFIG_PATH);
  if (override.length > 0) {
    return isAbsolute(override) ? resolve(override) : resolve(repoRoot, override);
  }

  const profile = resolveEnvValue(repoRoot, ENV_CONFIG_PROFILE);
  if (PROFILE_NAME_PATTERN.test(profile)) {
    return resolve(repoRoot, "data", `path-config.${profile}.json`);
  }

  return resolve(repoRoot, "data", PATH_CONFIG_FILENAME);
}

function buildDefaultConfig(repoRoot: string): EffectivePathConfig {
  const archiveRootsFromEnv = parseArchiveRootsValue(repoRoot, resolveEnvValue(repoRoot, ENV_DEFAULT_ARCHIVE_ROOTS));
  const outputRootFromEnv = resolvePathValue(repoRoot, resolveEnvValue(repoRoot, ENV_DEFAULT_OUTPUT_ROOT));

  return {
    archiveRoots: archiveRootsFromEnv.length > 0
      ? archiveRootsFromEnv
      : [resolve(repoRoot, DEFAULT_ARCHIVE_DIRNAME)],
    outputRoot: outputRootFromEnv.trim().length > 0
      ? outputRootFromEnv
      : resolve(repoRoot, DEFAULT_OUTPUT_DIRNAME),
  };
}

function parseStoredConfig(
  raw: unknown,
  repoRoot: string,
  defaults: EffectivePathConfig,
): ParsedStoredConfig {
  if (typeof raw !== "object" || raw === null) {
    return {
      config: defaults,
      parseError: "Path config must be a JSON object.",
    };
  }

  const parsed = raw as Record<string, unknown>;
  let parseError: string | null = null;

  let archiveRoots = defaults.archiveRoots;
  if (Object.hasOwn(parsed, "archiveRoots")) {
    archiveRoots = parseArchiveRootsValue(repoRoot, parsed.archiveRoots);
    if (!Array.isArray(parsed.archiveRoots) && typeof parsed.archiveRoots !== "string") {
      parseError = "archiveRoots must be a string or an array of strings.";
    }
  } else if (typeof parsed.archiveRoot === "string") {
    archiveRoots = dedupePaths([resolvePathValue(repoRoot, parsed.archiveRoot)]);
  }

  let outputRoot = defaults.outputRoot;
  if (Object.hasOwn(parsed, "outputRoot")) {
    if (typeof parsed.outputRoot !== "string") {
      parseError = parseError ?? "outputRoot must be a string.";
      outputRoot = "";
    } else {
      outputRoot = resolvePathValue(repoRoot, parsed.outputRoot);
    }
  }

  return {
    config: {
      archiveRoots,
      outputRoot,
    },
    parseError,
  };
}

function readConfigFromDisk(repoRoot: string, configPath: string): {
  source: PathConfigSource;
  parseError: string | null;
  config: EffectivePathConfig;
} {
  const defaults = buildDefaultConfig(repoRoot);
  if (!existsSync(configPath)) {
    return {
      source: "defaults",
      parseError: null,
      config: defaults,
    };
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    const normalized = parseStoredConfig(parsed, repoRoot, defaults);
    return {
      source: "file",
      parseError: normalized.parseError,
      config: normalized.config,
    };
  } catch (error) {
    return {
      source: "file",
      parseError: `Could not parse ${configPath}: ${String(error)}`,
      config: defaults,
    };
  }
}

function canReadDirectory(pathValue: string): boolean {
  try {
    return statSync(pathValue).isDirectory();
  } catch {
    return false;
  }
}

function hasLikelyArchiveMarkers(archiveRoot: string): boolean {
  if (!canReadDirectory(archiveRoot)) return false;
  let entries: string[];
  try {
    entries = readdirSync(archiveRoot);
  } catch {
    return false;
  }
  const known = new Set(entries.map((entry) => entry.toLowerCase()));
  return LIKELY_ARCHIVE_MARKERS.some((marker) => known.has(marker.toLowerCase()));
}

export function validatePathConfig(config: EffectivePathConfig): PathConfigValidation {
  const errors: PathConfigIssue[] = [];
  const warnings: PathConfigIssue[] = [];

  if (config.archiveRoots.length === 0) {
    errors.push({
      code: "archive_roots_required",
      message: "At least one archive root must be configured.",
      path: "archiveRoots",
    });
  }

  for (const [index, archiveRoot] of config.archiveRoots.entries()) {
    const pathKey = `archiveRoots[${index}]`;
    if (archiveRoot.trim().length === 0) {
      errors.push({
        code: "archive_root_missing",
        message: "Archive root path cannot be empty.",
        path: pathKey,
      });
      continue;
    }

    if (!existsSync(archiveRoot)) {
      errors.push({
        code: "archive_root_missing",
        message: `Archive root does not exist: ${archiveRoot}`,
        path: pathKey,
      });
      continue;
    }

    if (!canReadDirectory(archiveRoot)) {
      errors.push({
        code: "archive_root_not_directory",
        message: `Archive root is not a directory: ${archiveRoot}`,
        path: pathKey,
      });
      continue;
    }

    if (!hasLikelyArchiveMarkers(archiveRoot)) {
      warnings.push({
        code: "archive_root_unrecognized",
        message: `Archive root does not look like an eJay archive tree: ${archiveRoot}`,
        path: pathKey,
      });
    }
  }

  if (config.outputRoot.trim().length === 0) {
    errors.push({
      code: "output_root_required",
      message: "Output root must be configured.",
      path: "outputRoot",
    });
  } else if (!existsSync(config.outputRoot)) {
    errors.push({
      code: "output_root_missing",
      message: `Output root does not exist: ${config.outputRoot}`,
      path: "outputRoot",
    });
  } else if (!canReadDirectory(config.outputRoot)) {
    errors.push({
      code: "output_root_not_directory",
      message: `Output root is not a directory: ${config.outputRoot}`,
      path: "outputRoot",
    });
  } else if (!existsSync(resolve(config.outputRoot, "metadata.json"))) {
    warnings.push({
      code: "output_metadata_missing",
      message: `Output metadata not found at ${resolve(config.outputRoot, "metadata.json")}`,
      path: "outputRoot",
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function loadPathConfigSnapshot(repoRoot: string = process.cwd(), configPathOverride?: string): PathConfigSnapshot {
  const normalizedRepoRoot = resolve(repoRoot);
  const configPath = resolveConfigPath(normalizedRepoRoot, configPathOverride);
  const fromDisk = readConfigFromDisk(normalizedRepoRoot, configPath);
  return {
    repoRoot: normalizedRepoRoot,
    configPath,
    source: fromDisk.source,
    parseError: fromDisk.parseError,
    config: fromDisk.config,
    validation: validatePathConfig(fromDisk.config),
  };
}

function parsePatch(patch: unknown): PathConfigPatch {
  if (typeof patch !== "object" || patch === null) {
    throw new TypeError("Path config patch must be a JSON object.");
  }
  return patch as PathConfigPatch;
}

function writeStoredConfig(repoRoot: string, configPath: string, config: EffectivePathConfig): void {
  const stored: StoredPathConfigV1 = {
    version: 1,
    archiveRoots: config.archiveRoots.map((archiveRoot) => toPortablePath(repoRoot, archiveRoot)),
    outputRoot: toPortablePath(repoRoot, config.outputRoot),
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(stored, null, 2) + "\n", "utf-8");
}

export function updatePathConfigSnapshot(
  patch: unknown,
  repoRoot: string = process.cwd(),
  configPathOverride?: string,
): PathConfigSnapshot {
  const parsedPatch = parsePatch(patch);
  const current = loadPathConfigSnapshot(repoRoot, configPathOverride);
  const nextConfig: EffectivePathConfig = {
    archiveRoots: [...current.config.archiveRoots],
    outputRoot: current.config.outputRoot,
  };

  if (Object.hasOwn(parsedPatch, "archiveRoots")) {
    nextConfig.archiveRoots = parseArchiveRootsValue(current.repoRoot, parsedPatch.archiveRoots);
  }

  if (Object.hasOwn(parsedPatch, "outputRoot")) {
    if (typeof parsedPatch.outputRoot !== "string") {
      throw new TypeError("outputRoot must be a string.");
    }
    nextConfig.outputRoot = resolvePathValue(current.repoRoot, parsedPatch.outputRoot);
  }

  writeStoredConfig(current.repoRoot, current.configPath, nextConfig);
  return loadPathConfigSnapshot(current.repoRoot, current.configPath);
}

export function createPathConfigStore(repoRoot: string = process.cwd(), configPathOverride?: string): PathConfigStore {
  let snapshot = loadPathConfigSnapshot(repoRoot, configPathOverride);

  return {
    getSnapshot(): PathConfigSnapshot {
      return snapshot;
    },
    reload(): PathConfigSnapshot {
      snapshot = loadPathConfigSnapshot(repoRoot, configPathOverride);
      return snapshot;
    },
    update(patch: unknown): PathConfigSnapshot {
      snapshot = updatePathConfigSnapshot(patch, repoRoot, configPathOverride);
      return snapshot;
    },
  };
}

export function formatPathValidationSummary(snapshot: PathConfigSnapshot): string[] {
  const lines: string[] = [];
  if (snapshot.parseError) {
    lines.push(snapshot.parseError);
  }

  for (const issue of snapshot.validation.errors) {
    lines.push(`ERROR (${issue.path}): ${issue.message}`);
  }

  for (const issue of snapshot.validation.warnings) {
    lines.push(`WARN (${issue.path}): ${issue.message}`);
  }

  if (lines.length === 0) {
    lines.push("Path configuration is valid.");
  }

  return lines;
}
