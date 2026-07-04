// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlaybackCursor } from "./PlaybackCursor";

describe("PlaybackCursor", () => {
  afterEach(() => cleanup());

  it("renders at the given x position via transform (compositor-only, not left)", () => {
    render(<PlaybackCursor xPx={42} height={100} />);
    const cursor = screen.getByTestId("playback-cursor") as HTMLElement;
    expect(cursor.style.transform).toBe("translateX(42px)");
    expect(cursor.style.left).toBe("");
    expect(cursor.style.height).toBe("100px");
  });

  it("forwards a ref to the underlying element (for an rAF loop to write style.transform directly)", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<PlaybackCursor ref={ref} xPx={0} height={100} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.getAttribute("data-testid")).toBe("playback-cursor");
  });

  it("renders nothing when visible is false (not playing)", () => {
    render(<PlaybackCursor xPx={42} height={100} visible={false} />);
    expect(screen.queryByTestId("playback-cursor")).toBeNull();
  });
});
