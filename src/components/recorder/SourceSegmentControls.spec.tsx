// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { makeTimeRange } from "../../model/TimeRange";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { SegmentCellState } from "../../state/recorder/recorderTypes";
import type { Viewport } from "../waveform/WaveformSurface";
import { SourceSegmentControls } from "./SourceSegmentControls";

function fakeViewport(pxPerSec = 80): Viewport {
  return {
    pxPerSec,
    scrollLeft: 0,
    contentWidth: 1000,
    height: 128,
    secondsToPx: (sec) => sec * pxPerSec,
    pxToSeconds: (px) => px / pxPerSec,
  };
}

function fakeVm(overrides: Partial<RecorderViewModel> = {}): RecorderViewModel {
  const cells: SegmentCellState[] = [
    { range: makeTimeRange(0, 1), annotated: false, ignored: false, isCurrent: true },
    { range: makeTimeRange(1, 2), annotated: true, ignored: false, isCurrent: false },
  ];
  const vm = {
    cells,
    timeRangeForUndo: undefined,
    undoDescription: undefined,
    playSourceOf: vi.fn(),
    toggleIgnore: vi.fn(),
    undo: vi.fn(),
    ...overrides,
  };
  return vm as unknown as RecorderViewModel;
}

describe("SourceSegmentControls", () => {
  afterEach(() => cleanup());

  it("always shows a play button per segment, calling playSourceOf", () => {
    const vm = fakeVm();
    render(<SourceSegmentControls vm={vm} viewport={fakeViewport()} />);
    fireEvent.click(screen.getByTestId("segment-play-0"));
    expect(vm.playSourceOf).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByTestId("segment-play-1"));
    expect(vm.playSourceOf).toHaveBeenCalledWith(1);
  });

  it("shows the Ignored toggle only while hovering that segment, and it calls toggleIgnore", () => {
    const vm = fakeVm();
    render(<SourceSegmentControls vm={vm} viewport={fakeViewport()} />);
    expect(screen.queryByTestId("segment-ignore-0")).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId("segment-play-0").parentElement!);
    const toggle = screen.getByTestId("segment-ignore-0").querySelector("input")!;
    fireEvent.click(toggle);
    expect(vm.toggleIgnore).toHaveBeenCalledWith(0);

    fireEvent.mouseLeave(screen.getByTestId("segment-play-0").parentElement!);
    expect(screen.queryByTestId("segment-ignore-0")).toBeNull();
  });

  it("shows an Undo button only on the segment matching timeRangeForUndo, while hovering it", () => {
    const vm = fakeVm({
      timeRangeForUndo: makeTimeRange(1, 2),
      undoDescription: "Record annotation",
    });
    render(<SourceSegmentControls vm={vm} viewport={fakeViewport()} />);

    fireEvent.mouseEnter(screen.getByTestId("segment-play-0").parentElement!);
    expect(screen.queryByTestId("segment-undo")).toBeNull();
    fireEvent.mouseLeave(screen.getByTestId("segment-play-0").parentElement!);

    fireEvent.mouseEnter(screen.getByTestId("segment-play-1").parentElement!);
    const undoButton = screen.getByTestId("segment-undo");
    expect(undoButton.title).toContain("Record annotation");
    fireEvent.click(undoButton);
    expect(vm.undo).toHaveBeenCalledOnce();
  });
});
