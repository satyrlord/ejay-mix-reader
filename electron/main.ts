import { app, BrowserWindow, shell } from "electron";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { startRuntimeServer, type RuntimeServerHandle } from "./runtime-server.js";

let mainWindow: BrowserWindow | null = null;
let runtimeServer: RuntimeServerHandle | null = null;
let isQuitting = false;

const currentDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(currentDir, "preload.js");

function resolveAppRoot(): string {
  return app.isPackaged ? app.getAppPath() : process.cwd();
}

function resolveConfigRoot(appRoot: string): string {
  if (app.isPackaged) {
    return resolve(app.getPath("userData"), "config");
  }

  return resolve(appRoot, "data");
}

async function resolveRendererUrl(): Promise<string> {
  const devServerUrl = process.env.EJAY_ELECTRON_DEV_SERVER_URL?.trim();
  if (devServerUrl && devServerUrl.length > 0) {
    return devServerUrl;
  }

  if (!runtimeServer) {
    const appRoot = resolveAppRoot();
    runtimeServer = await startRuntimeServer({
      appRoot,
      configRoot: resolveConfigRoot(appRoot),
    });
  }

  return runtimeServer.url;
}

async function disposeRuntimeServer(): Promise<void> {
  if (!runtimeServer) return;

  const activeServer = runtimeServer;
  runtimeServer = null;
  try {
    await activeServer.close();
  } catch (error) {
    console.warn(`[electron] Failed to close runtime server: ${String(error)}`);
  }
}

async function createMainWindow(): Promise<void> {
  const startUrl = await resolveRendererUrl();

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  await window.loadURL(startUrl);
  mainWindow = window;
}

app.on("before-quit", (event) => {
  if (isQuitting) return;

  if (!runtimeServer) return;

  event.preventDefault();
  isQuitting = true;
  void disposeRuntimeServer().finally(() => {
    app.quit();
  });
});

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void disposeRuntimeServer().finally(() => {
      app.quit();
    });
  }
});
