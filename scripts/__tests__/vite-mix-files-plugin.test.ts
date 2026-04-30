import { EventEmitter } from "events";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";

// vi.mock is hoisted before imports by Vitest — only createReadStream is replaced
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, createReadStream: vi.fn() };
});
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { copyMixFilesPlugin, serveMixFiles } from "../dev-server/mix-files-plugin.js";

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
  pipe?: Mock;
}

function makeMockRes(overrides: Partial<MockRes> = {}): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk !== undefined) this.body = chunk;
    },
    ...overrides,
  };
  return res;
}

interface MockServer {
  middlewares: { use: Mock };
  config: { logger: { warn: Mock } };
}

function makeMockServer(): MockServer {
  return {
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn() } },
  };
}

// ---------------------------------------------------------------------------
// serveMixFiles
// ---------------------------------------------------------------------------

describe("serveMixFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'serve-mix-files'", () => {
    expect(serveMixFiles("/archive").name).toBe("serve-mix-files");
  });

  it("has a configureServer hook", () => {
    expect(typeof serveMixFiles("/archive").configureServer).toBe("function");
  });

  it("calls next() when URL does not start with /mix/", () => {
    const server = makeMockServer();
    (serveMixFiles("/archive").configureServer as ((s: never) => void) | undefined)!(server as never);
    const mw = server.middlewares.use.mock.calls[0][0] as (
      req: unknown,
      res: MockRes,
      next: () => void,
    ) => void;
    const next = vi.fn();
    mw({ url: "/index.html" }, makeMockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when URL is undefined", () => {
    const server = makeMockServer();
    (serveMixFiles("/archive").configureServer as ((s: never) => void) | undefined)!(server as never);
    const mw = server.middlewares.use.mock.calls[0][0] as (
      req: unknown,
      res: MockRes,
      next: () => void,
    ) => void;
    const next = vi.fn();
    mw({ url: undefined }, makeMockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("responds 404 when resolveMixUrl returns null", () => {
    const server = makeMockServer();
    (serveMixFiles("/archive").configureServer as ((s: never) => void) | undefined)!(server as never);
    const mw = server.middlewares.use.mock.calls[0][0] as (
      req: unknown,
      res: MockRes,
      next: () => void,
    ) => void;
    const res = makeMockRes();
    // An unknown productId that isn't in ARCHIVE_MIX_DIRS
    mw({ url: "/mix/unknown-product/file.mix" }, res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
  });

  it("streams the file for a valid archive mix URL", async () => {
    // Build a temp archive directory matching ARCHIVE_MIX_DIRS["Dance_eJay1"]
    const archiveRoot = mkdtempSync(join(tmpdir(), "serve-mix-test-"));
    try {
      mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
      writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "data");

      const server = makeMockServer();
      (serveMixFiles(archiveRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: unknown,
        next: () => void,
      ) => void;

      const fakeStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      fakeStream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(fakeStream as never);

      const res = makeMockRes();
      mw({ url: "/mix/Dance_eJay1/START.MIX" }, res, vi.fn());

      expect(res.headers["Content-Type"]).toBe("application/octet-stream");
      expect(res.headers["Cache-Control"]).toBe("no-cache");
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it("handles a stream error by logging and responding 500", () => {
    const archiveRoot = mkdtempSync(join(tmpdir(), "serve-mix-err-"));
    try {
      mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
      writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "data");

      const server = makeMockServer();
      (serveMixFiles(archiveRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: unknown,
        next: () => void,
      ) => void;

      const fakeStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      fakeStream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(fakeStream as never);

      const res = makeMockRes();
      mw({ url: "/mix/Dance_eJay1/START.MIX" }, res, vi.fn());

      // Simulate a read error
      fakeStream.emit("error", new Error("disk read failed"));

      expect(res.statusCode).toBe(500);
      expect(server.config.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("disk read failed"),
      );
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it("skips body when writableEnded is true on stream error", () => {
    const archiveRoot = mkdtempSync(join(tmpdir(), "serve-mix-ended-"));
    try {
      mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
      writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "data");

      const server = makeMockServer();
      (serveMixFiles(archiveRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: unknown,
        next: () => void,
      ) => void;

      const fakeStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      fakeStream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(fakeStream as never);

      const endSpy = vi.fn();
      const res = makeMockRes({ writableEnded: true, end: endSpy });
      mw({ url: "/mix/Dance_eJay1/START.MIX" }, res, vi.fn());
      fakeStream.emit("error", new Error("closed"));

      // Should log but not call res.end (writableEnded = true)
      expect(endSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it("responds 500 when createReadStream throws synchronously", () => {
    const archiveRoot = mkdtempSync(join(tmpdir(), "serve-mix-throw-"));
    try {
      mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
      writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "data");

      const server = makeMockServer();
      (serveMixFiles(archiveRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: unknown,
        next: () => void,
      ) => void;

      vi.mocked(createReadStream).mockImplementationOnce(() => {
        throw new Error("cannot open");
      });

      const res = makeMockRes();
      mw({ url: "/mix/Dance_eJay1/START.MIX" }, res, vi.fn());

      expect(res.statusCode).toBe(500);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// copyMixFilesPlugin
// ---------------------------------------------------------------------------

describe("copyMixFilesPlugin", () => {
  let archiveRoot: string;
  let destDir: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(join(tmpdir(), "copy-mix-src-"));
    destDir = mkdtempSync(join(tmpdir(), "copy-mix-dst-"));
    // Provide at least one valid .mix file for Dance_eJay1
    mkdirSync(join(archiveRoot, "Dance_eJay1", "MIX"), { recursive: true });
    writeFileSync(join(archiveRoot, "Dance_eJay1", "MIX", "START.MIX"), "payload");
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'copy-mix-files' with apply = 'build'", () => {
    const plugin = copyMixFilesPlugin(archiveRoot);
    expect(plugin.name).toBe("copy-mix-files");
    expect(plugin.apply).toBe("build");
  });

  it("copies files returned by listMixFilesForCopy into the output dir", () => {
    // Redirect outDir to our temp destDir by mocking process.cwd()
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(destDir);
    const plugin = copyMixFilesPlugin(archiveRoot);
    (plugin as { closeBundle(): void }).closeBundle();
    cwdSpy.mockRestore();

    const dest = resolve(destDir, "dist", "mix", "Dance_eJay1", "START.MIX");
    expect(existsSync(dest)).toBe(true);
  });

  it("creates the product directory when it does not exist", () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(destDir);
    const plugin = copyMixFilesPlugin(archiveRoot);
    (plugin as { closeBundle(): void }).closeBundle();
    cwdSpy.mockRestore();

    expect(existsSync(resolve(destDir, "dist", "mix", "Dance_eJay1"))).toBe(true);
  });
});

