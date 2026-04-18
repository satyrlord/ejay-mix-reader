import type { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";

import { readDisplayVersionSeries, readGitCommitCount } from "../version.js";

type ExecFn = typeof execFileSync;

function makeExecFn(result: string): ExecFn {
  return (() => result) as unknown as ExecFn;
}

function makeThrowingExecFn(error: Error): ExecFn {
  return (() => { throw error; }) as unknown as ExecFn;
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
