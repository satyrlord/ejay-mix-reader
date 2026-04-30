import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { describe, expect, it } from "vitest";

import { MixBuffer } from "../../src/mix-parser.js";
import {
  analyzeMix,
  buildGroups,
  caseInsensitiveMixName,
  compareReports,
  ensureParent,
  extractRecords,
  findNameField,
  hexByte,
  lockstepCandidate,
  readUInt32LESafe,
  readUInt8Safe,
  readWindowHex,
  recordGroupKey,
  runDiffCli,
  scoreCandidates,
  scoreCompactGapCandidates,
  toMarkdown,
  type DiffReport,
  type FieldCandidate,
  usage,
} from "../mix-format-cd-diff.js";

const PATH_D = "C:\\WINDOWS\\TEMP\\pxd32pd.tmp";
const PATH_E = "C:\\WINDOWS\\TEMP\\pxd32pe.tmp";

function makeBuffer(size = 512): Buffer {
  return Buffer.alloc(size, 0x20);
}

function writeCompactNameField(buf: Buffer, pathStart: number, name: string, gap = 10): void {
  const nameOffset = pathStart - gap - name.length - 2;
  buf.writeUInt16LE(name.length, nameOffset);
  buf.write(name, nameOffset + 2, "latin1");
}

function writeBigNameField(buf: Buffer, pathStart: number, name: string): void {
  const nameEnd = pathStart - 40;
  const nameLen = name.length + 2;
  const nameOffset = nameEnd - nameLen - 2;
  buf.writeUInt16LE(nameLen, nameOffset);
  buf.write(name, nameOffset + 2, "latin1");
  buf.writeUInt8(0x00, nameOffset + 2 + name.length);
  buf.writeUInt8(0x01, nameOffset + 2 + name.length + 1);
}

function makeFormatCBuffer(): Buffer {
  const buf = makeBuffer(420);

  const bigPathStart = 160;
  writeBigNameField(buf, bigPathStart, "kick09");
  buf.writeUInt32LE(253, bigPathStart - 22); // dataLength
  buf.writeUInt32LE(42, bigPathStart - 18); // beat
  buf.writeUInt8(7, bigPathStart - 13); // channel
  buf.write(PATH_D, bigPathStart, "latin1");

  const compactPathStart = 300;
  writeCompactNameField(buf, compactPathStart, "snare01", 10);
  buf.writeUInt8(0x55, compactPathStart - 8);
  buf.write(PATH_E, compactPathStart, "latin1");

  return buf;
}

function makeFormatDBuffer(): Buffer {
  const buf = makeBuffer(320);
  const pathStart = 120;
  writeCompactNameField(buf, pathStart, "vox01", 10);
  buf.write(PATH_D, pathStart, "latin1");
  const rightStart = pathStart + PATH_D.length + 2;
  buf.write(PATH_E, rightStart, "latin1");
  return buf;
}

function makeDiffReport(lockstepPassed = true): DiffReport {
  return {
    product: "Dance_eJay3",
    mix: "start.mix",
    mixPath: "archive/Dance eJay 3/Mix/start.mix",
    format: "C",
    afterCatalogs: 0,
    recordCount: 1,
    records: [
      {
        trackIndex: 0,
        format: "C",
        pathStart: 100,
        pathEnd: 100 + PATH_D.length,
        path: PATH_D,
        displayName: "kick09",
        gap: 10,
        beat: 0,
        channel: 0,
        dataLength: null,
        preWindowHex: "AA BB CC",
      },
    ],
    groups: [
      {
        key: "name:kick09",
        count: 1,
        recordIndexes: [0],
        diffOffsets: [-10],
        beatsKnown: 1,
        channelsKnown: 1,
      },
    ],
    fieldAnalysis: {
      field: "beat",
      width: 4,
      compactRecordCount: 1,
      allCandidates: [],
      compactCandidates: [
        {
          offset: -10,
          width: 4,
          valueCount: 8,
          uniqueCount: 6,
          monotonicViolations: 1,
          exampleValues: [0, 1, 2],
        },
      ],
      lockstepPassed,
      lockstepOffset: lockstepPassed ? -10 : null,
    },
  };
}

