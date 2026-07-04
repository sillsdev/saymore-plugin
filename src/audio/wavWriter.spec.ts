import { describe, it, expect } from "vitest";
import { encodeWavPcm16Mono } from "./wavWriter";
import { decodeWav } from "./wavCodec";

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe("encodeWavPcm16Mono", () => {
  it("writes a canonical 44-byte header with correct field bytes", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = encodeWavPcm16Mono(samples, 16000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.length).toBe(44 + samples.length * 2);
    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2); // ChunkSize
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(readAscii(bytes, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // Subchunk1Size
    expect(view.getUint16(20, true)).toBe(1); // AudioFormat: PCM
    expect(view.getUint16(22, true)).toBe(1); // NumChannels: mono
    expect(view.getUint32(24, true)).toBe(16000); // SampleRate
    expect(view.getUint32(28, true)).toBe(16000 * 1 * 2); // ByteRate
    expect(view.getUint16(32, true)).toBe(2); // BlockAlign
    expect(view.getUint16(34, true)).toBe(16); // BitsPerSample
    expect(readAscii(bytes, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2); // Subchunk2Size
  });

  it("clamps out-of-range samples to [-1, 1]", () => {
    const bytes = encodeWavPcm16Mono(new Float32Array([2, -2]), 8000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("rounds half away from zero", () => {
    // 2^-16 = 0.5/32768 is exactly representable in float32, so scaling by the
    // encoder's 32768 lands precisely on a .5 boundary with no precision loss.
    const halfLsb = 2 ** -16;
    const bytes = encodeWavPcm16Mono(new Float32Array([halfLsb, -halfLsb]), 8000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(1); // +0.5 rounds up (away from zero)
    expect(view.getInt16(46, true)).toBe(-1); // -0.5 rounds down (away from zero)
  });

  it("round-trips through decodeWav", () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i / samples.length) * Math.PI * 4) * 0.8;
    }
    const bytes = encodeWavPcm16Mono(samples, 22050);
    const decoded = decodeWav(bytes);

    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.channels.length).toBe(1);
    expect(decoded.channels[0].length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(decoded.channels[0][i]).toBeCloseTo(samples[i], 4);
    }
  });
});
