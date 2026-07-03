import type { Envelope } from "./EnvelopeCache";

/**
 * Faithful TypeScript port of SayMore's auto-segmenter
 * (`D:\saymore\src\SayMore\Transcription\Model\AutoSegmenter.cs`, plus the
 * `AudioFileHelper.GetSamples` aggregation it relies on).
 *
 * The algorithm finds "natural breaks" (pauses) in speech audio and returns the
 * segment boundaries. It is ported line-for-line — including the C# `uint`
 * overflow arithmetic in the running-average computation — so that SayMore's own
 * unit tests port directly (see autoSegmenter.spec.ts). Do not "improve" it.
 *
 * Two entry points:
 *  - `autoSegment(source, settings)` mirrors the C# flow exactly: it takes a raw
 *    `SampleSource` (the `IWaveStreamReader` seam), aggregates it to 1 sample per
 *    millisecond, then finds breaks. This is what the ported NUnit tests exercise.
 *  - `autoSegmentEnvelope(envelope, settings)` is the real-app / worker path: the
 *    lameta envelope is *already* the 1-sample-per-ms min/max aggregation that
 *    `GetSamples` produces, so it feeds `getNaturalBreaks` directly.
 */

/**
 * Raw-sample reader seam, mirroring SayMore's `IWaveStreamReader` so the NUnit
 * `DummyWaveStream` tests port directly. Samples are interleaved by channel.
 */
export interface SampleSource {
  /** Number of samples per channel (C# `SampleCount`). */
  readonly sampleCount: number;
  /** Channel count (C# `NativeChannelCount` == `SamplingChannelCount`). */
  readonly channels: number;
  /** Total media duration in milliseconds (C# `TotalTime.TotalMilliseconds`). */
  readonly totalTimeMs: number;
  /**
   * Read up to `count` interleaved float sample values beginning at interleaved
   * offset `start`. Returns fewer than `count` (possibly empty) at end of stream.
   * Mirrors `IWaveStreamReader.Seek(start)` + `Read(buffer, count)`.
   */
  readSamples(start: number, count: number): Float32Array;
}

export interface AutoSegmenterSettings {
  /** Optimal segment length is the midpoint of this and the maximum. */
  readonly minSegmentLengthMs: number;
  /** Optimal segment length is the midpoint of the minimum and this. */
  readonly maxSegmentLengthMs: number;
  /** Larger → the segmenter seeks longer pauses to break on. */
  readonly preferredPauseLengthMs: number;
  /** Larger → break positions cling more strongly to the optimal length. */
  readonly optimumLengthClampingFactor: number;
}

/** SayMore's shipped defaults (`Settings.settings`). */
export const DEFAULT_AUTO_SEGMENTER_SETTINGS: AutoSegmenterSettings = {
  minSegmentLengthMs: 1000,
  maxSegmentLengthMs: 10000,
  preferredPauseLengthMs: 250,
  optimumLengthClampingFactor: 4e-6
};

/**
 * The 1-sample-per-ms min/max aggregation, row-major by `[row * channels + c]`.
 * This is the TS analogue of C#'s `Tuple<float,float>[,]` where Item1 = max
 * (biggest) and Item2 = min (smallest). It is exactly what an {@link Envelope}
 * already holds.
 */
export interface AggregatedSamples {
  /** Number of aggregated rows (C# `samples.GetLength(0)`). */
  readonly count: number;
  readonly channels: number;
  /** Per-bucket maximum sample, `[row * channels + c]`. */
  readonly max: Float32Array;
  /** Per-bucket minimum sample, `[row * channels + c]`. */
  readonly min: Float32Array;
}

/** Progress callback: `fraction` advances 0→1 as breaks are emitted. */
export type AutoSegmenterProgress = (fraction: number) => void;

/**
 * Port of `AudioFileHelper.GetSamples(stream, numberOfSamplesToReturn)`.
 * Aggregates the raw stream down to `numberOfSamplesToReturn` min/max rows,
 * tracking a running rounding error so bucket boundaries never drift.
 */
