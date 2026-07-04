import type { SecondsToPx } from "./cellLayout";

/** Absolute source-time position -> content px, for the cursor over the source waveform. */
export function sourceCursorXPx(positionSec: number, viewport: SecondsToPx): number {
  return viewport.secondsToPx(positionSec);
}

/**
 * Clip-relative playback position -> px within a cell of `cellWidthPx` wide.
 * The mini-waveform fills the cell start-to-end regardless of the clip's
 * absolute duration, so the cursor is a straight fraction of clip playback,
 * not a `secondsToPx` mapping.
 */
export function clipCursorXPx(
  positionSec: number,
  durationSec: number,
  cellWidthPx: number,
): number {
  if (durationSec <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, positionSec / durationSec));
  return fraction * cellWidthPx;
}
