import { computeEnvelopeFromWav } from "../../audio/envelope";
import type { Envelope } from "../../audio/EnvelopeCache";

/** One column of a downsampled mini-waveform, in canvas pixel coordinates. */
export interface MiniWaveformPoint {
  x: number;
  yMin: number;
  yMax: number;
}

/**
 * Downsample an {@link Envelope}'s first channel to `width` columns spanning
 * `height` px (0 at the top), min/max per column for a filled polyline. Pure
 * math — no canvas — so it's asserted directly in specs.
 */
export function miniWaveformPoints(
  envelope: Envelope,
  width: number,
  height: number,
): MiniWaveformPoint[] {
  const channel = envelope.channels[0];
  const w = Math.max(0, Math.round(width));
  if (!channel || w <= 0 || height <= 0 || channel.min.length === 0) return [];

  const n = channel.min.length;
  const half = height / 2;
  const points: MiniWaveformPoint[] = [];
  for (let x = 0; x < w; x++) {
    const startIdx = Math.floor((x / w) * n);
    const endIdx = Math.max(startIdx + 1, Math.floor(((x + 1) / w) * n));
    let bucketMin = 1;
    let bucketMax = -1;
    for (let i = startIdx; i < endIdx && i < n; i++) {
      if (channel.min[i] < bucketMin) bucketMin = channel.min[i];
      if (channel.max[i] > bucketMax) bucketMax = channel.max[i];
    }
    if (bucketMin > bucketMax) {
      bucketMin = 0;
      bucketMax = 0;
    }
    // Sample values are [-1, 1]; map to [0, height] with 0 at the vertical center.
    points.push({ x, yMin: half - bucketMin * half, yMax: half - bucketMax * half });
  }
  return points;
}

/** WAV bytes → mini-waveform points sized to a cell's pixel box. */
export function miniWaveformFromWav(
  bytes: Uint8Array,
  width: number,
  height: number,
): MiniWaveformPoint[] {
  return miniWaveformPoints(computeEnvelopeFromWav(bytes), width, height);
}

/** A clip's duration from its WAV header — for mapping the cell's playback cursor. */
export function wavDurationSec(bytes: Uint8Array): number {
  return computeEnvelopeFromWav(bytes).durationSec;
}

/**
 * Draw the filled mini-waveform polygon onto a canvas. A no-op when the
 * environment has no 2D canvas context (e.g. happy-dom in specs) or there's
 * nothing to draw — never throws.
 */
export function drawMiniWaveform(
  canvas: HTMLCanvasElement,
  points: readonly MiniWaveformPoint[],
  color: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].yMax);
  for (const p of points) ctx.lineTo(p.x, p.yMax);
  for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i].x, points[i].yMin);
  ctx.closePath();
  ctx.fill();
}