export function aggregateSamples(
  source: SampleSource,
  numberOfSamplesToReturn: number
): AggregatedSamples {
  const sampleCount = source.sampleCount;
  const channels = source.channels;

  if (numberOfSamplesToReturn === 0 || sampleCount === 0) {
    return { count: 0, channels: 0, max: new Float32Array(0), min: new Float32Array(0) };
  }

  if (sampleCount < numberOfSamplesToReturn) {
    numberOfSamplesToReturn = sampleCount;
  }

  const samplesPerAggregate = sampleCount / numberOfSamplesToReturn;
  const max = new Float32Array(numberOfSamplesToReturn * channels);
  const min = new Float32Array(numberOfSamplesToReturn * channels);

  // Track ideal (unrounded) vs actual samples processed; read one extra sample
  // whenever the rounding error builds to a whole integer (see C# comment).
  let idealSamplesProcessed = 0;
  let valuesToRead = Math.floor(samplesPerAggregate) * channels;
  let totalRead = 0;
  let readOffset = 0;

  for (let sampleIndex = 0; sampleIndex < numberOfSamplesToReturn; sampleIndex++) {
    const buffer = source.readSamples(readOffset, valuesToRead);
    const read = buffer.length;
    if (read === 0) break;
    readOffset += read;

    for (let c = 0; c < channels; c++) {
      let biggest = -Infinity;
      let smallest = Infinity;
      for (let i = 0; i < read; i += channels) {
        const v = buffer[i + c];
        if (v > biggest) biggest = v;
        if (v < smallest) smallest = v;
      }
      max[sampleIndex * channels + c] = biggest;
      min[sampleIndex * channels + c] = smallest;
    }

    valuesToRead = Math.floor(samplesPerAggregate) * channels;
    totalRead += read / channels;
    idealSamplesProcessed += samplesPerAggregate;
    if (totalRead < Math.floor(idealSamplesProcessed)) {
      valuesToRead += channels;
    }
  }

  return { count: numberOfSamplesToReturn, channels, max, min };
}

/** Port of `AutoSegmenter.ComputeRawScore`: Σ(|max| + |min|) across channels. */
function computeRawScore(samples: AggregatedSamples, targetBreak: number): number {
  let score = 0;
  const base = targetBreak * samples.channels;
  for (let c = 0; c < samples.channels; c++) {
    score += Math.abs(samples.max[base + c]) + Math.abs(samples.min[base + c]);
  }
  return score;
}

/**
 * Port of `AutoSegmenter.ComputeAdjustedScore`: a triangular-weighted sum of the
 * raw scores over ±`adjacent` neighbours, scaled by the distance penalty.
 * The weight `rawScores[k] * (adjacent - i) / adjacent` is evaluated left-to-right
 * exactly as in C# (the leading double promotes the whole term to floating point).
 */
function computeAdjustedScore(
  rawScores: Float64Array,
  iAdjust: number,
  distanceFactor: number,
  adjacent: number
): number {
  let score = rawScores[iAdjust];
  for (let i = 1; i <= adjacent; i++) {
    if (rawScores.length > iAdjust + i) {
      score += (rawScores[iAdjust + i] * (adjacent - i)) / adjacent;
    }
    if (iAdjust >= i) {
      score += (rawScores[iAdjust - i] * (adjacent - i)) / adjacent;
    }
  }
  return score * distanceFactor;
}

/**
 * Port of `AutoSegmenter.GetNaturalBreaks`. Consumes already-aggregated 1-per-ms
 * min/max samples and returns boundary times in **seconds**, ascending, excluding
 * 0 and including the media end (matching the C# `yield` behaviour).
 *
 * `totalTimeMs` is the true (double) media duration; `samples.count` is the number
 * of aggregated rows. The 32-bit `uint` overflow in the running-average step is
 * reproduced with `>>> 0` so behaviour matches C# bit-for-bit.
 */