describe("mix-format-cd-diff helpers", () => {
  it("prints a usage string with examples", () => {
    expect(usage()).toContain("Usage:");
    expect(usage()).toContain("Examples:");
  });

  it("formats hex bytes and reads safe integer windows", () => {
    const buf = new MixBuffer(Buffer.from([0xab, 0xcd, 0xef, 0x01]));
    expect(hexByte(0xab)).toBe("AB");
    expect(readUInt8Safe(buf, 0)).toBe(0xab);
    expect(readUInt8Safe(buf, -1)).toBeNull();
    expect(readUInt32LESafe(buf, 0)).toBe(0x01efcdab);
    expect(readUInt32LESafe(buf, 1)).toBeNull();
    expect(readWindowHex(buf, 0, 3)).toBe("AB CD EF");
  });

  it("finds big-gap and compact name fields", () => {
    const cBuffer = makeFormatCBuffer();
    const mb = new MixBuffer(cBuffer);

    const big = findNameField(mb, 0, 160);
    expect(big).toEqual({ offset: big?.offset ?? -1, name: "kick09", gap: 40 });

    const compact = findNameField(mb, 0, 300);
    expect(compact).toEqual({ offset: compact?.offset ?? -1, name: "snare01", gap: 10 });

    const missing = findNameField(mb, 350, 380);
    expect(missing).toBeNull();
  });

  it("extracts Format C records with big and compact variants", () => {
    const records = extractRecords(new MixBuffer(makeFormatCBuffer()), "C", 0);
    expect(records).toHaveLength(2);

    const [big, compact] = records;
    expect(big?.displayName).toBe("kick09");
    expect(big?.gap).toBe(40);
    expect(big?.beat).toBe(42);
    expect(big?.channel).toBe(7);
    expect(big?.dataLength).toBe(253);

    expect(compact?.displayName).toBe("snare01");
    expect(compact?.gap).toBe(10);
    expect(compact?.beat).toBeNull();
    expect(compact?.channel).toBeNull();
  });

  it("extracts paired Format D records as a single placement", () => {
    const records = extractRecords(new MixBuffer(makeFormatDBuffer()), "D", 0);
    expect(records).toHaveLength(1);
    expect(records[0]?.displayName).toBe("vox01");
    expect(records[0]?.beat).toBeNull();
    expect(records[0]?.channel).toBeNull();
  });

  it("groups records by display name and computes varying pre-path byte offsets", () => {
    const buf = makeBuffer(260);
    const records = [
      {
        trackIndex: 0,
        format: "C" as const,
        pathStart: 100,
        pathEnd: 100 + PATH_D.length,
        path: PATH_D,
        displayName: "KickA",
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
      {
        trackIndex: 1,
        format: "C" as const,
        pathStart: 150,
        pathEnd: 150 + PATH_D.length,
        path: PATH_D,
        displayName: "KickA",
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
    ];
    buf.writeUInt8(0x10, 99);
    buf.writeUInt8(0x20, 149);

    const groups = buildGroups(new MixBuffer(buf), records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("name:kicka");
    expect(groups[0]?.diffOffsets).toContain(-1);
    expect(recordGroupKey(records[0]!)).toBe("name:kicka");
    expect(recordGroupKey({ ...records[0]!, displayName: null, path: "C:\\WINDOWS\\TEMP\\FOO.TMP" })).toBe("tmp:foo.tmp");
  });

  it("scores generic and compact candidates", () => {
    const buf = makeBuffer(260);
    const records = [
      {
        trackIndex: 0,
        format: "C" as const,
        pathStart: 100,
        pathEnd: 110,
        path: PATH_D,
        displayName: null,
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
      {
        trackIndex: 1,
        format: "C" as const,
        pathStart: 120,
        pathEnd: 130,
        path: PATH_D,
        displayName: null,
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
      {
        trackIndex: 2,
        format: "C" as const,
        pathStart: 140,
        pathEnd: 150,
        path: PATH_D,
        displayName: null,
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
      {
        trackIndex: 3,
        format: "C" as const,
        pathStart: 160,
        pathEnd: 170,
        path: PATH_D,
        displayName: null,
        gap: 10,
        beat: null,
        channel: null,
        dataLength: null,
        preWindowHex: "",
      },
    ];

    for (const rec of records) {
      buf.writeUInt8(rec.trackIndex * 3, rec.pathStart - 1);
      buf.writeUInt32LE(rec.trackIndex + 1, rec.pathStart - 10);
    }

    const candidates8 = scoreCandidates(new MixBuffer(buf), records, 1);
    expect(candidates8.length).toBeGreaterThan(0);

    const compactCandidates = scoreCompactGapCandidates(new MixBuffer(buf), records, 4);
    expect(compactCandidates.length).toBeGreaterThan(0);

    const none = scoreCompactGapCandidates(new MixBuffer(buf), [{ ...records[3]!, gap: null }], 1);
    expect(none).toEqual([]);
  });

  it("selects lockstep candidates under monotonic constraints", () => {
    const good: FieldCandidate[] = [
      {
        offset: -10,
        width: 4,
        valueCount: 8,
        uniqueCount: 6,
        monotonicViolations: 1,
        exampleValues: [1, 2, 3],
      },
    ];
    expect(lockstepCandidate(good)?.offset).toBe(-10);

    const bad: FieldCandidate[] = [
      {
        offset: -9,
        width: 4,
        valueCount: 8,
        uniqueCount: 1,
        monotonicViolations: 6,
        exampleValues: [0],
      },
    ];
    expect(lockstepCandidate(bad)).toBeNull();
  });

  it("renders markdown reports", () => {
    const markdown = toMarkdown(makeDiffReport(true));
    expect(markdown).toContain("# C/D Diff Report");
    expect(markdown).toContain("## Field Candidates (beat)");
    expect(markdown).toContain("## Record Preview");
  });

  it("creates parent directories and resolves case-insensitive mix names", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mix-diff-paths-"));
    try {
      const nested = join(tempDir, "nested", "out", "report.json");
      ensureParent(nested);
      expect(existsSync(dirname(nested))).toBe(true);

      const mixDir = join(tempDir, "mixes");
      ensureParent(join(mixDir, "x"));
      writeFileSync(join(mixDir, "Start.MIX"), Buffer.from([0x00]));

      expect(caseInsensitiveMixName(mixDir, "start.mix")).toBe("Start.MIX");
      expect(caseInsensitiveMixName(mixDir, "missing.mix")).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("analyzeMix", () => {
  it("analyzes synthetic Format C data with field scoring", () => {
    const report = analyzeMix("Dance_eJay3", "start.mix", "beat", {
      archiveDir: "archive",
      resolveProductMixDirFn: () => ({ productArchivePath: "archive/Dance", mixDir: "archive/Dance/MIX" }),
      readdirSyncFn: () => ["Start.MIX"],
      readFileSyncFn: () => makeFormatCBuffer(),
      detectFormatFn: () => "C",
      parseCatalogsFn: () => ({ catalogs: [], endOffset: 0 }),
    });

    expect(report.format).toBe("C");
    expect(report.recordCount).toBeGreaterThan(0);
    expect(report.fieldAnalysis?.field).toBe("beat");
  });

  it("analyzes synthetic Format D data", () => {
    const report = analyzeMix("HipHop_eJay4", "start.mix", "channel", {
      archiveDir: "archive",
      resolveProductMixDirFn: () => ({ productArchivePath: "archive/HipHop", mixDir: "archive/HipHop/MIX" }),
      readdirSyncFn: () => ["start.mix"],
      readFileSyncFn: () => makeFormatDBuffer(),
      detectFormatFn: () => "D",
      parseCatalogsFn: () => ({ catalogs: [], endOffset: 0 }),
    });

    expect(report.format).toBe("D");
    expect(report.recordCount).toBe(1);
    expect(report.fieldAnalysis?.field).toBe("channel");
  });

  it("falls back to afterCatalogs=0 when catalog parsing throws", () => {
    const report = analyzeMix("Dance_eJay3", "start.mix", undefined, {
      archiveDir: "archive",
      resolveProductMixDirFn: () => ({ productArchivePath: "archive/Dance", mixDir: "archive/Dance/MIX" }),
      readdirSyncFn: () => ["Start.MIX"],
      readFileSyncFn: () => makeFormatCBuffer(),
      detectFormatFn: () => "C",
      parseCatalogsFn: () => { throw new Error("catalog parse failed"); },
    });

    expect(report.afterCatalogs).toBe(0);
  });

  it("throws when product archive cannot be resolved", () => {
    expect(() => analyzeMix("Missing", "start.mix", undefined, {
      resolveProductMixDirFn: () => null,
    })).toThrow(/Archive\/MIX folder missing/);
  });

  it("throws when the requested mix file cannot be found", () => {
    expect(() => analyzeMix("Dance_eJay3", "start.mix", undefined, {
      resolveProductMixDirFn: () => ({ productArchivePath: "archive/Dance", mixDir: "archive/Dance/MIX" }),
      readdirSyncFn: () => ["other.mix"],
    })).toThrow(/Mix not found/);
  });

  it("throws when format is not C or D", () => {
    expect(() => analyzeMix("Dance_eJay3", "start.mix", undefined, {
      resolveProductMixDirFn: () => ({ productArchivePath: "archive/Dance", mixDir: "archive/Dance/MIX" }),
      readdirSyncFn: () => ["start.mix"],
      readFileSyncFn: () => makeFormatCBuffer(),
      detectFormatFn: () => "B",
    })).toThrow(/Expected C\/D mix/);
  });
});

describe("compareReports and runDiffCli", () => {
  it("compares compact candidate offsets from two JSON reports", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mix-diff-compare-"));
    try {
      const leftPath = join(tempDir, "left.json");
      const rightPath = join(tempDir, "right.json");

      writeFileSync(leftPath, JSON.stringify(makeDiffReport(true), null, 2), "utf-8");
      const right = makeDiffReport(true);
      right.fieldAnalysis = {
        ...right.fieldAnalysis!,
        compactCandidates: [
          {
            offset: -10,
            width: 4,
            valueCount: 6,
            uniqueCount: 4,
            monotonicViolations: 1,
            exampleValues: [1, 2],
          },
        ],
      };
      writeFileSync(rightPath, JSON.stringify(right, null, 2), "utf-8");

      const md = compareReports(leftPath, rightPath);
      expect(md).toContain("# Candidate Comparison");
      expect(md).toContain("| -10 |");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles help and argument validation branches", () => {
    const logs: string[] = [];
    const errors: string[] = [];

    expect(runDiffCli(["--help"], {
      log: (line) => { logs.push(line); },
      error: (line) => { errors.push(line); },
    })).toBe(0);
    expect(logs.join("\n")).toContain("Usage:");

    expect(runDiffCli(["--compare"], {
      log: (line) => { logs.push(line); },
      error: (line) => { errors.push(line); },
    })).toBe(1);
    expect(errors.join("\n")).toContain("Compare mode requires two JSON report paths.");

    expect(runDiffCli([], {
      log: (line) => { logs.push(line); },
      error: (line) => { errors.push(line); },
    })).toBe(1);
    expect(errors.join("\n")).toContain("Primary mode requires --product and --mix.");
  });

  it("supports compare mode output writing", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mix-diff-cli-compare-"));
    try {
      const outPath = "compare.md";
      const code = runDiffCli(["--compare", "left.json", "right.json", "--out-md", outPath], {
        cwd: tempDir,
        compareReportsFn: () => "# compared\n",
      });

      expect(code).toBe(0);
      expect(readFileSync(join(tempDir, outPath), "utf-8")).toContain("# compared");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports compare mode stdout logging when no out-md is set", () => {
    const logs: string[] = [];
    const code = runDiffCli(["--compare", "left.json", "right.json"], {
      log: (line) => { logs.push(line); },
      compareReportsFn: () => "# compared-stdout\n",
    });

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("# compared-stdout");
  });

  it("supports primary mode JSON/stdout and lockstep assertion failure", () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const okCode = runDiffCli(["--product", "Dance_eJay3", "--mix", "start.mix"], {
      log: (line) => { logs.push(line); },
      error: (line) => { errors.push(line); },
      analyzeMixFn: () => makeDiffReport(true),
    });
    expect(okCode).toBe(0);
    expect(logs.join("\n")).toContain("\"recordCount\"");

    const failCode = runDiffCli([
      "--product", "Dance_eJay3",
      "--mix", "start.mix",
      "--assert-lockstep",
    ], {
      log: (line) => { logs.push(line); },
      error: (line) => { errors.push(line); },
      analyzeMixFn: () => makeDiffReport(false),
    });

    expect(failCode).toBe(2);
    expect(errors.join("\n")).toContain("No lockstep candidate passed the heuristic threshold.");
  });

  it("writes primary mode JSON and markdown reports", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mix-diff-cli-primary-"));
    try {
      const code = runDiffCli([
        "--product", "Dance_eJay3",
        "--mix", "start.mix",
        "--out-json", "out/report.json",
        "--out-md", "out/report.md",
      ], {
        cwd: tempDir,
        analyzeMixFn: () => makeDiffReport(true),
      });

      expect(code).toBe(0);
      expect(existsSync(join(tempDir, "out", "report.json"))).toBe(true);
      expect(existsSync(join(tempDir, "out", "report.md"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
