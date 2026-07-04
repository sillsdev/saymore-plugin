import type { TimeRange } from "../../model/TimeRange";
import type { SegmentCellState } from "../../state/recorder/recorderTypes";
import type { Viewport } from "../waveform/WaveformSurface";

/** Pixel span (in the waveform's content coordinates) for one annotation cell. */
export interface CellRect {
  index: number;
  left: number;
  width: number;
}

/** Only the piece of {@link Viewport} this pure math needs. */
export type SecondsToPx = Pick<Viewport, "secondsToPx">;

/**
 * One rect per real segment cell, using the same seconds→px mapping as the
 * boundary overlay so the strip lines up pixel-for-pixel with the waveform
 * above it regardless of zoom/scroll.
 */
export function layoutCells(cells: readonly SegmentCellState[], viewport: SecondsToPx): CellRect[] {
  return cells.map((cell, index) => {
    const left = viewport.secondsToPx(cell.range.start);
    const width = Math.max(0, viewport.secondsToPx(cell.range.end) - left);
    return { index, left, width };
  });
}

/** Rect for the virtual new-segment slot: from the end of the last real segment to `newSegmentEndSec`. */
export function newSegmentRect(
  lastSegmentEndSec: number,
  newSegmentEndSec: number,
  viewport: SecondsToPx,
): Omit<CellRect, "index"> {
  const left = viewport.secondsToPx(lastSegmentEndSec);
  const width = Math.max(0, viewport.secondsToPx(newSegmentEndSec) - left);
  return { left, width };
}

/** Tolerance for treating two ranges' endpoints as the same instant (float seconds). */
const SAME_RANGE_EPS_SEC = 1e-6;

/**
 * True when `a` and `b` denote the same time span — used to find which
 * segment the VM's `timeRangeForUndo` refers to (segment identity is
 * positional/by-range, not by id; see AnnotationSegment). `b` is optional so
 * callers can pass `vm.timeRangeForUndo` (undefined when nothing is undoable)
 * directly.
 */
export function sameTimeRange(a: TimeRange, b: TimeRange | undefined): boolean {
  if (!b) return false;
  return (
    Math.abs(a.start - b.start) < SAME_RANGE_EPS_SEC && Math.abs(a.end - b.end) < SAME_RANGE_EPS_SEC
  );
}
