import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import type { MixIR, TrackPlacement } from "../mix-types.js";
import {
  auditProduct,
  buildAudit,
  pct,
  round2,
  runAuditCli,
  type AuditReport,
} from "../mix-format-cd-audit.js";

function sampleRef() {
  return {
    rawId: 0,
    internalName: null,
    displayName: null,
    resolvedPath: null,
    dataLength: null,
  };
}

function makeIr(product: string, tracks: TrackPlacement[]): MixIR {
  return {
    format: "C",
    product,
    appId: 0,
    bpm: 120,
    bpmAdjusted: null,
    author: null,
    title: null,
    registration: null,
    tracks,
    mixer: {
      channels: [],
      eq: [],
      compressor: null,
      stereoWide: null,
      raw: {},
    },
    drumMachine: null,
    tickerText: [],
    catalogs: [],
  };
}

function reportTemplate(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    products: [],
    aggregate: {
      mixCount: 0,
      trackCount: 0,
      recoveredBeatCount: 0,
      recoveredChannelCount: 0,
      recoveredBothCount: 0,
      recoveredBeatPct: 0,
      recoveredChannelPct: 0,
      recoveredBothPct: 0,
    },
    acceptance: {
      thresholdPct: 80,
      productsAllMeet80Pct: true,
      failingProducts: [],
    },
    ...overrides,
  };
}

describe("mix-format-cd-audit helpers", () => {
  it("round2 rounds to two decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
  });

  it("pct returns zero for empty denominator", () => {
    expect(pct(5, 0)).toBe(0);
  });

  it("pct computes rounded percentages", () => {
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(2, 3)).toBe(66.67);
  });
});

describe("auditProduct", () => {
  it("returns an empty report when product archive cannot be resolved", () => {
    const report = auditProduct("Missing", {
      resolveProductMixDirFn: () => null,
    });

    expect(report).toEqual({
      product: "Missing",
      mixCount: 0,
      trackCount: 0,
      recoveredBeatCount: 0,
      recoveredChannelCount: 0,
      recoveredBothCount: 0,
      recoveredBeatPct: 0,
      recoveredChannelPct: 0,
      recoveredBothPct: 0,
      meets80Pct: false,
    });
  });

  it("counts recovered beat/channel fields and skips null parse results", () => {
    let parseCalls = 0;
    const report = auditProduct("Dance_eJay3", {
      resolveProductMixDirFn: () => ({ productArchivePath: "archive", mixDir: "archive/MIX" }),
      collectProductMixesFn: () => [
        { filename: "a.mix", sizeBytes: 100, format: "C" },
        { filename: "b.mix", sizeBytes: 100, format: "C" },
      ],
      readFileSyncFn: () => Buffer.from([0x00]),
      parseMixFn: (_buffer, product) => {
        parseCalls += 1;
        if (parseCalls === 2) return null;
        return makeIr(product ?? "Unknown", [
          { beat: 0, channel: 1, sampleRef: sampleRef() },
          { beat: null, channel: 2, sampleRef: sampleRef() },
          { beat: 5, channel: null, sampleRef: sampleRef() },
        ]);
      },
    });

    expect(report.mixCount).toBe(1);
    expect(report.trackCount).toBe(3);
    expect(report.recoveredBeatCount).toBe(2);
    expect(report.recoveredChannelCount).toBe(2);
    expect(report.recoveredBothCount).toBe(1);
    expect(report.recoveredBeatPct).toBe(66.67);
    expect(report.recoveredChannelPct).toBe(66.67);
    expect(report.recoveredBothPct).toBe(33.33);
    expect(report.meets80Pct).toBe(false);
  });
});

describe("buildAudit", () => {
  it("builds aggregate totals and failing product list", () => {
    const report = buildAudit(["Good", "Bad"], {
      resolveProductMixDirFn: () => ({ productArchivePath: "archive", mixDir: "archive/MIX" }),
      collectProductMixesFn: () => [{ filename: "x.mix", sizeBytes: 100, format: "C" }],
      readFileSyncFn: () => Buffer.from([0x00]),
      parseMixFn: (_buffer, product) => {
        if (product === "Good") {
          return makeIr(product, [{ beat: 0, channel: 0, sampleRef: sampleRef() }]);
        }
        return makeIr(product ?? "Unknown", [{ beat: null, channel: null, sampleRef: sampleRef() }]);
      },
    });

    expect(report.aggregate.mixCount).toBe(2);
    expect(report.aggregate.trackCount).toBe(2);
    expect(report.aggregate.recoveredBothCount).toBe(1);
    expect(report.aggregate.recoveredBothPct).toBe(50);
    expect(report.acceptance.productsAllMeet80Pct).toBe(false);
    expect(report.acceptance.failingProducts).toEqual(["Bad"]);
  });
});

describe("runAuditCli", () => {
  it("prints usage and exits zero for --help", () => {
    const logs: string[] = [];
    const code = runAuditCli(["--help"], {
      log: (line) => { logs.push(line); },
    });

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Usage:");
  });

  it("prints JSON when no output path is provided", () => {
    const logs: string[] = [];
    const code = runAuditCli([], {
      log: (line) => { logs.push(line); },
      buildAuditFn: () => reportTemplate(),
    });

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("\"acceptance\"");
  });

  it("writes output to disk and returns non-zero when acceptance fails", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mix-audit-cli-"));
    try {
      const logs: string[] = [];
      const failing = reportTemplate({
        acceptance: {
          thresholdPct: 80,
          productsAllMeet80Pct: false,
          failingProducts: ["Dance_eJay3"],
        },
      });

      const code = runAuditCli(["--products", "Dance_eJay3,Techno_eJay3", "--out", "audit.json"], {
        cwd: tempDir,
        log: (line) => { logs.push(line); },
        buildAuditFn: (products) => {
          expect(products).toEqual(["Dance_eJay3", "Techno_eJay3"]);
          return failing;
        },
      });

      expect(code).toBe(2);
      expect(logs.join("\n")).toContain("Wrote");

      const outPath = join(tempDir, "audit.json");
      const parsed = JSON.parse(readFileSync(outPath, "utf-8")) as AuditReport;
      expect(parsed.acceptance.productsAllMeet80Pct).toBe(false);
      expect(parsed.acceptance.failingProducts).toEqual(["Dance_eJay3"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
