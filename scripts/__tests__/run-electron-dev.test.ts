import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

import {
  DEV_SERVER_URL,
  SERVER_RETRY_DELAY_MS,
  npmCommand,
  runElectronDev,
  spawnNpm,
  terminateProcess,
  waitForExit,
  waitForServer,
} from "../run-electron-dev.js";

interface ProcessStub {
  processRef: NodeJS.Process;
  emitter: EventEmitter;
}

function createChildProcess(overrides?: { pid?: number; killed?: boolean }): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  const mutable = emitter as ChildProcess & {
    pid?: number;
    killed: boolean;
    kill: Mock;
  };

  mutable.pid = overrides?.pid ?? 777;
  mutable.killed = overrides?.killed ?? false;
  mutable.kill = vi.fn(() => {
    mutable.killed = true;
    return true;
  });

  return mutable;
}

function createProcessStub(): ProcessStub {
  const emitter = new EventEmitter();
  const processRef = emitter as unknown as NodeJS.Process;
  processRef.on = emitter.on.bind(emitter) as NodeJS.Process["on"];
  processRef.off = emitter.off.bind(emitter) as NodeJS.Process["off"];
  processRef.exitCode = undefined;
  return { processRef, emitter };
}

describe("run-electron-dev script helpers", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("chooses the npm executable by platform", () => {
    expect(npmCommand("win32")).toBe("npm.cmd");
    expect(npmCommand("linux")).toBe("npm");
  });

  it("spawns npm with inherited stdio and merged env", () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);

    const result = spawnNpm(["run", "serve"], { EJAY_TEST_FLAG: "1" });

    expect(result).toBe(child);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      npmCommand(),
      ["run", "serve"],
      expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({
          EJAY_TEST_FLAG: "1",
        }),
      }),
    );
  });

  it("waitForExit resolves numeric exit codes", async () => {
    const child = createChildProcess();
    const pending = waitForExit(child);

    (child as unknown as EventEmitter).emit("exit", 3, null);

    await expect(pending).resolves.toBe(3);
  });

  it("waitForExit resolves 1 when process exits by signal", async () => {
    const child = createChildProcess();
    const pending = waitForExit(child);

    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");

    await expect(pending).resolves.toBe(1);
  });

  it("waitForExit resolves 0 when neither code nor signal is provided", async () => {
    const child = createChildProcess();
    const pending = waitForExit(child);

    (child as unknown as EventEmitter).emit("exit", null, null);

    await expect(pending).resolves.toBe(0);
  });

  it("waitForExit rejects when the process emits an error", async () => {
    const child = createChildProcess();
    const pending = waitForExit(child);

    (child as unknown as EventEmitter).emit("error", new Error("spawn failed"));

    await expect(pending).rejects.toThrow("spawn failed");
  });

  it("waitForServer resolves when fetch responds with ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(waitForServer(DEV_SERVER_URL, 5_000)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(DEV_SERVER_URL, { method: "GET" });
  });

  it("waitForServer retries until success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const pending = waitForServer(DEV_SERVER_URL, 5_000);
    await vi.advanceTimersByTimeAsync(SERVER_RETRY_DELAY_MS);

    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waitForServer throws on timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const timeoutMs = SERVER_RETRY_DELAY_MS * 2;
    const pending = waitForServer("http://127.0.0.1:3333/", timeoutMs);
    const rejection = expect(pending).rejects.toThrow("Timed out waiting for http://127.0.0.1:3333/");

    await vi.advanceTimersByTimeAsync(timeoutMs + SERVER_RETRY_DELAY_MS);

    await rejection;
    expect(fetchMock).toHaveBeenCalled();
  });

  it("terminateProcess only kills live child processes", () => {
    const noPid = createChildProcess({ pid: 0 });
    terminateProcess(noPid);
    expect((noPid as unknown as { kill: Mock }).kill).not.toHaveBeenCalled();

    const killed = createChildProcess({ killed: true });
    terminateProcess(killed);
    expect((killed as unknown as { kill: Mock }).kill).not.toHaveBeenCalled();

    const running = createChildProcess({ pid: 1234, killed: false });
    terminateProcess(running);
    expect((running as unknown as { kill: Mock }).kill).toHaveBeenCalledTimes(1);
  });

  it("runElectronDev stops early when build:electron fails", async () => {
    const { processRef, emitter } = createProcessStub();
    const viteProcess = createChildProcess();
    const buildProcess = createChildProcess();

    const spawnNpmFn = vi
      .fn()
      .mockReturnValueOnce(viteProcess)
      .mockReturnValueOnce(buildProcess);
    const waitForServerFn = vi.fn().mockResolvedValue(undefined);
    const waitForExitFn = vi
      .fn()
      .mockImplementation(async (child: ChildProcess) => (child === buildProcess ? 2 : 0));
    const terminateProcessFn = vi.fn();

    await runElectronDev({
      spawnNpmFn,
      waitForServerFn,
      waitForExitFn,
      terminateProcessFn,
      processRef,
      devServerUrl: "http://127.0.0.1:3001/",
      serverTimeoutMs: 321,
    });

    expect(waitForServerFn).toHaveBeenCalledWith("http://127.0.0.1:3001/", 321);
    expect(spawnNpmFn.mock.calls.map((call) => call[0])).toEqual([
      ["run", "serve"],
      ["run", "build:electron"],
    ]);
    expect(processRef.exitCode).toBe(2);
    expect(terminateProcessFn).toHaveBeenCalledWith(viteProcess);
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });

  it("runElectronDev launches electron and forwards its exit code", async () => {
    const { processRef, emitter } = createProcessStub();
    const viteProcess = createChildProcess();
    const buildProcess = createChildProcess();
    const electronProcess = createChildProcess();

    const spawnNpmFn = vi
      .fn()
      .mockReturnValueOnce(viteProcess)
      .mockReturnValueOnce(buildProcess)
      .mockReturnValueOnce(electronProcess);
    const waitForServerFn = vi.fn().mockResolvedValue(undefined);
    const waitForExitFn = vi
      .fn()
      .mockImplementation(async (child: ChildProcess) => {
        if (child === buildProcess) return 0;
        if (child === electronProcess) return 7;
        return 0;
      });
    const terminateProcessFn = vi.fn();

    await runElectronDev({
      spawnNpmFn,
      waitForServerFn,
      waitForExitFn,
      terminateProcessFn,
      processRef,
      devServerUrl: "http://127.0.0.1:3010/",
      serverTimeoutMs: 123,
    });

    expect(spawnNpmFn).toHaveBeenNthCalledWith(3, ["run", "electron", "--"], {
      EJAY_ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3010/",
    });
    expect(processRef.exitCode).toBe(7);
    expect(terminateProcessFn).toHaveBeenCalledWith(viteProcess);
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });

  it("runElectronDev propagates server startup failures and still terminates children", async () => {
    const { processRef, emitter } = createProcessStub();
    const viteProcess = createChildProcess();

    const spawnNpmFn = vi.fn().mockReturnValue(viteProcess);
    const waitForServerFn = vi.fn().mockRejectedValue(new Error("server timeout"));
    const waitForExitFn = vi.fn();
    const terminateProcessFn = vi.fn();

    await expect(runElectronDev({
      spawnNpmFn,
      waitForServerFn,
      waitForExitFn,
      terminateProcessFn,
      processRef,
    })).rejects.toThrow("server timeout");

    expect(waitForExitFn).not.toHaveBeenCalled();
    expect(terminateProcessFn).toHaveBeenCalledWith(viteProcess);
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });

  it("runElectronDev handles SIGINT by terminating child processes", async () => {
    const { processRef, emitter } = createProcessStub();
    const viteProcess = createChildProcess();
    const buildProcess = createChildProcess();
    const electronProcess = createChildProcess();

    let resolveServerReady: (value?: void | PromiseLike<void>) => void = () => undefined;
    const waitForServerFn = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveServerReady = resolve;
      });
    });

    const spawnNpmFn = vi
      .fn()
      .mockReturnValueOnce(viteProcess)
      .mockReturnValueOnce(buildProcess)
      .mockReturnValueOnce(electronProcess);
    const waitForExitFn = vi
      .fn()
      .mockImplementation(async (child: ChildProcess) => (child === buildProcess ? 0 : 0));
    const terminateProcessFn = vi.fn();

    const pending = runElectronDev({
      spawnNpmFn,
      waitForServerFn,
      waitForExitFn,
      terminateProcessFn,
      processRef,
    });

    emitter.emit("SIGINT");
    expect(terminateProcessFn).toHaveBeenCalledWith(viteProcess);

    resolveServerReady();
    await pending;
  });
});