export function getNaturalBreaks(
  samples: AggregatedSamples,
  totalTimeMs: number,
  settings: AutoSegmenterSettings,
  onProgress?: AutoSegmenterProgress
): number[] {
  const breaks: number[] = [];
  let remainingSamples = samples.count;
  if (remainingSamples <= 0) return breaks;

  let lastBreak = 0;
  const millisecondsPerSample = totalTimeMs / remainingSamples;
  const adjacentSamplesToFactorIntoAdjustedScore = Math.floor(
    settings.preferredPauseLengthMs / millisecondsPerSample
  );
  const minSamplesPerSegment = Math.floor(settings.minSegmentLengthMs / millisecondsPerSample);
  const maxSamplesPerSegment = Math.floor(settings.maxSegmentLengthMs / millisecondsPerSample);
  const adjacent = adjacentSamplesToFactorIntoAdjustedScore;

  let idealSegmentLengthInSamples = Math.ceil((minSamplesPerSegment + maxSamplesPerSegment) / 2);

  while (remainingSamples >= maxSamplesPerSegment) {
    if (remainingSamples < idealSegmentLengthInSamples * 2) {
      idealSegmentLengthInSamples = Math.floor(remainingSamples / 2);
    }
    const samplesOnEitherSideOfTarget =
      idealSegmentLengthInSamples + adjacent - minSamplesPerSegment;
    const targetBreak = lastBreak + idealSegmentLengthInSamples;
    let bestBreak = targetBreak;

    const rawScores = new Float64Array(idealSegmentLengthInSamples * 2 + 1);
    const adjustedScores = new Float64Array(idealSegmentLengthInSamples * 2 + 1);
    rawScores[idealSegmentLengthInSamples] = computeRawScore(samples, targetBreak);
    let bestScore = Number.MAX_VALUE;
    let averageScore = 0;

    for (let i = 1; i < samplesOnEitherSideOfTarget; i++) {
      if (i < idealSegmentLengthInSamples) {
        rawScores[idealSegmentLengthInSamples + i] = computeRawScore(samples, targetBreak + i);
        rawScores[idealSegmentLengthInSamples - i] = computeRawScore(samples, targetBreak - i);
      }
      if (i >= adjacent) {
        const distanceFactor = Math.pow(i * settings.optimumLengthClampingFactor + 1, 2);

        let iAdjust = idealSegmentLengthInSamples + i - adjacent;
        let totalNewAdjustedScores = adjustedScores[iAdjust] = computeAdjustedScore(
          rawScores,
          iAdjust,
          distanceFactor,
          adjacent
        );
        if (adjustedScores[iAdjust] < bestScore) {
          bestScore = adjustedScores[iAdjust];
          bestBreak = lastBreak + iAdjust;
        }

        iAdjust = idealSegmentLengthInSamples - i + adjacent;
        adjustedScores[iAdjust] = computeAdjustedScore(rawScores, iAdjust, distanceFactor, adjacent);
        totalNewAdjustedScores += adjustedScores[iAdjust];
        if (adjustedScores[iAdjust] < bestScore) {
          bestScore = adjustedScores[iAdjust];
          bestBreak = lastBreak + iAdjust;
        }

        // C# uint arithmetic: at i === adjacent these wrap mod 2^32, yielding
        // samplesInPrevAvg = 4294967295 and divisor = 1 (verified against .NET).
        const term = (i - adjacent - 1) >>> 0;
        const samplesInPrevAvg = (1 + ((2 * term) >>> 0)) >>> 0;
        const divisor = (samplesInPrevAvg + 2) >>> 0;
        averageScore =
          (averageScore * samplesInPrevAvg + totalNewAdjustedScores) / divisor;

        if (
          bestScore < averageScore / 2 &&
          i < idealSegmentLengthInSamples &&
          rawScores[idealSegmentLengthInSamples + i] <
            rawScores[idealSegmentLengthInSamples + i + 1] &&
          rawScores[idealSegmentLengthInSamples - i] <
            rawScores[idealSegmentLengthInSamples - i - 1]
        ) {
          break;
        }
      }
    }

    remainingSamples -= bestBreak - lastBreak;
    lastBreak = bestBreak;
    breaks.push((millisecondsPerSample * bestBreak) / 1000);
    onProgress?.(lastBreak / samples.count);
  }

  if (remainingSamples > 0) {
    breaks.push(totalTimeMs / 1000);
  }
  onProgress?.(1);
  return breaks;
}

/**
 * Full C# flow: aggregate a raw {@link SampleSource} to 1-per-ms, then find
 * breaks. This is what the ported NUnit tests call. Returns boundary seconds.
 */
export function autoSegment(
  source: SampleSource,
  settings: AutoSegmenterSettings,
  onProgress?: AutoSegmenterProgress
): number[] {
  const requestedSamples = Math.floor(source.totalTimeMs);
  if (requestedSamples <= 0) return [];
  const samples = aggregateSamples(source, requestedSamples);
  if (samples.count <= 0) return [];
  return getNaturalBreaks(samples, source.totalTimeMs, settings, onProgress);
}

/** View an {@link Envelope} as {@link AggregatedSamples} (it already is one). */
export function envelopeToAggregatedSamples(envelope: Envelope): AggregatedSamples {
  const channels = envelope.channels.length;
  const count = channels === 0 ? 0 : envelope.channels[0].max.length;
  const max = new Float32Array(count * channels);
  const min = new Float32Array(count * channels);
  for (let c = 0; c < channels; c++) {
    const ch = envelope.channels[c];
    for (let row = 0; row < count; row++) {
      max[row * channels + c] = ch.max[row];
      min[row * channels + c] = ch.min[row];
    }
  }
  return { count, channels, max, min };
}

/**
 * Real-app / worker path: the lameta {@link Envelope} is already the 1-per-ms
 * min/max aggregation, so feed it straight to {@link getNaturalBreaks}.
 */
export function autoSegmentEnvelope(
  envelope: Envelope,
  settings: AutoSegmenterSettings,
  onProgress?: AutoSegmenterProgress
): number[] {
  const samples = envelopeToAggregatedSamples(envelope);
  if (samples.count <= 0) return [];
  return getNaturalBreaks(samples, envelope.durationSec * 1000, settings, onProgress);
}

// --- Web Worker message protocol (see autoSegmenter.worker.ts) ---------------

export interface AutoSegmenterRequest {
  readonly envelope: Envelope;
  readonly settings: AutoSegmenterSettings;
}

export interface AutoSegmenterProgressMessage {
  readonly type: "progress";
  readonly fraction: number;
}

export interface AutoSegmenterResultMessage {
  readonly type: "result";
  /** Boundary times in seconds, ascending, excluding 0 and including the end. */
  readonly boundaries: number[];
}

export type AutoSegmenterResponse =
  | AutoSegmenterProgressMessage
  | AutoSegmenterResultMessage;
