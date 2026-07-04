/**
 * Pure layout/decode helpers for the Oral Annotations viewer (three stacked
 * waveform rows over the combined `<media>.oralAnnotations.wav`). Channel
 * layout matches `generateOralAnnotationsWav`: the source media's channels
 * first, then one mono Careful channel, then one mono Translation channel.
 */

export interface OralAnnotationsChannelGroups {
  /** One or more channels (drawn mono-mixed for the Source row). */
  source: Float32Array[];
  careful: Float32Array;
  translation: Float32Array;
}

/** Split the combined file's decoded channels into the three labeled rows. */
export function splitOralAnnotationsChannels(
  channels: readonly Float32Array[],
  sourceChannelCount: number,
): OralAnnotationsChannelGroups {
  return {
    source: channels.slice(0, sourceChannelCount),
    careful: channels[sourceChannelCount] ?? new Float32Array(0),
    translation: channels[sourceChannelCount + 1] ?? new Float32Array(0),
  };
}

/** One column of a downsampled waveform, in canvas pixel coordinates. */
export interface WaveformPoint {
  x: number;
  yMin: number;
  yMax: number;
}

/**
 * Downsample one or more raw sample channels (mono-mixed by taking the
 * min/max across all of them per bucket — a cheap, visualization-only
 * downmix) to `width` columns spanning `height` px. No zoom controls in this
 * viewer (fixed fit-with-hscroll), so this always spans the full clip.
 */
export function downsampleChannels(
  channels: readonly Float32Array[],
  width: number,
  height: number,
): WaveformPoint[] {
  const w = Math.max(0, Math.round(width));
  const n = channels.reduce((max, ch) => Math.max(max, ch.length), 0);
  if (channels.length === 0 || w <= 0 || height <= 0 || n === 0) return [];

  const half = height / 2;
  const points: WaveformPoint[] = [];
  for (let x = 0; x < w; x++) {
    const startIdx = Math.floor((x / w) * n);
    const endIdx = Math.max(startIdx + 1, Math.floor(((x + 1) / w) * n));
    let bucketMin = 1;
    let bucketMax = -1;
    for (let i = startIdx; i < endIdx && i < n; i++) {
      for (const ch of channels) {
        const v = ch[i];
        if (v === undefined) continue;
        if (v < bucketMin) bucketMin = v;
        if (v > bucketMax) bucketMax = v;
      }
    }
    if (bucketMin > bucketMax) {
      bucketMin = 0;
      bucketMax = 0;
    }
    points.push({ x, yMin: half - bucketMin * half, yMax: half - bucketMax * half });
  }
  return points;
}
