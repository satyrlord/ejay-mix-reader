import { contextBridge } from "electron";

interface DesktopRuntimeInfo {
  platform: NodeJS.Platform;
  mode: "desktop";
}

const runtimeInfo: DesktopRuntimeInfo = {
  platform: process.platform,
  mode: "desktop",
};

contextBridge.exposeInMainWorld("ejayDesktop", runtimeInfo);

declare global {
  interface Window {
    ejayDesktop?: DesktopRuntimeInfo;
  }
}
