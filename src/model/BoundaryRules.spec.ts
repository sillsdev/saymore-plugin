import { describe, it, expect } from "vitest";
import type { AnnotationSegment } from "./AnnotationSegment";
import { makeTimeRange } from "./TimeRange";
import { IGNORE_MARKER } from "./IgnoreMarkers";
import {
  BoundaryResult,
  isAcceptableSegmentLength,
  insertBoundary,
  moveBoundary,
  clampBoundaryPosition,
  nudgeBoundary,
  deleteSegment,
  addFinalSegmentIfAlmostComplete,
  trimSegmentsToDuration
} from "./BoundaryRules";

function s(
  start: number,
  end: number,
  transcription = "",
  freeTranslation = ""
): AnnotationSegment {
  return { range: makeTimeRange(start, end), transcription, freeTranslation };
}

const ranges = (segs: readonly AnnotationSegment[]) =>
  segs.map((x) => [x.range.start, x.range.end]);

describe("isAcceptableSegmentLength (460ms clamp)", () => {
  it("accepts exactly 460ms and rejects just under", () => {
    expect(isAcceptableSegmentLength(0, 0.46)).toBe(true);
    expect(isAcceptableSegmentLength(0, 0.459)).toBe(false);
    expect(isAcceptableSegmentLength(1, 1.46)).toBe(true);
  });
  it("tolerates sub-millisecond float noise around the threshold", () => {
    // 0.4600004s → 460.0004ms, ×100 rounds to >=0 → accepted.
    expect(isAcceptableSegmentLength(0, 0.4600004)).toBe(true);
  });
});

describe("insertBoundary", () => {
  it("appends past the last segment", () => {
    const r = insertBoundary([s(0, 1)], 2);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(ranges(r.segments)).toEqual([
      [0, 1],
      [1, 2]
    ]);
  });

  it("splits an enclosing segment, moving original text to the RIGHT half", () => {
    const r = insertBoundary([s(0, 2, "hello", "hola")], 1);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(ranges(r.segments)).toEqual([
      [0, 1],
      [1, 2]
    ]);
    expect(r.segments[0].transcription).toBe(""); // new left half is empty
    expect(r.segments[1].transcription).toBe("hello"); // original text follows right
    expect(r.segments[1].freeTranslation).toBe("hola");
  });

  it("splitting an ignored segment keeps both halves ignored", () => {
    const r = insertBoundary([s(0, 2, IGNORE_MARKER)], 1);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(r.segments[0].transcription).toBe(IGNORE_MARKER);
    expect(r.segments[1].transcription).toBe(IGNORE_MARKER);
  });

  it("rejects when the left part would be too short", () => {
    const r = insertBoundary([s(0, 2)], 0.4);
    expect(r.result).toBe(BoundaryResult.SegmentWillBeTooShort);
    expect(r.segments).toHaveLength(1);
  });

  it("rejects when the right part would be too short (distinct code)", () => {
    const r = insertBoundary([s(0, 2)], 1.7);
    expect(r.result).toBe(BoundaryResult.NextSegmentWillBeTooShort);
  });

  it("rejects boundary at 0 and a duplicate of an existing boundary", () => {
    expect(insertBoundary([s(0, 1)], 0).result).toBe(BoundaryResult.SegmentWillBeTooShort);
    expect(insertBoundary([s(0, 1), s(1, 2)], 1).result).toBe(
      BoundaryResult.SegmentWillBeTooShort
    );
  });
});

