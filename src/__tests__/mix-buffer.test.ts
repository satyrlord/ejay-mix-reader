import { describe, expect, it } from "vitest";

import { MixBuffer } from "../mix-buffer.js";

describe("MixBuffer.toString", () => {
  it("decodes latin1 byte ranges", () => {
    const buffer = new MixBuffer(Uint8Array.from([0x41, 0xe4, 0xf6, 0xfc]));
    expect(buffer.toString("latin1", 1, 4)).toBe("äöü");
  });

  it("rejects unsupported encodings at runtime", () => {
    const buffer = new MixBuffer(Uint8Array.from([0x41]));
    expect(() => buffer.toString("utf8" as never)).toThrow("Unsupported MixBuffer encoding: utf8");
  });

  it("handles long latin1 strings without overflowing call arguments", () => {
    const bytes = new Uint8Array(70000).fill(0xe4);
    const text = new MixBuffer(bytes).toString("latin1");
    expect(text).toHaveLength(70000);
    expect(text[0]).toBe("ä");
    expect(text[text.length - 1]).toBe("ä");
  });
});