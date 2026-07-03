import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { testDataPath } from "../testData";
import { computeEnvelope, computeEnvelopeFromWav, envelopeToPeaks } from "./envelope";
import type { Envelope } from "./EnvelopeCache";

function loadWav(name: string): Uint8Array {
  return new Uint8Array(readFileSync(testDataPath("media", name)));
}

/** Build a minimal canonical PCM16 WAV from interleaved integer samples. */
function buildWavPcm16(sampleRate: number, interleaved: number[], numChannels = 1): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLen = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  let o = 44;
  for (const s of interleaved) {
    view.setInt16(o, s, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}

function expectAllInUnitRange(env: Envelope): void {
  for (const ch of env.channels) {
    for (let i = 0; i < ch.min.length; i++) {
      expect(ch.min[i]).toBeGreaterThanOrEqual(-1);
      expect(ch.min[i]).toBeLessThanOrEqual(1);
      expect(ch.max[i]).toBeGreaterThanOrEqual(-1);
      expect(ch.max[i]).toBeLessThanOrEqual(1);
      expect(ch.max[i]).toBeGreaterThanOrEqual(ch.min[i]);
    }
  }
}

describe("computeEnvelopeFromWav — real fixtures", () => {
  it("parses shortSound.wav (mono, 22000 Hz, ~1.45s)", () => {
    const env = computeEnvelopeFromWav(loadWav("shortSound.wav"));
    expect(env.channels.length).toBe(1);
    expect(env.sampleRate).toBe(22000);
    expect(env.samplesPerMs).toBe(1);
    expect(env.durationSec).toBeGreaterThan(1.4);
    expect(env.durationSec).toBeLessThan(1.5);

    const expectedBuckets = Math.round(env.durationSec * 1000);
    expect(env.channels[0].min.length).toBe(expectedBuckets);
    expect(env.channels[0].max.length).toBe(expectedBuckets);

    expectAllInUnitRange(env);
    // A real sound should have some non-silent buckets.
    expect(env.channels[0].max.some((v) => v > 0.01)).toBe(true);
  });

  it("parses longerSound.wav (mono, 44100 Hz, ~56.775s)", () => {
    const env = computeEnvelopeFromWav(loadWav("longerSound.wav"));
    expect(env.channels.length).toBe(1);
    expect(env.sampleRate).toBe(44100);
    expect(env.durationSec).toBeGreaterThan(56.675);
    expect(env.durationSec).toBeLessThan(56.875);

    const expectedBuckets = Math.round(env.durationSec * 1000);
    expect(env.channels[0].min.length).toBe(expectedBuckets);
    expectAllInUnitRange(env);
  });
});

describe("computeEnvelopeFromWav — synthetic bucketing math", () => {
  it("maps one sample per ms bucket at 1000 Hz with exact normalization", () => {
    // 1000 Hz => samplesPerMs = 1 => bucket i holds exactly frame i.
    const samples = [0, 16384, -16384, 32767, -32768, 8192, -8192, 100, -100, 0];
    const env = computeEnvelopeFromWav(buildWavPcm16(1000, samples));

    expect(env.sampleRate).toBe(1000);
    expect(env.channels.length).toBe(1);
    expect(env.durationSec).toBeCloseTo(0.01, 10);
    expect(env.channels[0].min.length).toBe(samples.length);

    const { min, max } = env.channels[0];
    for (let i = 0; i < samples.length; i++) {
      const norm = samples[i] / 32768;
      expect(min[i]).toBeCloseTo(norm, 6);
      expect(max[i]).toBeCloseTo(norm, 6);
    }
    // Full-scale negative reaches exactly -1; full-scale positive is < 1.
    expect(min[4]).toBeCloseTo(-1, 10);
    expect(max[3]).toBeCloseTo(32767 / 32768, 10);
  });

  it("aggregates multiple frames into one bucket (min<max)", () => {
    // 2000 Hz => samplesPerMs = 2 => bucket 0 = frames {0,1}, bucket 1 = {2,3}.
    const samples = [-8192, 16384, 4096, -32768];
    const env = computeEnvelopeFromWav(buildWavPcm16(2000, samples));

    expect(env.sampleRate).toBe(2000);
    expect(env.channels[0].min.length).toBe(2);

    const { min, max } = env.channels[0];
    expect(min[0]).toBeCloseTo(-8192 / 32768, 6);
    expect(max[0]).toBeCloseTo(16384 / 32768, 6);
    expect(min[1]).toBeCloseTo(-1, 10);
    expect(max[1]).toBeCloseTo(4096 / 32768, 6);
  });

  it("deinterleaves multi-channel WAV into separate channel envelopes", () => {
    // Stereo at 1000 Hz, interleaved [L0, R0, L1, R1]:
    //   L (ch0) = [16384, -32768], R (ch1) = [-16384, 8192].
    const interleaved = [16384, -16384, -32768, 8192];
    const env = computeEnvelopeFromWav(buildWavPcm16(1000, interleaved, 2));

    expect(env.channels.length).toBe(2);
    expect(env.channels[0].max[0]).toBeCloseTo(16384 / 32768, 6);
    expect(env.channels[0].max[1]).toBeCloseTo(-1, 10);
    expect(env.channels[1].max[0]).toBeCloseTo(-16384 / 32768, 6);
    expect(env.channels[1].max[1]).toBeCloseTo(8192 / 32768, 6);
  });
});

describe("computeEnvelope dispatch & helpers", () => {
  it("routes WAV bytes to the stream parser (via signature and via hint)", async () => {
    const bytes = buildWavPcm16(1000, [0, 16384, -16384, 0]);
    const bySig = await computeEnvelope(bytes);
    const byHint = await computeEnvelope(bytes, "audio/wav");
    expect(bySig.sampleRate).toBe(1000);
    expect(byHint.sampleRate).toBe(1000);
  });

  it("throws a clear error when compressed decode has no AudioContext", async () => {
    // A non-WAV blob in node (no AudioContext) must surface a clear message.
    const notWav = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(computeEnvelope(notWav, "audio/mpeg")).rejects.toThrow(/browser AudioContext/i);
  });

  it("rejects an unsupported bit depth with a clear error", () => {
    // Hand-forge a 12-bit PCM 'fmt ' to hit the unsupported branch.
    const bytes = buildWavPcm16(1000, [0, 0]);
    const view = new DataView(bytes.buffer);
    view.setUint16(34, 12, true); // bitsPerSample = 12
    expect(() => computeEnvelopeFromWav(bytes)).toThrow(/bit depth/i);
  });

  it("envelopeToPeaks returns one max array per channel", () => {
    const env = computeEnvelopeFromWav(buildWavPcm16(1000, [16384, -16384], 1));
    const peaks = envelopeToPeaks(env);
    expect(peaks.length).toBe(1);
    expect(peaks[0].length).toBe(2);
    expect(peaks[0][0]).toBeCloseTo(16384 / 32768, 6);
  });
});
