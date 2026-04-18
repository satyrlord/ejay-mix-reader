import { execFileSync } from "child_process";

/**
 * Read the total git commit count on HEAD.  Returns `null` when git is
 * unavailable or the output cannot be parsed (e.g. a shallow clone or a
 * non-git environment).
 *
 * @param cwd Working directory passed to `git` — defaults to `process.cwd()`.
 * @param execFn Overridable executor; defaults to `execFileSync` (injected for tests).
 */
export function readGitCommitCount(
  cwd: string | URL = process.cwd(),
  execFn: typeof execFileSync = execFileSync,
): number | null {
  try {
    const rawCount = execFn("git", ["rev-list", "--count", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    const parsedCount = Number.parseInt(rawCount, 10);
    return Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null;
  } catch {
    return null;
  }
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
