import { contextBridge, ipcRenderer } from "electron";

const DESKTOP_REQUEST_CHANNEL = "ejay:desktop-request";

export interface DesktopBridgeRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: ArrayBuffer;
}

export interface DesktopBridgeResponse {
  status: number;
  headers: Array<[string, string]>;
  body?: ArrayBuffer;
}

interface DesktopRuntimeInfo {
  platform: NodeJS.Platform;
  mode: "desktop";
  request: (request: DesktopBridgeRequest) => Promise<DesktopBridgeResponse>;
}

const runtimeInfo: DesktopRuntimeInfo = {
  platform: process.platform,
  mode: "desktop",
  async request(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse> {
    return await ipcRenderer.invoke(DESKTOP_REQUEST_CHANNEL, request) as DesktopBridgeResponse;
  },
};

contextBridge.exposeInMainWorld("ejayDesktop", runtimeInfo);

declare global {
  interface Window {
    ejayDesktop?: DesktopRuntimeInfo;
  }
}
