import { describe, it, expect } from "vitest";
import { clipCursorXPx, sourceCursorXPx } from "./playbackCursor";

describe("sourceCursorXPx", () => {
  it("maps position through the viewport's px-per-second (scroll-independent content coords)", () => {
    expect(sourceCursorXPx(2, { secondsToPx: (s) => s * 80 })).toBe(160);
  });

  it("tracks zoom changes (a different pxPerSec)", () => {
    expect(sourceCursorXPx(2, { secondsToPx: (s) => s * 160 })).toBe(320);
  });

  it("is 0 at the start", () => {
    expect(sourceCursorXPx(0, { secondsToPx: (s) => s * 80 })).toBe(0);
  });
});

describe("clipCursorXPx", () => {
  it("is a straight fraction of the cell width, not a seconds->px mapping", () => {
    expect(clipCursorXPx(0.5, 2, 100)).toBe(25);
    expect(clipCursorXPx(1, 2, 100)).toBe(50);
    expect(clipCursorXPx(2, 2, 100)).toBe(100);
  });

  it("clamps to the cell bounds for out-of-range positions", () => {
    expect(clipCursorXPx(-1, 2, 100)).toBe(0);
    expect(clipCursorXPx(3, 2, 100)).toBe(100);
  });

  it("is 0 for a zero/negative duration rather than dividing by zero", () => {
    expect(clipCursorXPx(0.5, 0, 100)).toBe(0);
    expect(clipCursorXPx(0.5, -1, 100)).toBe(0);
  });
});
