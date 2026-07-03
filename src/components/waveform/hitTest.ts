import type { AnnotationSegment } from "../../model/AnnotationSegment";
import { BOUNDARY_HIT_HALF_WIDTH_PX } from "../../model/SayMoreConstants";

/**
 * Pure hit-testing for the interaction overlay (content-pixel coordinates). Kept
 * separate from the React components so they're unit-testable.
 */

/** Index of the boundary within `tolPx` of `contentX`, or -1. SayMore uses ±4px. */
export function boundaryIndexAtPx(
  boundaries: readonly number[],
  contentX: number,
  pxPerSec: number,
  tolPx: number = BOUNDARY_HIT_HALF_WIDTH_PX,
): number {
  let best = -1;
  let bestDist = tolPx + 1;
  for (let i = 0; i < boundaries.length; i++) {
    const dist = Math.abs(boundaries[i] * pxPerSec - contentX);
    if (dist <= tolPx && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/** Index of the segment enclosing `contentX`, or -1. */
export function segmentIndexAtPx(
  segments: readonly AnnotationSegment[],
  contentX: number,
  pxPerSec: number,
): number {
  const seconds = pxPerSec > 0 ? contentX / pxPerSec : 0;
  return segments.findIndex((s) => seconds >= s.range.start && seconds < s.range.end);
}
