/**
 * mix-buffer.ts — Lightweight `Buffer`-compatible wrapper for the browser.
 *
 * Wraps a `Uint8Array` + `DataView` and exposes the same read methods that
 * `tools/mix-parser.ts` uses on Node's `Buffer`, so the browser-side parser
 * can reuse identical parsing logic without a Node polyfill.
 */

export class MixBuffer {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  readonly length: number;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
    this.length = this.bytes.byteLength;
  }

  /** Read unsigned 8-bit integer at `offset`. */
  readUInt8(offset: number): number {
    return this.view.getUint8(offset);
  }

  /** Read unsigned 16-bit little-endian integer at `offset`. */
  readUInt16LE(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  /** Read unsigned 32-bit little-endian integer at `offset`. */
  readUInt32LE(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  /** Read signed 16-bit little-endian integer at `offset`. */
  readInt16LE(offset: number): number {
    return this.view.getInt16(offset, true);
  }

  /** Return a new `MixBuffer` backed by the same underlying memory. */
  subarray(start: number, end?: number): MixBuffer {
    return new MixBuffer(this.bytes.subarray(start, end));
  }

  /** Decode a byte range as a latin1 (ISO 8859-1) string. */
  toString(_encoding: string, start?: number, end?: number): string {
    const s = start ?? 0;
    const e = end ?? this.length;
    return latin1Decode(this.bytes, s, e);
  }

  /** Direct byte access (index operator replacement). */
  at(index: number): number {
    return this.bytes[index];
  }

  /** Iterate over raw bytes (for `for..of` and spread). */
  [Symbol.iterator](): IterableIterator<number> {
    return this.bytes[Symbol.iterator]();
  }
}

/** Decode bytes as latin1 (each byte maps 1:1 to the same Unicode code point). */
function latin1Decode(bytes: Uint8Array, start: number, end: number): string {
  // TextDecoder('latin1') is not universally supported; manual decode is
  // both safe and fast for the small strings in .mix files.
  const len = end - start;
  if (len <= 0) return "";
  const codes = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    codes[i] = bytes[start + i];
  }
  return String.fromCharCode(...codes);
}
