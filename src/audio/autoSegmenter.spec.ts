import { describe, it, expect } from "vitest";
import {
  aggregateSamples,
  autoSegment,
  autoSegmentEnvelope,
  DEFAULT_AUTO_SEGMENTER_SETTINGS,
  type AutoSegmenterSettings,
  type SampleSource,
} from "./autoSegmenter";
import type { Envelope } from "./EnvelopeCache";

/**
 * These tests are a direct port of SayMore's
 * `D:\saymore\src\SayMoreTests\Transcription\Model\AutoSegmenterTests.cs`.
 *
 * The C# `DummyWaveStream` seeds its samples with `new Random()` (wall-clock
 * seeded, non-deterministic). Per the task we substitute a seeded PRNG so the
 * one randomness-sensitive case is reproducible. Every other case uses identical
 * sample values (min===max), so it is deterministic regardless of the PRNG — the
 * planted "pause" values (`setSpecificValues`) create the breaks.
 *
 * Expected break arrays were captured from the real C# algorithm (a standalone
 * extraction run under .NET 10), and they match every original NUnit assertion.
 */

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Port of the NUnit `DummyWaveStream` as a {@link SampleSource}. Fills
 * `count * channels` interleaved samples in `[minHigh, maxHigh)` (all positive —
 * the C# sign-flip branch `r.Next(1,2) == 2` is dead code and never fires), then
 * lets a callback plant specific values (the pauses).
 */
class DummyWaveStream implements SampleSource {
  private samples = new Float32Array(0);
  private channelCount = 1;
  totalTimeMs = 0;

  setSamples(
    count: number,
    channels: number,
    maxHighSample: number,
    minHighSample: number,
    setSpecificValues?: (s: Float32Array) => void,
    seed = 12345,
  ): void {
    this.channelCount = channels;
    const intToFloat = 1000000;
    const maxHighSampleAsInt = Math.trunc(maxHighSample * intToFloat);
    const minHighSampleAsInt = Math.trunc(minHighSample * intToFloat);
    const rand = mulberry32(seed);

    const s = new Float32Array(count * channels);
    for (let i = 0; i < count * channels; i++) {
      // C# Random.Next(min, max) with min===max returns min (no randomness).
      const amplitudeInt =
        minHighSampleAsInt === maxHighSampleAsInt
          ? minHighSampleAsInt
          : minHighSampleAsInt + Math.floor(rand() * (maxHighSampleAsInt - minHighSampleAsInt));
      s[i] = amplitudeInt / intToFloat;
    }
    setSpecificValues?.(s);
    this.samples = s;
  }

  get sampleCount(): number {
    return this.samples.length / this.channelCount;
  }
  get channels(): number {
    return this.channelCount;
  }
  readSamples(start: number, count: number): Float32Array {
    const end = Math.min(start + count, this.samples.length);
    return this.samples.subarray(start, Math.max(start, end));
  }
}

/** Settings matching the C# test `[SetUp]` (min 850, pause 250, clamp 4e-6). */
function settings(maxMs: number, pauseMs = 250): AutoSegmenterSettings {
  return {
    minSegmentLengthMs: 850,
    maxSegmentLengthMs: maxMs,
    preferredPauseLengthMs: pauseMs,
    optimumLengthClampingFactor: 0.000004,
  };
}

/** Boundary seconds → milliseconds, for readable comparison with the C# asserts. */
function breaksMs(source: DummyWaveStream, s: AutoSegmenterSettings): number[] {
  return autoSegment(source, s).map((sec) => sec * 1000);
}

describe("AutoSegmenter.getNaturalBreaks (ported from SayMore NUnit tests)", () => {
  it("ZeroSamples returns empty enumeration", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(0, 1, 0, 0);
    expect(autoSegment(stream, settings(10000))).toEqual([]);
  });

  it("short file with 1000 identical non-zero samples returns single break at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(1000, 1, 0.999, 0.999);
    stream.totalTimeMs = 3000;
    const ms = breaksMs(stream, settings(6000));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toBeCloseTo(3000, 6);
  });

  it("identical non-zero samples plus a zero sample at end returns single break at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(1000, 1, 0.999, 0.999, (s) => {
      s[999] = 0;
    });
    stream.totalTimeMs = 3000;
    const ms = breaksMs(stream, settings(6000));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toBeCloseTo(3000, 6);
  });

  it("3s with two fixed single internal lows, max segment 1200ms, returns two internal breaks and one at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(6000, 1, 0.999, 0.999, (s) => {
      s[2000] = 0;
      s[4000] = 0;
    });
    stream.totalTimeMs = 3000;
    const ms = breaksMs(stream, settings(1200, 10));
    expect(ms).toHaveLength(3);
    expect(ms[0]).toBeCloseTo(1000, 6);
    expect(ms[1]).toBeCloseTo(2000, 6);
    expect(ms[2]).toBeCloseTo(3000, 6);
  });

  it("3s with two fixed short internal lows, max segment 2000ms, returns two internal breaks and one at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(6000, 1, 0.999, 0.999, (s) => {
      s[1999] = 0;
      s[2000] = 0;
      s[2001] = 0;
      s[3999] = 0;
      s[4000] = 0;
      s[4001] = 0;
    });
    stream.totalTimeMs = 3000;
    const ms = breaksMs(stream, settings(2000, 10));
    expect(ms).toHaveLength(3);
    expect(ms[0]).toBeCloseTo(1000, 6);
    expect(ms[1]).toBeCloseTo(2000, 6);
    expect(ms[2]).toBeCloseTo(3000, 6);
  });

  it("3s with two fixed short internal lows, max segment 2200ms, returns one internal break and one at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(6000, 1, 0.999, 0.999, (s) => {
      s[1999] = 0;
      s[2000] = 0;
      s[2001] = 0;
      s[3999] = 0;
      s[4000] = 0;
      s[4001] = 0;
    });
    stream.totalTimeMs = 3000;
    const ms = breaksMs(stream, settings(2200, 10));
    expect(ms).toHaveLength(2);
    expect(ms[0]).toBeCloseTo(2000, 6);
    expect(ms[1]).toBeCloseTo(3000, 6);
  });

  it("12s with two variable multi-sample internal lows returns two internal breaks and one at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(12000, 1, 0.999, 0.2, (s) => {
      s[4995] = 0.001;
      s[4996] = 0.09;
      s[4997] = 0.03;
      s[4998] = 0.02;
      s[4999] = 0.009;
      s[5000] = 0.08;
      s[5001] = 0.15;
      s[5002] = 0.09;
      s[5003] = 0.04;
      s[5004] = 0.007;
      s[5005] = 0.03;

      s[8995] = 0.003;
      s[8996] = 0.07;
      s[8997] = 0.04;
      s[8998] = 0.08;
      s[8999] = 0.09;
      s[9000] = 0.01;
      s[9001] = 0.01;
      s[9002] = 0.09;
      s[9003] = 0.009;
      s[9004] = 0.007;
      s[9005] = 0.006;
    });
    stream.totalTimeMs = 12000;
    const ms = breaksMs(stream, settings(6000, 10));
    expect(ms).toHaveLength(3);
    expect(ms[0]).toBeGreaterThanOrEqual(4998);
    expect(ms[0]).toBeLessThanOrEqual(5002);
    expect(ms[1]).toBeGreaterThanOrEqual(8998);
    expect(ms[1]).toBeLessThanOrEqual(9002);
    expect(ms[2]).toBeCloseTo(12000, 6);
  });

  it("12s multi-channel with fixed multi-sample lows every 500ms, max segment 6s, returns three internal breaks and one at end", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(6000, 2, 0.999, 0.999, (s) => {
      for (let i = 0; i < 22; i++) s[i] = 0;
      for (let b = 1; b < 23; b++) {
        for (let i = 0; i < 22; i++) {
          s[b * 500 - 10 + i] = 0;
        }
      }
      for (let i = 11980; i < 12000; i++) s[i] = 0;
    });
    stream.totalTimeMs = 12000;
    const ms = breaksMs(stream, settings(6000));
    expect(ms).toHaveLength(3);
    expect(ms[0]).toBeGreaterThanOrEqual(3498);
    expect(ms[0]).toBeLessThanOrEqual(3502);
    expect(ms[1]).toBeGreaterThanOrEqual(6998);
    expect(ms[1]).toBeLessThanOrEqual(7002);
    expect(ms[2]).toBeGreaterThanOrEqual(11998);
    expect(ms[2]).toBeLessThanOrEqual(12002);
  });
});

