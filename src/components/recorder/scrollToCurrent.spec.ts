import { describe, it, expect } from "vitest";
import { SCROLL_MARGIN_PX, scrollLeftToShow } from "./scrollToCurrent";

describe("scrollLeftToShow", () => {
  it("does not scroll when the segment is already in view", () => {
    expect(scrollLeftToShow(100, 300, 0, 1000)).toBeUndefined();
  });

  it("scrolls right to a segment past the view's right edge", () => {
    expect(scrollLeftToShow(3000, 3300, 0, 1500)).toBe(3000 - SCROLL_MARGIN_PX);
  });

  it("scrolls left to a segment before the view", () => {
    expect(scrollLeftToShow(100, 200, 2000, 1500)).toBe(100 - SCROLL_MARGIN_PX);
  });

  it("never scrolls before the start of the content", () => {
    expect(scrollLeftToShow(10, 5000, 2000, 1500)).toBe(0);
  });

  it("shows the new-segment slot even when it has no width yet", () => {
    expect(scrollLeftToShow(5117, 5117, 0, 1488)).toBe(5117 - SCROLL_MARGIN_PX);
  });

  it("leaves a segment wider than the view alone once its start is at the margin", () => {
    expect(scrollLeftToShow(3000, 6000, 3000 - SCROLL_MARGIN_PX, 1500)).toBeUndefined();
  });

  it("does nothing before the view has a width", () => {
    expect(scrollLeftToShow(3000, 3300, 0, 0)).toBeUndefined();
  });
});
