/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

declare global {
  const __APP_VERSION__: string;
}

export {};
