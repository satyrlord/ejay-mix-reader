import { spawn, type ChildProcess } from "child_process";
import { pathToFileURL } from "url";

export const DEV_SERVER_URL = process.env.EJAY_ELECTRON_DEV_SERVER_URL ?? "http://127.0.0.1:3000/";
export const SERVER_TIMEOUT_MS = 90_000;
export const SERVER_RETRY_DELAY_MS = 500;

export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function spawnNpm(args: string[], extraEnv?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(npmCommand(), args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

export async function waitForExit(child: ChildProcess): Promise<number> {
  return await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (typeof code === "number") {
        resolveCode(code);
        return;
      }

      if (signal) {
        resolveCode(1);
        return;
      }

      resolveCode(0);
    });
  });
}

export async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Server may not be ready yet.
    }

    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, SERVER_RETRY_DELAY_MS);
    });
  }

  throw new Error(`Timed out waiting for ${url}`);
}

export function terminateProcess(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  child.kill();
}

export interface RunElectronDevDeps {
  spawnNpmFn: typeof spawnNpm;
  waitForServerFn: typeof waitForServer;
  waitForExitFn: typeof waitForExit;
  terminateProcessFn: typeof terminateProcess;
  processRef: NodeJS.Process;
  devServerUrl: string;
  serverTimeoutMs: number;
}

export async function runElectronDev(
  deps: Partial<RunElectronDevDeps> = {},
): Promise<void> {
  const spawnNpmFn = deps.spawnNpmFn ?? spawnNpm;
  const waitForServerFn = deps.waitForServerFn ?? waitForServer;
  const waitForExitFn = deps.waitForExitFn ?? waitForExit;
  const terminateProcessFn = deps.terminateProcessFn ?? terminateProcess;
  const processRef = deps.processRef ?? process;
  const devServerUrl = deps.devServerUrl ?? DEV_SERVER_URL;
  const serverTimeoutMs = deps.serverTimeoutMs ?? SERVER_TIMEOUT_MS;

  const viteProcess = spawnNpmFn(["run", "serve"]);

  const terminateChildren = (): void => {
    terminateProcessFn(viteProcess);
  };

  const onSigInt = (): void => {
    terminateChildren();
  };
  const onSigTerm = (): void => {
    terminateChildren();
  };

  processRef.on("SIGINT", onSigInt);
  processRef.on("SIGTERM", onSigTerm);

  try {
    await waitForServerFn(devServerUrl, serverTimeoutMs);

    const buildElectron = spawnNpmFn(["run", "build:electron"]);
    const buildCode = await waitForExitFn(buildElectron);
    if (buildCode !== 0) {
      processRef.exitCode = buildCode;
      terminateChildren();
      return;
    }

    const electronProcess = spawnNpmFn(["run", "electron", "--"], {
      EJAY_ELECTRON_DEV_SERVER_URL: devServerUrl,
    });

    const electronCode = await waitForExitFn(electronProcess);
    processRef.exitCode = electronCode;
  } finally {
    terminateChildren();
    processRef.off("SIGINT", onSigInt);
    processRef.off("SIGTERM", onSigTerm);
  }
}

export async function main(): Promise<void> {
  await runElectronDev();
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  void main();
}
