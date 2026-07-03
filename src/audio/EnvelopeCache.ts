/**
 * The min/max **envelope** of audio at 1 sample-per-millisecond resolution. This
 * single structure feeds three consumers (plan decision): wavesurfer's
 * precomputed `peaks`, the grid thumbnail canvases, and the auto-segmenter's
 * sample source. Raw PCM is NOT retained — only this envelope, the sample rate,
 * and the duration.
 */
export interface ChannelEnvelope {
  /** Per-ms bucket minimum sample value, normalized to [-1, 1]. */
  readonly min: Float32Array;
  /** Per-ms bucket maximum sample value, normalized to [-1, 1]. */
  readonly max: Float32Array;
}

export interface Envelope {
  readonly channels: readonly ChannelEnvelope[];
  /** Envelope resolution; 1 bucket per millisecond (mirrors SayMore aggregation). */
  readonly samplesPerMs: number;
  /** Native sample rate of the decoded/streamed audio. */
  readonly sampleRate: number;
  readonly durationSec: number;
}

/**
 * Keyed cache of computed envelopes (by media file identity — name+size or a
 * content hash, chosen by the F2 track). A plain Map wrapper for now; the
 * contract is the shape above.
 */
export class EnvelopeCache {
  private map = new Map<string, Envelope>();

  get(key: string): Envelope | undefined {
    return this.map.get(key);
  }

  set(key: string, envelope: Envelope): void {
    this.map.set(key, envelope);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}
