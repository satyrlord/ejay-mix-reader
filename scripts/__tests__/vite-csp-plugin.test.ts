import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY_PLACEHOLDER } from "../dev-server/csp.js";
import { injectContentSecurityPolicy } from "../dev-server/csp-plugin.js";

describe("injectContentSecurityPolicy", () => {
  it("returns a plugin with the correct name", () => {
    const plugin = injectContentSecurityPolicy(false, 3000);
    expect(plugin.name).toBe("inject-content-security-policy");
  });

  it("exposes a transformIndexHtml hook", () => {
    const plugin = injectContentSecurityPolicy(false, 3000);
    expect(typeof plugin.transformIndexHtml).toBe("function");
  });

  it("replaces the placeholder in build mode — no ws:// in result", () => {
    const plugin = injectContentSecurityPolicy(false, 3000);
    const html = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY_PLACEHOLDER}">`;
    const result = (plugin.transformIndexHtml as ((html: string, ctx: never) => string | undefined) | undefined)!(html, {} as never);
    const out = typeof result === "string" ? result : html;
    expect(out).not.toContain(CONTENT_SECURITY_POLICY_PLACEHOLDER);
    expect(out).not.toContain("ws://");
    expect(out).toContain("default-src");
  });

  it("replaces the placeholder in dev mode — ws:// present with port", () => {
    const plugin = injectContentSecurityPolicy(true, 3000);
    const html = `<meta content="${CONTENT_SECURITY_POLICY_PLACEHOLDER}">`;
    const result = (plugin.transformIndexHtml as ((html: string, ctx: never) => string | undefined) | undefined)!(html, {} as never);
    const out = typeof result === "string" ? result : html;
    expect(out).not.toContain(CONTENT_SECURITY_POLICY_PLACEHOLDER);
    expect(out).toContain("ws://127.0.0.1:3000");
  });

  it("uses the supplied devWebSocketPort", () => {
    const plugin = injectContentSecurityPolicy(true, 5173);
    const html = `content="${CONTENT_SECURITY_POLICY_PLACEHOLDER}"`;
    const result = (plugin.transformIndexHtml as ((html: string, ctx: never) => string | undefined) | undefined)!(html, {} as never);
    const out = typeof result === "string" ? result : html;
    expect(out).toContain("ws://127.0.0.1:5173");
  });

  it("returns the html unchanged when the placeholder is absent", () => {
    const plugin = injectContentSecurityPolicy(false, 3000);
    const html = "<html><head></head><body></body></html>";
    const result = (plugin.transformIndexHtml as ((html: string, ctx: never) => string | undefined) | undefined)!(html, {} as never);
    const out = typeof result === "string" ? result : html;
    expect(out).toBe(html);
  });
});

