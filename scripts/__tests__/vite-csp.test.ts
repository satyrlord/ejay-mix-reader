import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY_PLACEHOLDER,
  resolveDevWebSocketPort,
} from "../dev-server/csp.js";

describe("CONTENT_SECURITY_POLICY_PLACEHOLDER", () => {
  it("is a non-empty string", () => {
    expect(typeof CONTENT_SECURITY_POLICY_PLACEHOLDER).toBe("string");
    expect(CONTENT_SECURITY_POLICY_PLACEHOLDER.length).toBeGreaterThan(0);
  });
});

describe("buildContentSecurityPolicy", () => {
  describe("build (allowDevWebSocket = false)", () => {
    const policy = buildContentSecurityPolicy(false, 3000);

    it("sets connect-src to 'self' only", () => {
      expect(policy).toContain("connect-src 'self'");
      expect(policy).not.toContain("ws://");
    });

    it("contains required directives", () => {
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("base-uri 'self'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("worker-src 'self' blob:");
      expect(policy).toContain("img-src 'self' data: blob:");
      expect(policy).toContain("media-src 'self' blob:");
      expect(policy).toContain("form-action 'self'");
    });

    it("allows Google Fonts via style-src and font-src", () => {
      expect(policy).toContain("https://fonts.googleapis.com");
      expect(policy).toContain("https://fonts.gstatic.com");
    });

    it("is a semicolon-separated single-line string", () => {
      expect(policy).not.toContain("\n");
      const directives = policy.split("; ");
      expect(directives.length).toBeGreaterThan(5);
    });
  });

  describe("dev (allowDevWebSocket = true)", () => {
    it("adds ws://127.0.0.1:<port> to connect-src", () => {
      const policy = buildContentSecurityPolicy(true, 3000);
      expect(policy).toContain("connect-src 'self' ws://127.0.0.1:3000");
    });

    it("uses the supplied port number", () => {
      const policy = buildContentSecurityPolicy(true, 5173);
      expect(policy).toContain("ws://127.0.0.1:5173");
    });

    it("does not add ws:// when port is 0 but still formats the directive", () => {
      const policy = buildContentSecurityPolicy(true, 0);
      expect(policy).toContain("ws://127.0.0.1:0");
    });
  });

  describe("connect-src differs between dev and build", () => {
    it("build connect-src does not appear in dev policy", () => {
      const dev = buildContentSecurityPolicy(true, 3000);
      const build = buildContentSecurityPolicy(false, 3000);
      expect(dev).not.toBe(build);
      expect(build).toContain("connect-src 'self'");
      expect(build).not.toContain("ws://");
    });
  });
});

describe("resolveDevWebSocketPort", () => {
  it("returns the fallback port when env is undefined", () => {
    expect(resolveDevWebSocketPort(undefined, 3000)).toBe(3000);
  });

  it("returns the parsed port when env is numeric and positive", () => {
    expect(resolveDevWebSocketPort("5173", 3000)).toBe(5173);
  });

  it("falls back when env is non-numeric", () => {
    expect(resolveDevWebSocketPort("not-a-number", 3000)).toBe(3000);
  });

  it("falls back when env is zero or negative", () => {
    expect(resolveDevWebSocketPort("0", 3000)).toBe(3000);
    expect(resolveDevWebSocketPort("-10", 3000)).toBe(3000);
  });
});
