/**
 * dev-server/csp.ts — Content Security Policy helpers.
 *
 * Pure functions with no Vite or http imports so they can be unit-tested
 * directly without starting a Vite server.
 *
 * Consumers:
 *   - vite.config.ts (inline `injectContentSecurityPolicy` plugin still wires
 *     the policy into the HTML transform; it imports the builder from here so
 *     the policy string can be tested independently)
 *   - scripts/__tests__/vite-csp.test.ts
 */

/** Placeholder replaced in index.html during both serve and build. */
export const CONTENT_SECURITY_POLICY_PLACEHOLDER = "__EJAY_CONTENT_SECURITY_POLICY__";

/**
 * Resolve the Vite dev-server websocket port used in CSP `connect-src`.
 * Falls back to `fallbackPort` for missing, non-numeric, or non-positive values.
 */
export function resolveDevWebSocketPort(
  value: string | undefined,
  fallbackPort = 3000,
): number {
  const fallback = Number.isFinite(fallbackPort) && fallbackPort > 0 ? fallbackPort : 3000;
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build the Content Security Policy header value.
 *
 * @param allowDevWebSocket When `true`, adds a `ws://127.0.0.1:<port>`
 *   origin to `connect-src` so Vite HMR can communicate with the browser.
 *   Set to `false` for production builds.
 * @param devWebSocketPort The local port the Vite dev server listens on.
 *   Ignored when `allowDevWebSocket` is `false`.
 */
export function buildContentSecurityPolicy(
  allowDevWebSocket: boolean,
  devWebSocketPort: number,
): string {
  const connectSrc = allowDevWebSocket
    ? `'self' ws://127.0.0.1:${devWebSocketPort}`
    : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    `connect-src ${connectSrc}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "form-action 'self'",
  ].join("; ");
}
