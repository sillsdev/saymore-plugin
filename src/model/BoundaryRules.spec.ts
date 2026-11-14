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
  trimSegmentsToDuration,
} from "./BoundaryRules";

function s(
  start: number,
  end: number,
  transcription = "",
  freeTranslation = "",
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
      [1, 2],
    ]);
  });

  it("splits an enclosing segment, moving original text to the RIGHT half", () => {
    const r = insertBoundary([s(0, 2, "hello", "hola")], 1);
    expect(r.result).toBe(BoundaryResult.Success);
    expect(ranges(r.segments)).toEqual([
      [0, 1],
      [1, 2],
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
    expect(insertBoundary([s(0, 1), s(1, 2)], 1).result).toBe(BoundaryResult.SegmentWillBeTooShort);
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
      [2, 3],
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
      [2, 3],
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
      [8, 10],
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
      [1, 2],
    ]);
  });
});

describe("boundaries are held at whole milliseconds (the eaf's TIME_VALUE precision)", () => {
  const isWholeMs = (sec: number) => sec === Math.round(sec * 1000) / 1000;
  const allWholeMs = (segs: readonly AnnotationSegment[]) =>
    segs.every((x) => isWholeMs(x.range.start) && isWholeMs(x.range.end));

  it("insertBoundary rounds an unrounded position (append and split)", () => {
    const appended = insertBoundary([], 1.0060531);
    expect(appended.result).toBe(BoundaryResult.Success);
    expect(ranges(appended.segments)).toEqual([[0, 1.006]]);

    const split = insertBoundary([s(0, 5)], 2.3456789);
    expect(split.result).toBe(BoundaryResult.Success);
    expect(ranges(split.segments)).toEqual([
      [0, 2.346],
      [2.346, 5],
    ]);
  });

  it("moveBoundary rounds the new end on both sides of the boundary", () => {
    const moved = moveBoundary([s(0, 1), s(1, 3)], 0, 1.4123456);
    expect(moved.result).toBe(BoundaryResult.Success);
    expect(ranges(moved.segments)).toEqual([
      [0, 1.412],
      [1.412, 3],
    ]);
  });

  it("repeated nudges land on exact whole-ms values (no float drift)", () => {
    let segs: readonly AnnotationSegment[] = [s(0, 1.25), s(1.25, 5)];
    for (let i = 0; i < 101; i++) segs = nudgeBoundary(segs, 0, 5, 10).segments;
    expect(segs[0].range.end).toBe(1.755);
    expect(segs[1].range.start).toBe(1.755);
    expect(allWholeMs(segs)).toBe(true);
  });

  it("end-of-file rules and trimming round an unrounded media duration", () => {
    const extended = addFinalSegmentIfAlmostComplete([s(0, 9.8)], 9.9876543);
    expect(ranges(extended)).toEqual([[0, 9.988]]);
    const appended = addFinalSegmentIfAlmostComplete([s(0, 8)], 9.9876543);
    expect(ranges(appended)).toEqual([
      [0, 8],
      [8, 9.988],
    ]);
    const trimmed = trimSegmentsToDuration([s(0, 5), s(5, 12)], 9.9876543);
    expect(ranges(trimmed)).toEqual([
      [0, 5],
      [5, 9.988],
    ]);
  });

  it("deleteSegment keeps whole-ms boundaries", () => {
    const { segments } = deleteSegment([s(0, 1.006), s(1.006, 2.5), s(2.5, 4)], 1);
    expect(ranges(segments)).toEqual([
      [0, 1.006],
      [1.006, 4],
    ]);
    expect(allWholeMs(segments)).toBe(true);
  });
});
