import { describe, it, expect } from "vitest";
import { generateOralAnnotationsWav, type OralSegmentInput } from "./oralAnnotationsWav";
import { encodeWavPcm16Mono } from "./wavWriter";
import { decodeWav } from "./wavCodec";
import { makeTimeRange } from "../model/TimeRange";

/** Decode the generator's output and return per-channel Float32 frames. */
function decodeOutput(bytes: Uint8Array) {
  return decodeWav(bytes);
}

describe("generateOralAnnotationsWav", () => {
  it("lays out source -> careful -> translation blocks with inactive channels zeroed", () => {
    const source = { channels: [new Float32Array([0.1, 0.2, 0.3, 0.4])], sampleRate: 8 };
    const careful = encodeWavPcm16Mono(new Float32Array([0.5, -0.5]), 8);
    const translation = encodeWavPcm16Mono(new Float32Array([0.25]), 8);
    const segments: OralSegmentInput[] = [
      { range: makeTimeRange(0, 0.5), ignored: false, careful, translation },
    ];

    const out = generateOralAnnotationsWav(source, segments, 0.5);
    const decoded = decodeOutput(out);

    expect(decoded.sampleRate).toBe(8);
    expect(decoded.channels.length).toBe(3); // 1 source + careful + translation
    expect(decoded.channels[0].length).toBe(7); // 4 source + 2 careful + 1 translation frames

    // Source block: frames 0-3, channel 0 = source samples, channels 1/2 silent.
    for (let i = 0; i < 4; i++) {
      expect(decoded.channels[0][i]).toBeCloseTo(source.channels[0][i], 3);
      expect(decoded.channels[1][i]).toBe(0);
      expect(decoded.channels[2][i]).toBe(0);
    }
    // Careful block: frames 4-5, channel 1 = careful samples, channels 0/2 silent.
    expect(decoded.channels[0][4]).toBe(0);
    expect(decoded.channels[1][4]).toBeCloseTo(0.5, 3);
    expect(decoded.channels[2][4]).toBe(0);
    expect(decoded.channels[0][5]).toBe(0);
    expect(decoded.channels[1][5]).toBeCloseTo(-0.5, 3);
    expect(decoded.channels[2][5]).toBe(0);
    // Translation block: frame 6, channel 2 = translation sample, channels 0/1 silent.
    expect(decoded.channels[0][6]).toBe(0);
    expect(decoded.channels[1][6]).toBe(0);
    expect(decoded.channels[2][6]).toBeCloseTo(0.25, 3);
  });

  it("excludes ignored segments entirely", () => {
    const source = { channels: [new Float32Array([0.1, 0.2, 0.3, 0.4])], sampleRate: 8 };
    const ignoredCareful = encodeWavPcm16Mono(new Float32Array([0.9, 0.9, 0.9]), 8);
    const segments: OralSegmentInput[] = [
      { range: makeTimeRange(0, 0.25), ignored: true, careful: ignoredCareful },
      { range: makeTimeRange(0.25, 0.5), ignored: false },
    ];

    const out = generateOralAnnotationsWav(source, segments, 0.5);
    const decoded = decodeOutput(out);

    // Only the second segment's source block (2 frames) survives - the
    // ignored segment's source AND its careful clip both vanish.
    expect(decoded.channels[0].length).toBe(2);
    expect(decoded.channels[0][0]).toBeCloseTo(0.3, 3);
    expect(decoded.channels[0][1]).toBeCloseTo(0.4, 3);
    expect(decoded.channels[1][0]).toBe(0);
    expect(decoded.channels[1][1]).toBe(0);
  });

  it("appends a source-only trailing block for an unsegmented remainder", () => {
    const source = { channels: [new Float32Array([0.1, 0.2, 0.3, 0.4])], sampleRate: 8 };
    const segments: OralSegmentInput[] = [{ range: makeTimeRange(0, 0.25), ignored: false }];

    // totalDurationSec (0.5) extends past the last segment's end (0.25).
    const out = generateOralAnnotationsWav(source, segments, 0.5);
    const decoded = decodeOutput(out);

    expect(decoded.channels[0].length).toBe(4); // 2 (segment) + 2 (trailing remainder)
    expect(decoded.channels[0][0]).toBeCloseTo(0.1, 3);
    expect(decoded.channels[0][1]).toBeCloseTo(0.2, 3);
    expect(decoded.channels[0][2]).toBeCloseTo(0.3, 3); // trailing remainder starts here
    expect(decoded.channels[0][3]).toBeCloseTo(0.4, 3);
    for (let i = 0; i < 4; i++) {
      expect(decoded.channels[1][i]).toBe(0);
      expect(decoded.channels[2][i]).toBe(0);
    }
  });

  it("treats an empty segment list as an all-trailing-remainder source-only file", () => {
    const source = { channels: [new Float32Array([0.1, 0.2, 0.3, 0.4])], sampleRate: 8 };
    const out = generateOralAnnotationsWav(source, [], 0.5);
    const decoded = decodeOutput(out);
    expect(decoded.channels[0].length).toBe(4);
    expect(decoded.channels[0][3]).toBeCloseTo(0.4, 3);
  });

  it("resamples an annotation clip recorded at a different rate than the source", () => {
    const source = { channels: [new Float32Array([0, 0, 0, 0])], sampleRate: 8 };
    // Careful clip recorded at half the source rate: 2 samples -> resampled to 4.
    const careful = encodeWavPcm16Mono(new Float32Array([0, 1]), 4);
    const segments: OralSegmentInput[] = [
      { range: makeTimeRange(0, 0.5), ignored: false, careful },
    ];

    const out = generateOralAnnotationsWav(source, segments, 0.5);
    const decoded = decodeOutput(out);

    // 4 source frames + resampleLinear(2 samples, 4Hz -> 8Hz) = round(2*8/4) = 4 frames.
    expect(decoded.channels[0].length).toBe(8);
    expect(decoded.channels[1][4]).toBeCloseTo(0, 3); // resampled endpoint preserved
    expect(decoded.channels[1][7]).toBeCloseTo(1, 3); // resampled endpoint preserved
  });

  it("handles a multi-channel source (stereo -> 4 output channels)", () => {
    const source = {
      channels: [new Float32Array([0.1, 0.2]), new Float32Array([-0.1, -0.2])],
      sampleRate: 4,
    };
    const careful = encodeWavPcm16Mono(new Float32Array([0.5]), 4);
    const segments: OralSegmentInput[] = [
      { range: makeTimeRange(0, 0.5), ignored: false, careful },
    ];

    const out = generateOralAnnotationsWav(source, segments, 0.5);
    const decoded = decodeOutput(out);

    expect(decoded.channels.length).toBe(4); // 2 source + careful + translation
    expect(decoded.channels[0].length).toBe(3); // 2 source frames + 1 careful frame
    // Source block: both source channels populated, careful/translation silent.
    expect(decoded.channels[0][0]).toBeCloseTo(0.1, 3);
    expect(decoded.channels[1][0]).toBeCloseTo(-0.1, 3);
    expect(decoded.channels[2][0]).toBe(0);
    expect(decoded.channels[3][0]).toBe(0);
    // Careful block: only the careful channel (index 2) is populated.
    expect(decoded.channels[0][2]).toBe(0);
    expect(decoded.channels[1][2]).toBe(0);
    expect(decoded.channels[2][2]).toBeCloseTo(0.5, 3);
    expect(decoded.channels[3][2]).toBe(0);
  });
});
