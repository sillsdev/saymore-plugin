// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlaybackCursor } from "./PlaybackCursor";

describe("PlaybackCursor", () => {
  afterEach(() => cleanup());

  it("renders at the given x position by default (visible)", () => {
    render(<PlaybackCursor xPx={42} height={100} />);
    const cursor = screen.getByTestId("playback-cursor") as HTMLElement;
    expect(cursor.style.left).toBe("42px");
    expect(cursor.style.height).toBe("100px");
  });

  it("renders nothing when visible is false (not playing)", () => {
    render(<PlaybackCursor xPx={42} height={100} visible={false} />);
    expect(screen.queryByTestId("playback-cursor")).toBeNull();
  });
});
