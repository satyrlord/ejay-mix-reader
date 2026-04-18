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
  toString(encoding: MixBufferEncoding = "latin1", start?: number, end?: number): string {
    // Keep the runtime guard for JS callers and future encoding expansion.
    if (encoding !== "latin1") {
      throw new Error(`Unsupported MixBuffer encoding: ${encoding}`);
    }

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

export type MixBufferEncoding = "latin1";

const LATIN1_DECODE_CHUNK_SIZE = 0x8000;

/** Decode bytes as latin1 (each byte maps 1:1 to the same Unicode code point). */
function latin1Decode(bytes: Uint8Array, start: number, end: number): string {
  const len = end - start;
  if (len <= 0) return "";

  let decoded = "";
  for (let offset = start; offset < end; offset += LATIN1_DECODE_CHUNK_SIZE) {
    const chunkEnd = Math.min(end, offset + LATIN1_DECODE_CHUNK_SIZE);
    const chunkLength = chunkEnd - offset;
    const codes = new Array<number>(chunkLength);
    for (let index = 0; index < chunkLength; index++) {
      codes[index] = bytes[offset + index];
    }
    decoded += String.fromCharCode(...codes);
  }

  return decoded;
}
