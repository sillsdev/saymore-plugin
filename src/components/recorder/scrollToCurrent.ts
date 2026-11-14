/** Gap left of the current segment after scrolling to it, so its start boundary is not flush. */
export const SCROLL_MARGIN_PX = 40;

/**
 * The scrollLeft (content px) that brings the current segment `[startPx, endPx]` into a view
 * `viewWidthPx` wide, or undefined when no scroll is needed: the segment already fits, or it is
 * wider than the view and its start already sits at the margin.
 */
export function scrollLeftToShow(
  startPx: number,
  endPx: number,
  scrollLeft: number,
  viewWidthPx: number,
): number | undefined {
  if (viewWidthPx <= 0) return undefined;
  if (startPx >= scrollLeft && endPx <= scrollLeft + viewWidthPx) return undefined;
  const target = Math.max(0, startPx - SCROLL_MARGIN_PX);
  return Math.abs(target - scrollLeft) < 1 ? undefined : target;
}
