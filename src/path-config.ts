export type PathConfigSource = "defaults" | "file";

export interface PathConfigIssue {
  code: string;
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

function isIssueArray(value: unknown): value is PathConfigIssue[] {
  return Array.isArray(value) && value.every((issue) => (
    typeof issue === "object" &&
    issue !== null &&
    typeof (issue as PathConfigIssue).code === "string" &&
    typeof (issue as PathConfigIssue).message === "string" &&
    typeof (issue as PathConfigIssue).path === "string"
  ));
}

export function isPathConfigSnapshot(value: unknown): value is PathConfigSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const parsed = value as Partial<PathConfigSnapshot>;
  return (
    typeof parsed.repoRoot === "string" &&
    typeof parsed.configPath === "string" &&
    (parsed.source === "defaults" || parsed.source === "file") &&
    (parsed.parseError === null || typeof parsed.parseError === "string") &&
    typeof parsed.config === "object" &&
    parsed.config !== null &&
    Array.isArray(parsed.config.archiveRoots) &&
    parsed.config.archiveRoots.every((archiveRoot) => typeof archiveRoot === "string") &&
    typeof parsed.config.outputRoot === "string" &&
    typeof parsed.validation === "object" &&
    parsed.validation !== null &&
    typeof parsed.validation.ok === "boolean" &&
    isIssueArray(parsed.validation.errors) &&
    isIssueArray(parsed.validation.warnings)
  );
}

export function firstPathConfigIssue(snapshot: PathConfigSnapshot): string | null {
  if (typeof snapshot.parseError === "string" && snapshot.parseError.length > 0) {
    return snapshot.parseError;
  }

  const firstError = snapshot.validation.errors[0];
  if (firstError) {
    return firstError.message;
  }

  const firstWarning = snapshot.validation.warnings[0];
  if (firstWarning) {
    return firstWarning.message;
  }

  return null;
}