describe("aggregateSamples (ported from AudioFileHelper.GetSamples)", () => {
  it("returns empty for zero requested samples or empty source", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(100, 1, 0.5, 0.5);
    expect(aggregateSamples(stream, 0).count).toBe(0);

    const empty = new DummyWaveStream();
    empty.setSamples(0, 1, 0, 0);
    expect(aggregateSamples(empty, 10).count).toBe(0);
  });

  it("caps the row count at the available sample count", () => {
    const stream = new DummyWaveStream();
    stream.setSamples(50, 1, 0.5, 0.5);
    const agg = aggregateSamples(stream, 1000);
    expect(agg.count).toBe(50);
  });

  it("aggregates min and max across the samples in each bucket", () => {
    // 6 mono samples aggregated into 3 buckets (2 samples each).
    const stream = new DummyWaveStream();
    stream.setSamples(6, 1, 0.5, 0.5, (s) => {
      s.set([0.1, 0.9, -0.4, 0.2, 0.7, -0.3]);
    });
    const agg = aggregateSamples(stream, 3);
    expect(agg.count).toBe(3);
    expect(agg.channels).toBe(1);
    expect(Array.from(agg.max)).toEqual([
      expect.closeTo(0.9, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.7, 6),
    ]);
    expect(Array.from(agg.min)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(-0.4, 6),
      expect.closeTo(-0.3, 6),
    ]);
  });
});

describe("autoSegmentEnvelope (real-app / worker path)", () => {
  it("finds the same break as autoSegment when fed the equivalent 1-per-ms envelope", () => {
    // Build a 3s mono envelope (3000 buckets) that is loud everywhere except a
    // clear pause at 1500ms — mirrors what the raw-sample path would aggregate to.
    const n = 3000;
    const max = new Float32Array(n).fill(0.999);
    const min = new Float32Array(n).fill(-0.999);
    for (let i = 1495; i <= 1505; i++) {
      max[i] = 0;
      min[i] = 0;
    }
    const envelope: Envelope = {
      channels: [{ max, min }],
      samplesPerMs: 1,
      sampleRate: 44100,
      durationSec: 3,
    };
    const boundaries = autoSegmentEnvelope(envelope, {
      minSegmentLengthMs: 850,
      maxSegmentLengthMs: 2000,
      preferredPauseLengthMs: 10,
      optimumLengthClampingFactor: 0.000004,
    });
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0] * 1000).toBeGreaterThanOrEqual(1498);
    expect(boundaries[0] * 1000).toBeLessThanOrEqual(1502);
    expect(boundaries[1]).toBeCloseTo(3, 6);
  });

  it("returns empty for an empty envelope", () => {
    const envelope: Envelope = {
      channels: [],
      samplesPerMs: 1,
      sampleRate: 44100,
      durationSec: 0,
    };
    expect(autoSegmentEnvelope(envelope, DEFAULT_AUTO_SEGMENTER_SETTINGS)).toEqual([]);
  });
});
