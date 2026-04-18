/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

declare global {
  const __APP_VERSION__: string;

  // Augments the DOM lib with File System Access API members that are not
  // included in the bundled TypeScript DOM declarations:
  // - FileSystemDirectoryHandle.entries() for async directory iteration
  // - Window.showDirectoryPicker() for the folder picker dialog
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  interface Window {
    showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

export {};
