import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, createReadStream } from "fs";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, createReadStream: vi.fn() };
});

import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { serveOutputFiles } from "../dev-server/output-files-plugin.js";

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface MockServer {
  middlewares: { use: Mock };
  config: { logger: { warn: Mock } };
}

function makeMockRes(overrides: Partial<MockRes> = {}): MockRes {
  return {
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
}

function makeMockServer(): MockServer {
  return {
    middlewares: { use: vi.fn() },
    config: { logger: { warn: vi.fn() } },
  };
}

describe("serveOutputFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a plugin named 'serve-output-files'", () => {
    expect(serveOutputFiles("/output").name).toBe("serve-output-files");
  });

  it("calls next for non-output urls", () => {
    const server = makeMockServer();
    (serveOutputFiles("/output").configureServer as ((s: never) => void) | undefined)!(server as never);
    const mw = server.middlewares.use.mock.calls[0][0] as (
      req: { url?: string; method?: string },
      res: MockRes,
      next: () => void,
    ) => void;

    const next = vi.fn();
    mw({ url: "/index.html", method: "GET" }, makeMockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("streams files from the configured output root", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-"));
    try {
      mkdirSync(join(outputRoot, "Drums"), { recursive: true });
      writeFileSync(join(outputRoot, "Drums", "kick.wav"), "RIFF");

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const fakeStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      fakeStream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(fakeStream as never);

      const res = makeMockRes();
      mw({ url: "/output/Drums/kick.wav", method: "GET" }, res, vi.fn());

      expect(res.headers["Content-Type"]).toBe("audio/wav");
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("serves HEAD requests without streaming the file body", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-head-"));
    try {
      mkdirSync(join(outputRoot, "Drums"), { recursive: true });
      writeFileSync(join(outputRoot, "Drums", "kick.wav"), "RIFF");

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const res = makeMockRes();
      mw({ url: "/output/Drums/kick.wav", method: "HEAD" }, res, vi.fn());

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(createReadStream)).not.toHaveBeenCalled();
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("uses JSON and text content types for known extensions", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-types-"));
    try {
      writeFileSync(join(outputRoot, "metadata.json"), "{}", "utf-8");
      writeFileSync(join(outputRoot, "notes.txt"), "ok", "utf-8");

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const jsonStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      jsonStream.pipe = vi.fn();
      const txtStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      txtStream.pipe = vi.fn();
      vi.mocked(createReadStream)
        .mockReturnValueOnce(jsonStream as never)
        .mockReturnValueOnce(txtStream as never);

      const jsonRes = makeMockRes();
      mw({ url: "/output/metadata.json", method: "GET" }, jsonRes, vi.fn());
      expect(jsonRes.headers["Content-Type"]).toBe("application/json; charset=utf-8");

      const txtRes = makeMockRes();
      mw({ url: "/output/notes.txt", method: "GET" }, txtRes, vi.fn());
      expect(txtRes.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("supports dynamic output root providers", () => {
    const rootA = mkdtempSync(join(tmpdir(), "serve-output-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "serve-output-b-"));
    try {
      mkdirSync(join(rootB, "Bass"), { recursive: true });
      writeFileSync(join(rootB, "Bass", "line.wav"), "RIFF");

      let currentRoot = rootA;
      const server = makeMockServer();
      (serveOutputFiles(() => currentRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      currentRoot = rootB;
      const fakeStream = new EventEmitter() as EventEmitter & { pipe: Mock };
      fakeStream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(fakeStream as never);

      const res = makeMockRes();
      mw({ url: "/output/Bass/line.wav", method: "GET" }, res, vi.fn());
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("rejects traversal attempts", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-traversal-"));
    try {
      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const res = makeMockRes();
      mw({ url: "/output/..%2Fsecret.txt", method: "GET" }, res, vi.fn());
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("Not found");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed and invalid URL segments", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-invalid-segments-"));
    try {
      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const badEncoding = makeMockRes();
      mw({ url: "/output/%ZZ.txt", method: "GET" }, badEncoding, vi.fn());
      expect(badEncoding.statusCode).toBe(404);

      const emptySegment = makeMockRes();
      mw({ url: "/output/Drums//kick.wav", method: "GET" }, emptySegment, vi.fn());
      expect(emptySegment.statusCode).toBe(404);

      const dotSegment = makeMockRes();
      mw({ url: "/output/./kick.wav", method: "GET" }, dotSegment, vi.fn());
      expect(dotSegment.statusCode).toBe(404);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("returns 404 when resolved path is a directory", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-dir-"));
    try {
      mkdirSync(join(outputRoot, "Drums"), { recursive: true });

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const res = makeMockRes();
      mw({ url: "/output/Drums", method: "GET" }, res, vi.fn());
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("Not found");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("responds 405 for unsupported methods", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-method-"));
    try {
      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const res = makeMockRes();
      mw({ url: "/output/metadata.json", method: "PUT" }, res, vi.fn());
      expect(res.statusCode).toBe(405);
      expect(res.body).toBe("Method not allowed");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("responds 500 when read stream emits an error", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-stream-err-"));
    try {
      writeFileSync(join(outputRoot, "metadata.bin"), "x", "utf-8");

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      const stream = new EventEmitter() as EventEmitter & { pipe: Mock };
      stream.pipe = vi.fn();
      vi.mocked(createReadStream).mockReturnValueOnce(stream as never);

      const res = makeMockRes();
      mw({ url: "/output/metadata.bin", method: "GET" }, res, vi.fn());
      stream.emit("error", new Error("boom"));

      expect(res.statusCode).toBe(500);
      expect(res.body).toBe("Internal error");
      expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read"));
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("responds 500 when createReadStream throws synchronously", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "serve-output-stream-throw-"));
    try {
      writeFileSync(join(outputRoot, "metadata.bin"), "x", "utf-8");

      const server = makeMockServer();
      (serveOutputFiles(outputRoot).configureServer as ((s: never) => void) | undefined)!(server as never);
      const mw = server.middlewares.use.mock.calls[0][0] as (
        req: { url?: string; method?: string },
        res: MockRes,
        next: () => void,
      ) => void;

      vi.mocked(createReadStream).mockImplementationOnce(() => {
        throw new Error("cannot-open");
      });

      const res = makeMockRes();
      mw({ url: "/output/metadata.bin", method: "GET" }, res, vi.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body).toBe("Internal error");
      expect(server.config.logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to stream"));
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
