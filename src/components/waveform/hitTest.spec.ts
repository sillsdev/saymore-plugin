import { describe, it, expect } from "vitest";
import { makeTimeRange } from "../../model/TimeRange";
import type { AnnotationSegment } from "../../model/AnnotationSegment";
import { boundaryIndexAtPx, segmentIndexAtPx } from "./hitTest";

const seg = (start: number, end: number): AnnotationSegment => ({
  range: makeTimeRange(start, end),
  transcription: "",
  freeTranslation: ""
});

describe("boundaryIndexAtPx", () => {
  const boundaries = [1, 2, 3]; // seconds
  const pxPerSec = 80; // → 80, 160, 240 px

  it("hits within ±4px and picks the nearest", () => {
    expect(boundaryIndexAtPx(boundaries, 82, pxPerSec)).toBe(0);
    expect(boundaryIndexAtPx(boundaries, 158, pxPerSec)).toBe(1);
  });

  it("misses beyond the tolerance", () => {
    expect(boundaryIndexAtPx(boundaries, 90, pxPerSec)).toBe(-1);
  });
});

describe("segmentIndexAtPx", () => {
  const segments = [seg(0, 1), seg(1, 2), seg(2, 3)];
  it("finds the enclosing segment", () => {
    expect(segmentIndexAtPx(segments, 40, 80)).toBe(0); // 0.5s
    expect(segmentIndexAtPx(segments, 200, 80)).toBe(2); // 2.5s
  });
  it("returns -1 past the end", () => {
    expect(segmentIndexAtPx(segments, 400, 80)).toBe(-1);
  });
});
