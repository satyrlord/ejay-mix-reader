import { execFileSync } from "child_process";

function parsePositiveCount(rawValue: string): number | null {
  const parsedCount = Number.parseInt(rawValue.trim(), 10);
  return Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null;
}

/**
 * Read the total git commit count on HEAD.  Returns `null` when git is
 * unavailable or the output cannot be parsed (e.g. a shallow clone or a
 * non-git environment).
 *
 * @param cwd Working directory passed to `git` — defaults to `process.cwd()`.
 * @param execFn Overridable executor; defaults to `execFileSync` (injected for tests).
 * @param ref Git ref to count — defaults to `HEAD`.
 */
export function readGitCommitCount(
  cwd: string | URL = process.cwd(),
  execFn: typeof execFileSync = execFileSync,
  ref = "HEAD",
): number | null {
  try {
    const rawCount = execFn("git", ["rev-list", "--count", ref], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return parsePositiveCount(rawCount);
  } catch {
    return null;
  }
}

/**
 * Read the default branch ref tracked under `origin/HEAD`, e.g. `origin/main`.
 */
export function readGitRemoteDefaultRef(
  cwd: string | URL = process.cwd(),
  execFn: typeof execFileSync = execFileSync,
): string | null {
  try {
    const rawRef = execFn("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();

    return rawRef.startsWith("refs/remotes/")
      ? rawRef.slice("refs/remotes/".length)
      : null;
  } catch {
    return null;
  }
}

/**
 * Prefer the GitHub-backed default branch commit count when it is available,
 * then fall back to common remote refs and finally the local HEAD count.
 */
export function readGitHubCommitCount(
  cwd: string | URL = process.cwd(),
  execFn: typeof execFileSync = execFileSync,
): number | null {
  const refsToTry = [
    readGitRemoteDefaultRef(cwd, execFn),
    "origin/main",
    "origin/master",
    "HEAD",
  ];

  for (const ref of refsToTry) {
    if (!ref) continue;
    const count = readGitCommitCount(cwd, execFn, ref);
    if (count !== null) return count;
  }

  return null;
}

/**
 * Parse a deployment-count fallback passed from the deployment workflow.
 */
export function readDeploymentCount(rawValue: number | string | undefined): number | null {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) && rawValue > 0 ? Math.trunc(rawValue) : null;
  }
  if (typeof rawValue !== "string") return null;
  return parsePositiveCount(rawValue);
}

/**
 * Extract the major version series (first numeric segment) from a semver-like
 * package version string.  Returns `"0"` for any unrecognised input.
 *
 * @param packageVersion The `version` field from `package.json`, e.g. `"1.2.3"`.
 */
export function readDisplayVersionSeries(packageVersion: string | undefined): string {
  const normalizedVersion = typeof packageVersion === "string" ? packageVersion.trim() : "";
  const majorMatch = /^v?(\d+)/.exec(normalizedVersion);
  return majorMatch?.[1] ?? "0";
}

/**
 * Format the UI version as `v<major>.<dynamicMinor>`, where the minor part is
 * the GitHub default-branch commit count when available, or the GitHub Pages
 * deployment count when git metadata is unavailable.
 */
export function buildDisplayVersion(
  packageVersion: string | undefined,
  options: {
    cwd?: string | URL;
    execFn?: typeof execFileSync;
    deploymentCount?: number | string | undefined;
  } = {},
): string {
  const versionSeries = readDisplayVersionSeries(packageVersion);
  const cwd = options.cwd ?? process.cwd();
  const execFn = options.execFn ?? execFileSync;

  const commitCount = readGitHubCommitCount(cwd, execFn);
  if (commitCount !== null) {
    return `v${versionSeries}.${commitCount}`;
  }

  const deploymentCount = readDeploymentCount(options.deploymentCount);
  if (deploymentCount !== null) {
    return `v${versionSeries}.${deploymentCount}`;
  }

  return `v${versionSeries}.0`;
}
