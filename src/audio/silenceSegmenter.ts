import type { Envelope } from "./EnvelopeCache";
import type { AutoSegmenterProgress } from "./autoSegmenter";

/**
 * A silence/VAD-style auto-segmenter over the 1-sample-per-ms {@link Envelope}.
 *
 * SayMore's ported `AutoSegmenter` (see autoSegmenter.ts) only ever splits a
 * recording that is *longer* than its maximum segment length, so a short clip —
 * however many obvious pauses it contains — comes back as a single segment. This
 * one instead does what a person expects: find the quiet gaps between speech and
 * break there, preferring the longest pauses, while still honouring SayMore's
 * min/max segment-length goals.
 *
 * Output matches the ported segmenter's contract: boundary times in **seconds**,
 * ascending, excluding 0 and including the media end.
 */
export interface SilenceSegmenterSettings {
  /** Never emit a segment shorter than this (candidate breaks too close are dropped). */
  readonly minSegmentLengthMs: number;
  /** Segments longer than this are force-split at their quietest interior points. */
  readonly maxSegmentLengthMs: number;
  /** A quiet stretch must last at least this long to count as a pause to break on. */
  readonly minSilenceMs: number;
  /**
   * Silence threshold, as a fraction of the amplitude range above the noise
   * floor: `floor + (peak - floor) * fraction`. Adapts to both clean and noisy
   * recordings.
   */
  readonly silenceThresholdFraction: number;
}

export const DEFAULT_SILENCE_SEGMENTER_SETTINGS: SilenceSegmenterSettings = {
  minSegmentLengthMs: 1000,
  maxSegmentLengthMs: 10000,
  minSilenceMs: 300,
  silenceThresholdFraction: 0.12,
};

/** Per-ms peak amplitude across channels (max of |min|,|max|), normalized [0,1]. */
function amplitudePerMs(envelope: Envelope): Float32Array {
  const channels = envelope.channels;
  const n = channels.length === 0 ? 0 : channels[0].max.length;
  const amp = new Float32Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(ch.max[i]), Math.abs(ch.min[i]));
      if (a > amp[i]) amp[i] = a;
    }
  }
  return amp;
}

/** Value at a fractional percentile of a copy-sorted array (0 → min, 1 → max). */
function percentile(sortedAsc: Float32Array, fraction: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * fraction)));
  return sortedAsc[idx];
}

interface SilenceRun {
  /** Midpoint sample index of the quiet stretch (where the break would go). */
  mid: number;
  /** Length of the quiet stretch, in samples (longer = a stronger pause). */
  length: number;
}

/**
 * Find the boundaries. `settings` defaults to {@link DEFAULT_SILENCE_SEGMENTER_SETTINGS}.
 */
export function getSilenceBreaks(
  envelope: Envelope,
  settings: SilenceSegmenterSettings = DEFAULT_SILENCE_SEGMENTER_SETTINGS,
  onProgress?: AutoSegmenterProgress,
): number[] {
  const amp = amplitudePerMs(envelope);
  const n = amp.length;
  if (n === 0) return [];

  const msPerSample = (envelope.durationSec * 1000) / n;
  const durationSec = envelope.durationSec;

  const sorted = Float32Array.from(amp).sort();
  const peak = sorted[n - 1];
  const floor = percentile(sorted, 0.05);
  const threshold = floor + (peak - floor) * settings.silenceThresholdFraction;

  // Voiced span: only the quiet gaps *between* the first and last voiced ms are
  // internal breaks; leading/trailing silence stays in the first/last segment.
  let firstVoice = -1;
  let lastVoice = -1;
  for (let i = 0; i < n; i++) {
    if (amp[i] >= threshold) {
      if (firstVoice < 0) firstVoice = i;
      lastVoice = i;
    }
  }
  // No voiced audio (silent/empty) → one segment spanning the whole media.
  if (firstVoice < 0) {
    onProgress?.(1);
    return [durationSec];
  }

  const minSilenceSamples = settings.minSilenceMs / msPerSample;
  const minSegSamples = settings.minSegmentLengthMs / msPerSample;
  const maxSegSamples = settings.maxSegmentLengthMs / msPerSample;

  // Collect qualifying quiet stretches within the voiced span.
  const runs: SilenceRun[] = [];
  let runStart = -1;
  for (let i = firstVoice; i <= lastVoice + 1; i++) {
    const silent = i <= lastVoice && amp[i] < threshold;
    if (silent) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const length = i - runStart;
      if (length >= minSilenceSamples) runs.push({ mid: (runStart + i) / 2, length });
      runStart = -1;
    }
  }

  // Prefer the longest pauses: accept greedily, keeping every segment ≥ min length.
  const accepted: number[] = [];
  for (const run of [...runs].sort((a, b) => b.length - a.length)) {
    const pos = run.mid;
    if (pos < minSegSamples || n - pos < minSegSamples) continue;
    if (accepted.every((a) => Math.abs(a - pos) >= minSegSamples)) accepted.push(pos);
  }
  accepted.sort((a, b) => a - b);

  // Honour the max-length goal: split any still-too-long segment at its quietest
  // interior points (SayMore's "prefer to break on a pause" applied within a run
  // of continuous speech).
  const breaks: number[] = [];
  const bounds = [0, ...accepted, n];
  for (let s = 0; s < bounds.length - 1; s++) {
    const start = bounds[s];
    const end = bounds[s + 1];
    const len = end - start;
    if (len > maxSegSamples) {
      const parts = Math.ceil(len / maxSegSamples);
      for (let p = 1; p < parts; p++) {
        const ideal = start + (len * p) / parts;
        const win = len / parts / 2;
        let best = Math.round(ideal);
        let bestAmp = amp[best] ?? Number.POSITIVE_INFINITY;
        for (
          let j = Math.max(start + 1, Math.floor(ideal - win));
          j < Math.min(end - 1, Math.ceil(ideal + win));
          j++
        ) {
          if (amp[j] < bestAmp) {
            bestAmp = amp[j];
            best = j;
          }
        }
        breaks.push(best);
      }
    }
    if (s < bounds.length - 2) breaks.push(end); // the accepted silence break itself
  }

  breaks.sort((a, b) => a - b);
  const seconds = breaks.map((sample) => (msPerSample * sample) / 1000);
  seconds.push(durationSec);
  onProgress?.(1);
  return seconds;
}
