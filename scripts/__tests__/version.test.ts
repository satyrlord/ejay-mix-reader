import type { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";

import {
  buildDisplayVersion,
  readDeploymentCount,
  readDisplayVersionSeries,
  readGitCommitCount,
  readGitHubCommitCount,
  readGitRemoteDefaultRef,
} from "../version.js";

type ExecFn = typeof execFileSync;

function makeExecFn(result: string): ExecFn {
  return (() => result) as unknown as ExecFn;
}

function makeThrowingExecFn(error: Error): ExecFn {
  return (() => { throw error; }) as unknown as ExecFn;
}

function makeMappedExecFn(results: Record<string, string>): ExecFn {
  return ((_cmd: string, args: string[]) => {
    const key = args.join(" ");
    const result = results[key];
    if (result === undefined) {
      throw new Error(`Unexpected git invocation: ${key}`);
    }
    return result;
  }) as unknown as ExecFn;
}

describe("readDisplayVersionSeries", () => {
  it("returns the major version from a standard semver string", () => {
    expect(readDisplayVersionSeries("1.2.3")).toBe("1");
  });

  it("handles a v-prefixed version string", () => {
    expect(readDisplayVersionSeries("v2.0.0")).toBe("2");
  });

  it("returns just the major digit when there is no minor/patch", () => {
    expect(readDisplayVersionSeries("3")).toBe("3");
  });

  it("returns '0' for undefined", () => {
    expect(readDisplayVersionSeries(undefined)).toBe("0");
  });

  it("returns '0' for an empty string", () => {
    expect(readDisplayVersionSeries("")).toBe("0");
  });

  it("returns '0' for a string with no leading digit", () => {
    expect(readDisplayVersionSeries("beta")).toBe("0");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(readDisplayVersionSeries("  4.5.6  ")).toBe("4");
  });
});

describe("readGitCommitCount", () => {
  it("returns the parsed commit count from git output", () => {
    expect(readGitCommitCount(process.cwd(), makeExecFn("42\n"))).toBe(42);
  });

  it("counts the requested ref instead of always using HEAD", () => {
    const execFn = makeMappedExecFn({
      "rev-list --count origin/main": "27\n",
    });
    expect(readGitCommitCount(process.cwd(), execFn, "origin/main")).toBe(27);
  });

  it("returns null when execFileSync throws", () => {
    expect(readGitCommitCount(process.cwd(), makeThrowingExecFn(new Error("git not found")))).toBeNull();
  });

  it("returns null when git returns a non-numeric string", () => {
    expect(readGitCommitCount(process.cwd(), makeExecFn("not-a-number"))).toBeNull();
  });

  it("returns null when git reports zero commits", () => {
    expect(readGitCommitCount(process.cwd(), makeExecFn("0"))).toBeNull();
  });

  it("forwards the cwd argument to the executor", () => {
    const seen: Array<string | URL> = [];
    const trackingExecFn = ((_cmd: string, _args: string[], opts: { cwd?: string | URL }) => {
      seen.push(opts.cwd ?? "");
      return "5";
    }) as unknown as ExecFn;
    const cwd = new URL("file:///tmp/repo");
    readGitCommitCount(cwd, trackingExecFn);
    expect(seen[0]).toBe(cwd);
  });
});

describe("readGitRemoteDefaultRef", () => {
  it("reads origin/HEAD and normalizes it to a remote ref", () => {
    const execFn = makeExecFn("refs/remotes/origin/main\n");
    expect(readGitRemoteDefaultRef(process.cwd(), execFn)).toBe("origin/main");
  });

  it("returns null when origin/HEAD cannot be resolved", () => {
    expect(readGitRemoteDefaultRef(process.cwd(), makeThrowingExecFn(new Error("no remote")))).toBeNull();
  });
});

describe("readGitHubCommitCount", () => {
  it("prefers the remote default branch count", () => {
    const execFn = makeMappedExecFn({
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "rev-list --count origin/main": "27\n",
    });
    expect(readGitHubCommitCount(process.cwd(), execFn)).toBe(27);
  });

  it("falls back to HEAD when no remote refs are available", () => {
    const execFn = makeMappedExecFn({
      "rev-list --count HEAD": "19\n",
    });
    expect(readGitHubCommitCount(process.cwd(), execFn)).toBe(19);
  });
});

describe("readDeploymentCount", () => {
  it("parses string deployment counts", () => {
    expect(readDeploymentCount("19\n")).toBe(19);
  });

  it("parses numeric deployment counts", () => {
    expect(readDeploymentCount(12)).toBe(12);
  });

  it("returns null for missing or invalid values", () => {
    expect(readDeploymentCount(undefined)).toBeNull();
    expect(readDeploymentCount("0")).toBeNull();
    expect(readDeploymentCount("abc")).toBeNull();
  });
});

describe("buildDisplayVersion", () => {
  it("uses the GitHub-backed commit count as the dynamic minor version", () => {
    const execFn = makeMappedExecFn({
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "rev-list --count origin/main": "27\n",
    });
    expect(buildDisplayVersion("1.15", { execFn })).toBe("v1.27");
  });

  it("falls back to the deployment count when git metadata is unavailable", () => {
    const execFn = makeThrowingExecFn(new Error("git unavailable"));
    expect(buildDisplayVersion("1.15", { execFn, deploymentCount: "19" })).toBe("v1.19");
  });

  it("falls back to .0 when neither git nor deployment metadata is available", () => {
    const execFn = makeThrowingExecFn(new Error("git unavailable"));
    expect(buildDisplayVersion("1.15", { execFn })).toBe("v1.0");
  });
});
