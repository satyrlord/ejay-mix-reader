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

describe("MixBuffer integer reads", () => {
  it("reads signed 32-bit little-endian values, including boundaries", () => {
    const buffer = new MixBuffer(Uint8Array.from([
      0xff, 0xff, 0xff, 0xff, // -1
      0x00, 0x00, 0x00, 0x80, // INT32_MIN
      0xff, 0xff, 0xff, 0x7f, // INT32_MAX
      0x00, 0x00, 0x00, 0x00, // 0
    ]));

    expect(buffer.readInt32LE(0)).toBe(-1);
    expect(buffer.readInt32LE(4)).toBe(-2147483648);
    expect(buffer.readInt32LE(8)).toBe(2147483647);
    expect(buffer.readInt32LE(12)).toBe(0);
  });
});