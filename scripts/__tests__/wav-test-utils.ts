export function buildPcmWav({
  sampleRate,
  channels,
  bitDepth,
  samples,
}: {
  sampleRate: number;
  channels: number;
  bitDepth: 8 | 16 | 24;
  samples: number[];
}): Buffer {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const offset = 44 + i * bytesPerSample;
    if (bitDepth === 8) {
      buf.writeUInt8(samples[i] & 0xff, offset);
    } else if (bitDepth === 16) {
      buf.writeInt16LE(samples[i], offset);
    } else {
      const value = samples[i] & 0xffffff;
      buf.writeUInt8(value & 0xff, offset);
      buf.writeUInt8((value >> 8) & 0xff, offset + 1);
      buf.writeUInt8((value >> 16) & 0xff, offset + 2);
    }
  }

  return buf;
}

export function buildSilentPcmWav({
  sampleRate,
  channels,
  bitDepth,
  numFrames,
}: {
  sampleRate: number;
  channels: number;
  bitDepth: 8 | 16 | 24;
  numFrames: number;
}): Buffer {
  return buildPcmWav({
    sampleRate,
    channels,
    bitDepth,
    samples: new Array(numFrames * channels).fill(0),
  });
}