/**
 * dev-server/csp-plugin.ts — Vite plugin that injects the Content-Security-Policy
 * meta tag into index.html during both dev and build.
 *
 * Wraps the pure CSP helpers from `csp.ts` in a Vite plugin shell so that
 * the placeholder in index.html is replaced with the computed policy before
 * the page is served or written to disk.
 *
 * Consumers:
 *   - vite.config.ts
 *   - scripts/__tests__/vite-csp-plugin.test.ts
 */

import type { Plugin } from "vite";

import {
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY_PLACEHOLDER,
} from "./csp.js";

/**
 * Returns a Vite `transformIndexHtml` plugin that replaces the CSP placeholder
 * in `index.html` with the computed Content-Security-Policy header value.
 *
 * @param allowDevWebSocket When `true` (dev mode), appends
 *   `ws://127.0.0.1:<port>` to `connect-src` so Vite HMR sockets are allowed.
 * @param devWebSocketPort  The port Vite's dev server is listening on.
 */
export function injectContentSecurityPolicy(
  allowDevWebSocket: boolean,
  devWebSocketPort: number,
): Plugin {
  const policy = buildContentSecurityPolicy(allowDevWebSocket, devWebSocketPort);

  return {
    name: "inject-content-security-policy",
    transformIndexHtml(html) {
      return html.replace(CONTENT_SECURITY_POLICY_PLACEHOLDER, policy);
    },
  };
}
