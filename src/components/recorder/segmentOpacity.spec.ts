import { describe, it, expect } from "vitest";
import { cellOpacity, opacityMaskAlpha, SEGMENT_OPACITY } from "./segmentOpacity";

describe("cellOpacity", () => {
  it("is 100% for the current segment, regardless of ignored", () => {
    expect(cellOpacity({ isCurrent: true, ignored: false })).toBe(SEGMENT_OPACITY.current);
    expect(cellOpacity({ isCurrent: true, ignored: true })).toBe(SEGMENT_OPACITY.current);
  });

  it("is 30% for an ignored, non-current segment", () => {
    expect(cellOpacity({ isCurrent: false, ignored: true })).toBe(SEGMENT_OPACITY.ignored);
  });

  it("is 70% for a normal (not current, not ignored) segment", () => {
    expect(cellOpacity({ isCurrent: false, ignored: false })).toBe(SEGMENT_OPACITY.normal);
  });
});

describe("opacityMaskAlpha", () => {
  it("needs no mask for full opacity", () => {
    expect(opacityMaskAlpha(1)).toBe(0);
  });

  it("is the complement of the target opacity", () => {
    expect(opacityMaskAlpha(0.7)).toBeCloseTo(0.3, 10);
    expect(opacityMaskAlpha(0.3)).toBeCloseTo(0.7, 10);
  });
});
