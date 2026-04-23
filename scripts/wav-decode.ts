/**
 * wav-decode.ts — Minimal WAV reader for sequence/loop analysis.
 *
 * Decodes 8-bit PCM, 16-bit PCM, and 24-bit PCM WAV files into a mono
 * float array in [-1, 1]. Stereo input is downmixed by averaging the
 * left and right channels. Non-PCM (compressed) WAV files throw, since
 * none of the eJay output samples use them. Use `readWavInfo` when callers
 * only need header metadata such as duration or format details.
 */

import { readFileSync } from "fs";

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  /** Mono PCM in [-1, 1] (downmixed if input was stereo). */
  samples: Float32Array;
  /** Duration in seconds, computed from sample count and sample rate. */
  duration: number;
}

const RIFF = 0x46464952; // "RIFF" little-endian
const WAVE = 0x45564157; // "WAVE"
const FMT_ = 0x20746d66; // "fmt "
const DATA = 0x61746164; // "data"

export function decodeWavBuffer(buf: Buffer): DecodedWav {
  if (buf.length < 44) {
    throw new Error(`wav-decode: buffer too small (${buf.length} bytes)`);
  }
  if (buf.readUInt32LE(0) !== RIFF || buf.readUInt32LE(8) !== WAVE) {
    throw new Error("wav-decode: not a RIFF/WAVE file");
  }

  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.readUInt32LE(offset);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkBody = offset + 8;

    if (chunkId === FMT_) {
      format = buf.readUInt16LE(chunkBody);
      channels = buf.readUInt16LE(chunkBody + 2);
      sampleRate = buf.readUInt32LE(chunkBody + 4);
      bitDepth = buf.readUInt16LE(chunkBody + 14);
    } else if (chunkId === DATA) {
      dataOffset = chunkBody;
      dataSize = Math.min(chunkSize, buf.length - chunkBody);
      break;
    }

    // Chunks are word-aligned.
    offset = chunkBody + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) throw new Error("wav-decode: no data chunk");
  if (format !== 1) throw new Error(`wav-decode: unsupported format ${format} (PCM only)`);
  if (channels < 1 || channels > 2) {
    throw new Error(`wav-decode: unsupported channel count ${channels}`);
  }
  if (bitDepth !== 8 && bitDepth !== 16 && bitDepth !== 24) {
    throw new Error(`wav-decode: unsupported bit depth ${bitDepth}`);
  }

  const bytesPerSample = bitDepth / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    const frameStart = dataOffset + i * frameSize;
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const sampleStart = frameStart + c * bytesPerSample;
      sum += readSample(buf, sampleStart, bitDepth);
    }
    samples[i] = sum / channels;
  }

  return {
    sampleRate,
    channels,
    bitDepth,
    samples,
    duration: sampleRate > 0 ? frameCount / sampleRate : 0,
  };
}

export function decodeWavFile(path: string): DecodedWav {
  return decodeWavBuffer(readFileSync(path));
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  /** Raw PCM data size in bytes. */
  dataSize: number;
  /** Duration in seconds. */
  duration: number;
}

/**
 * Read WAV header metadata without decoding PCM samples.
 *
 * @param buf RIFF/WAVE file contents.
 * @returns Parsed sample rate, channels, bit depth, data size, and duration.
 */
export function readWavInfo(buf: Buffer): WavInfo {
  if (buf.length < 44) {
    throw new Error(`wav-decode: buffer too small (${buf.length} bytes)`);
  }
  if (buf.readUInt32LE(0) !== RIFF || buf.readUInt32LE(8) !== WAVE) {
    throw new Error("wav-decode: not a RIFF/WAVE file");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let dataSize = 0;
  let foundFmt = false;
  let foundData = false;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.readUInt32LE(offset);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkBody = offset + 8;

    if (chunkId === FMT_) {
      channels = buf.readUInt16LE(chunkBody + 2);
      sampleRate = buf.readUInt32LE(chunkBody + 4);
      bitDepth = buf.readUInt16LE(chunkBody + 14);
      foundFmt = true;
    } else if (chunkId === DATA) {
      dataSize = Math.min(chunkSize, buf.length - chunkBody);
      foundData = true;
      break;
    }

    offset = chunkBody + chunkSize + (chunkSize % 2);
  }

  if (!foundFmt) throw new Error("wav-decode: no fmt chunk");
  if (!foundData) throw new Error("wav-decode: no data chunk");

  const bytesPerSample = bitDepth / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = frameSize > 0 ? Math.floor(dataSize / frameSize) : 0;
  const duration = sampleRate > 0 ? frameCount / sampleRate : 0;

  return { sampleRate, channels, bitDepth, dataSize, duration };
}

function readSample(buf: Buffer, offset: number, bitDepth: number): number {
  if (bitDepth === 8) {
    // 8-bit PCM is unsigned 0..255 with midpoint 128.
    return (buf.readUInt8(offset) - 128) / 128;
  }
  if (bitDepth === 16) {
    return buf.readInt16LE(offset) / 32768;
  }
  // 24-bit signed little-endian.
  const b0 = buf.readUInt8(offset);
  const b1 = buf.readUInt8(offset + 1);
  const b2 = buf.readUInt8(offset + 2);
  let v = b0 | (b1 << 8) | (b2 << 16);
  if (v & 0x800000) v |= ~0xffffff; // sign extend
  return v / 8388608;
}
