import { describe, it, expect } from "vitest";
import { getSilenceBreaks, DEFAULT_SILENCE_SEGMENTER_SETTINGS } from "./silenceSegmenter";
import type { Envelope } from "./EnvelopeCache";

/** Build a 1-per-ms mono envelope from a per-ms amplitude pattern (0..1). */
function envFromAmp(amp: number[]): Envelope {
  const n = amp.length;
  const max = new Float32Array(n);
  const min = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    max[i] = amp[i];
    min[i] = -amp[i];
  }
  return { channels: [{ max, min }], samplesPerMs: 1, sampleRate: 1000, durationSec: n / 1000 };
}

/** `count` ms at amplitude `a`. */
function run(a: number, count: number): number[] {
  return new Array(count).fill(a);
}

describe("getSilenceBreaks", () => {
  it("breaks on the pauses between three bursts (regardless of clip length)", () => {
    // burst | 500ms silence | burst | 500ms silence | burst  → 3 segments.
    const amp = [...run(1, 2000), ...run(0, 500), ...run(1, 2000), ...run(0, 500), ...run(1, 2000)];
    const breaks = getSilenceBreaks(envFromAmp(amp));
    expect(breaks.length).toBe(3); // two interior + the media end
    expect(breaks[0]).toBeCloseTo(2.25, 2); // middle of the first silence
    expect(breaks[1]).toBeCloseTo(4.75, 2); // middle of the second silence
    expect(breaks[2]).toBeCloseTo(7.0, 3); // media end
  });

  it("returns a single segment for all-silence (or empty) audio", () => {
    expect(getSilenceBreaks(envFromAmp(run(0, 5000)))).toEqual([5]);
    expect(getSilenceBreaks(envFromAmp([]))).toEqual([]);
  });

  it("returns a single segment when there is no qualifying pause", () => {
    // Continuous speech under the max length → no break.
    expect(getSilenceBreaks(envFromAmp(run(1, 4000)))).toEqual([4]);
  });

  it("ignores pauses too short to be a break", () => {
    // 100ms gap < minSilenceMs (300) → not a boundary.
    const amp = [...run(1, 2000), ...run(0, 100), ...run(1, 2000)];
    expect(getSilenceBreaks(envFromAmp(amp))).toEqual([4.1]);
  });

  it("keeps leading/trailing silence inside the first/last segment", () => {
    // silence | burst | long pause | burst | silence
    const amp = [...run(0, 800), ...run(1, 2000), ...run(0, 500), ...run(1, 2000), ...run(0, 800)];
    const breaks = getSilenceBreaks(envFromAmp(amp));
    expect(breaks.length).toBe(2); // one interior break + end (no break in the edges)
    expect(breaks[0]).toBeCloseTo(3.05, 2); // middle of the interior pause
  });

  it("force-splits a segment longer than the max length", () => {
    // 15s of continuous speech, max 10s → split into 2 near the midpoint.
    const breaks = getSilenceBreaks(envFromAmp(run(1, 15000)));
    expect(breaks.length).toBe(2);
    expect(breaks[0]).toBeCloseTo(7.5, 1);
    expect(breaks[1]).toBeCloseTo(15, 3);
    expect(breaks[0]).toBeLessThan(DEFAULT_SILENCE_SEGMENTER_SETTINGS.maxSegmentLengthMs / 1000);
  });

  it("drops a break that would stand up too short a segment (prefers longer pauses)", () => {
    // A tiny gap 200ms after the start can't be a break (min segment 1000ms);
    // the real pause later is the one that survives.
    const amp = [...run(1, 300), ...run(0, 400), ...run(1, 3000), ...run(0, 400), ...run(1, 3000)];
    const breaks = getSilenceBreaks(envFromAmp(amp));
    // Only the pause that leaves both sides ≥ 1s survives (plus the end).
    expect(breaks.every((b, i) => i === 0 || b > breaks[i - 1])).toBe(true);
    expect(breaks[breaks.length - 1]).toBeCloseTo(7.1, 2);
  });
});