describe("moveBoundary + clamp matrix", () => {
  const base = [s(0, 1, "a"), s(1, 2, "b"), s(2, 3, "c")];

  it("moves the shared boundary and re-aligns both neighbors", () => {
    const r = moveBoundary(base, 0, 1.5);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(ranges(r.segments)).toEqual([
      [0, 1.5],
      [1.5, 2],
      [2, 3]
    ]);
  });

  it("rejects if the moved segment would be too short", () => {
    expect(moveBoundary(base, 0, 0.3).result).toBe(BoundaryResult.SegmentWillBeTooShort);
  });

  it("rejects if the NEXT segment would be too short", () => {
    expect(moveBoundary(base, 0, 1.7).result).toBe(BoundaryResult.NextSegmentWillBeTooShort);
  });

  it("last segment's end has no next-segment constraint", () => {
    const r = moveBoundary(base, 2, 2.5);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(r.segments[2].range.end).toBe(2.5);
  });

  it("clampBoundaryPosition keeps drags inside the legal window", () => {
    expect(clampBoundaryPosition(base, 0, 0.1, 3)).toBeCloseTo(0.46, 5);
    expect(clampBoundaryPosition(base, 0, 5, 3)).toBeCloseTo(2 - 0.46, 5);
    // last boundary clamps up to the media duration
    expect(clampBoundaryPosition(base, 2, 99, 3)).toBe(3);
  });
});

describe("nudgeBoundary (±5ms)", () => {
  const base = [s(0, 1), s(1, 2)];
  it("advances by 5ms", () => {
    const r = nudgeBoundary(base, 0, 5, 2);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(r.segments[0].range.end).toBeCloseTo(1.005, 6);
  });
  it("refuses to nudge past the media end", () => {
    expect(nudgeBoundary(base, 1, 5, 2).result).toBe(BoundaryResult.NextSegmentWillBeTooShort);
  });
});

describe("deleteSegment (join)", () => {
  it("following segment absorbs time; text joins forward with a space", () => {
    const r = deleteSegment([s(0, 1, "one", "uno"), s(1, 2, "two", "dos"), s(2, 3, "three")], 0);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(ranges(r.segments)).toEqual([
      [0, 2],
      [2, 3]
    ]);
    expect(r.segments[0].transcription).toBe("one two");
    expect(r.segments[0].freeTranslation).toBe("uno dos");
  });

  it("deleting the last segment drops its time and joins text backward", () => {
    const r = deleteSegment([s(0, 1, "one"), s(1, 2, "two")], 1);
    expect(ranges(r.segments)).toEqual([[0, 1]]);
    expect(r.segments[0].transcription).toBe("one two");
  });

  it("joining a real segment into an ignored one clears the ignore flag", () => {
    const r = deleteSegment([s(0, 1, "hello"), s(1, 2, IGNORE_MARKER)], 0);
    // from='hello' (not ignore), to='%ignore%', from non-empty → to cleared
    expect(r.segments[0].transcription).toBe("hello");
  });

  it("an ignored 'from' segment contributes no text", () => {
    const r = deleteSegment([s(0, 1, IGNORE_MARKER), s(1, 2, "world")], 0);
    expect(r.segments[0].transcription).toBe("world");
  });
});

describe("addFinalSegmentIfAlmostComplete", () => {
  it("extends the last segment when the gap is below the minimum", () => {
    const r = addFinalSegmentIfAlmostComplete([s(0, 9.8)], 10);
    expect(ranges(r)).toEqual([[0, 10]]);
  });
  it("appends a trailing ignored segment when the gap is >= min but within 5s", () => {
    const r = addFinalSegmentIfAlmostComplete([s(0, 8)], 10);
    expect(ranges(r)).toEqual([
      [0, 8],
      [8, 10]
    ]);
    expect(r[1].transcription).toBe(IGNORE_MARKER);
  });
  it("leaves a large tail unsegmented", () => {
    const r = addFinalSegmentIfAlmostComplete([s(0, 3)], 10);
    expect(ranges(r)).toEqual([[0, 3]]);
  });
  it("no-op when the last segment already ends at the media end", () => {
    const r = addFinalSegmentIfAlmostComplete([s(0, 10)], 10);
    expect(ranges(r)).toEqual([[0, 10]]);
  });
});

describe("trimSegmentsToDuration", () => {
  it("drops segments past the end and clamps overhanging ones", () => {
    const r = trimSegmentsToDuration([s(0, 1), s(1, 2.5), s(3, 4)], 2);
    expect(ranges(r)).toEqual([
      [0, 1],
      [1, 2]
    ]);
  });
});
