import { describe, it, expect } from "vitest";
import { makeTimeRange } from "../../model/TimeRange";
import type { SegmentCellState } from "../../state/recorder/recorderTypes";
import { layoutCells, newSegmentRect, type SecondsToPx } from "./cellLayout";

const cell = (
  start: number,
  end: number,
  over: Partial<SegmentCellState> = {},
): SegmentCellState => ({
  range: makeTimeRange(start, end),
  annotated: false,
  ignored: false,
  isCurrent: false,
  ...over,
});

function viewportAt(pxPerSec: number): SecondsToPx {
  return { secondsToPx: (sec) => sec * pxPerSec };
}

describe("layoutCells", () => {
  it("maps each cell's range to the same px scale the boundary overlay uses", () => {
    const cells = [cell(0, 1), cell(1, 2.5)];
    const rects = layoutCells(cells, viewportAt(80));
    expect(rects).toEqual([
      { index: 0, left: 0, width: 80 },
      { index: 1, left: 80, width: 120 },
    ]);
  });

  it("returns an empty array for no cells", () => {
    expect(layoutCells([], viewportAt(80))).toEqual([]);
  });

  it("never produces a negative width", () => {
    // Degenerate/inverted range shouldn't happen, but the math must stay safe.
    const rects = layoutCells([cell(2, 1)], viewportAt(80));
    expect(rects[0].width).toBe(0);
  });
});

describe("newSegmentRect", () => {
  it("spans from the end of the last segment to the current new-boundary position", () => {
    expect(newSegmentRect(3, 5, viewportAt(80))).toEqual({ left: 240, width: 160 });
  });

  it("is zero-width when the boundary hasn't moved past the last segment yet", () => {
    expect(newSegmentRect(3, 3, viewportAt(80))).toEqual({ left: 240, width: 0 });
  });
});
