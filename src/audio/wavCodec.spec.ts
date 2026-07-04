import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeWav, resampleLinear } from "./wavCodec";
import { testDataPath } from "../testData";

describe("decodeWav", () => {
  it("decodes a real annotation-clip fixture (mono 16-bit PCM, 22000 Hz)", () => {
    const bytes = new Uint8Array(
      readFileSync(testDataPath("session/longerSound.wav_Annotations", "0.75_to_1.25_Careful.wav")),
    );
    const decoded = decodeWav(bytes);

    expect(decoded.sampleRate).toBe(22000);
    expect(decoded.channels.length).toBe(1);
    // data chunk is 0x0000F92E = 63790 bytes / 2 bytes-per-sample.
    expect(decoded.channels[0].length).toBe(63790 / 2);
    // Every decoded sample is within the normalized PCM16 range.
    for (const s of decoded.channels[0]) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("skips extra chunks before the data chunk", () => {
    // RIFF/WAVE + fmt (mono 16-bit @ 8000 Hz) + a LIST chunk + data[2 samples].
    const bytes = new Uint8Array([
      // RIFF header (size patched below)
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x41,
      0x56,
      0x45,
      // fmt chunk
      0x66,
      0x6d,
      0x74,
      0x20,
      16,
      0,
      0,
      0,
      1,
      0, // PCM
      1,
      0, // mono
      0x40,
      0x1f,
      0,
      0, // 8000 Hz
      0x80,
      0x3e,
      0,
      0, // byte rate = 8000*2
      2,
      0, // block align
      16,
      0, // bits per sample
      // LIST chunk (4 bytes of arbitrary payload)
      0x4c,
      0x49,
      0x53,
      0x54,
      4,
      0,
      0,
      0,
      0x49,
      0x4e,
      0x46,
      0x4f,
      // data chunk: two int16 samples, 100 and -100
      0x64,
      0x61,
      0x74,
      0x61,
      4,
      0,
      0,
      0,
      100,
      0, // 100 LE
      156,
      255, // -100 LE
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.length - 8, true);

    const decoded = decodeWav(bytes);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.channels.length).toBe(1);
    expect(decoded.channels[0].length).toBe(2);
    expect(decoded.channels[0][0]).toBeCloseTo(100 / 32768, 6);
    expect(decoded.channels[0][1]).toBeCloseTo(-100 / 32768, 6);
  });

  it("throws on a non-WAV buffer", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe("resampleLinear", () => {
  it("returns the same array (by value) when rates match", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const out = resampleLinear(samples, 16000, 16000);
    expect(Array.from(out)).toEqual(Array.from(samples));
  });

  it("upsamples to the expected length and preserves endpoints", () => {
    const samples = new Float32Array([0, 1, 0, -1]);
    const out = resampleLinear(samples, 8000, 16000);
    expect(out.length).toBe(8); // round(4 * 16000/8000)
    expect(out[0]).toBeCloseTo(samples[0], 6);
    expect(out[out.length - 1]).toBeCloseTo(samples[samples.length - 1], 6);
  });

  it("downsamples to the expected length and preserves endpoints", () => {
    const samples = new Float32Array(8);
    for (let i = 0; i < samples.length; i++) samples[i] = i;
    const out = resampleLinear(samples, 16000, 8000);
    expect(out.length).toBe(4); // round(8 * 8000/16000)
    expect(out[0]).toBeCloseTo(samples[0], 6);
    expect(out[out.length - 1]).toBeCloseTo(samples[samples.length - 1], 6);
  });

  it("linearly interpolates intermediate values", () => {
    // 3 samples [0, 10, 20] doubled to 6: endpoint-preserving ratio is
    // (3-1)/(6-1) = 0.4, so outputs land at src positions 0, 0.4, 0.8, 1.2, 1.6, 2.
    const samples = new Float32Array([0, 10, 20]);
    const out = resampleLinear(samples, 2, 4);
    expect(Array.from(out).map((v) => Math.round(v * 10) / 10)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it("returns empty for empty input", () => {
    expect(resampleLinear(new Float32Array(0), 8000, 16000).length).toBe(0);
  });
});
