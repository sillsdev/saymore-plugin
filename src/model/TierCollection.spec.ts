import { describe, it, expect } from "vitest";
import { makeTimeRange } from "./TimeRange";
import { IGNORE_MARKER } from "./IgnoreMarkers";
import { BoundaryResult } from "./BoundaryRules";
import { TierCollection } from "./TierCollection";
import type { AnnotationSegment } from "./AnnotationSegment";

const seg = (start: number, end: number, tx = "", ft = ""): AnnotationSegment => ({
  range: makeTimeRange(start, end),
  transcription: tx,
  freeTranslation: ft
});

describe("TierCollection", () => {
  it("delegates boundary edits and updates the observable array", () => {
    const tc = new TierCollection([seg(0, 2, "hello")]);
    expect(tc.insertBoundary(1)).toBe(BoundaryResult.Success);
    expect(tc.count).toBe(2);
    expect(tc.endBoundaries).toEqual([1, 2]);
  });

  it("rejects a too-short insert without mutating", () => {
    const tc = new TierCollection([seg(0, 2)]);
    expect(tc.insertBoundary(0.2)).toBe(BoundaryResult.SegmentWillBeTooShort);
    expect(tc.count).toBe(1);
  });

  it("snapshot + replaceAll round-trips independently (undo support)", () => {
    const tc = new TierCollection([seg(0, 1, "a"), seg(1, 2, "b")]);
    const snap = tc.snapshot();
    tc.deleteSegment(0);
    expect(tc.count).toBe(1);
    tc.replaceAll(snap);
    expect(tc.count).toBe(2);
    expect(tc.segments[0].transcription).toBe("a");
    // mutating the restored collection must not touch the snapshot
    tc.setTranscription(0, "changed");
    expect(snap[0].transcription).toBe("a");
  });

  it("toggles the ignore flag on the transcription tier", () => {
    const tc = new TierCollection([seg(0, 1, "text")]);
    tc.setIgnored(0, true);
    expect(tc.segments[0].transcription).toBe(IGNORE_MARKER);
    expect(tc.isSegmentIgnored(0)).toBe(true);
    tc.setIgnored(0, false);
    expect(tc.segments[0].transcription).toBe("");
    expect(tc.isSegmentIgnored(0)).toBe(false);
  });

  it("computes completeness (ignored segments need no translation)", () => {
    const tc = new TierCollection([seg(0, 1, "a", "one"), seg(1, 2, IGNORE_MARKER)]);
    expect(tc.isTranscriptionComplete).toBe(true);
    expect(tc.isTranslationComplete).toBe(true);
    tc.setTranscription(0, "");
    expect(tc.isTranscriptionComplete).toBe(false);
  });

  it("applies end-of-file rules", () => {
    const tc = new TierCollection([seg(0, 8)]);
    tc.applyEndOfFileRules(10);
    expect(tc.count).toBe(2);
    expect(tc.segments[1].transcription).toBe(IGNORE_MARKER);
  });
});
