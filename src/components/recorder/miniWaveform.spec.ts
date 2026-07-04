// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import type { Envelope } from "../../audio/EnvelopeCache";
import { encodeWavPcm16Mono } from "../../audio/wavWriter";
import {
  drawMiniWaveform,
  miniWaveformFromWav,
  miniWaveformPoints,
  wavDurationSec,
} from "./miniWaveform";

function envelope(min: number[], max: number[]): Envelope {
  return {
    channels: [{ min: Float32Array.from(min), max: Float32Array.from(max) }],
    samplesPerMs: 1,
    sampleRate: 1000,
    durationSec: min.length / 1000,
  };
}

describe("miniWaveformPoints", () => {
  it("maps full-scale samples to the top/bottom of the box", () => {
    const points = miniWaveformPoints(envelope([-1, -1], [1, 1]), 2, 20);
    expect(points).toEqual([
      { x: 0, yMin: 20, yMax: 0 },
      { x: 1, yMin: 20, yMax: 0 },
    ]);
  });

  it("maps silence to the vertical center", () => {
    const points = miniWaveformPoints(envelope([0, 0, 0, 0], [0, 0, 0, 0]), 1, 10);
    expect(points).toEqual([{ x: 0, yMin: 5, yMax: 5 }]);
  });

  it("downsamples: one column per pixel regardless of bucket count", () => {
    const zeros = Array.from({ length: 100 }, () => 0);
    const points = miniWaveformPoints(envelope(zeros, zeros), 10, 10);
    expect(points).toHaveLength(10);
  });

  it("returns nothing for an empty envelope or a zero-size box", () => {
    expect(miniWaveformPoints(envelope([], []), 10, 10)).toEqual([]);
    expect(miniWaveformPoints(envelope([0], [0]), 0, 10)).toEqual([]);
    expect(miniWaveformPoints(envelope([0], [0]), 10, 0)).toEqual([]);
  });
});

describe("miniWaveformFromWav", () => {
  it("decodes a real WAV and produces one point per requested column", () => {
    const samples = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10));
    const bytes = encodeWavPcm16Mono(samples, 48000);
    const points = miniWaveformFromWav(bytes, 40, 24);
    expect(points).toHaveLength(40);
    expect(points.every((p) => p.yMin >= 0 && p.yMin <= 24 && p.yMax >= 0 && p.yMax <= 24)).toBe(
      true,
    );
  });
});

describe("wavDurationSec", () => {
  it("reads the clip's duration from its WAV header", () => {
    const samples = new Float32Array(48000); // 1 second at 48kHz
    const bytes = encodeWavPcm16Mono(samples, 48000);
    expect(wavDurationSec(bytes)).toBeCloseTo(1, 5);
  });
});

describe("drawMiniWaveform", () => {
  it("never throws, even though happy-dom has no real 2D canvas context", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 24;
    expect(() => drawMiniWaveform(canvas, [{ x: 0, yMin: 20, yMax: 4 }], "#2e7d32")).not.toThrow();
    expect(() => drawMiniWaveform(canvas, [], "#2e7d32")).not.toThrow();
  });
});
