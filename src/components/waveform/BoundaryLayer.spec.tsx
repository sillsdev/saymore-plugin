// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { makeTimeRange } from "../../model/TimeRange";
import type { AnnotationSegment } from "../../model/AnnotationSegment";
import type { SegmenterViewModel } from "../../state/SegmenterViewModel";
import type { Viewport } from "./WaveformSurface";
import { BoundaryLayer } from "./BoundaryLayer";

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

function fakeVm(overrides: Partial<SegmenterViewModel> = {}): SegmenterViewModel {
  const segments: AnnotationSegment[] = [
    { range: makeTimeRange(0, 2), transcription: "", freeTranslation: "" },
    { range: makeTimeRange(2, 4), transcription: "", freeTranslation: "" },
  ];
  const vm = {
    segments,
    durationSec: 10,
    editPositionSec: 0,
    selectedBoundaryIndex: -1,
    setHoveredSegment: vi.fn(),
    playSegment: vi.fn(),
    toggleIgnore: vi.fn(),
    selectBoundaryAt: vi.fn(),
    isBoundaryImmovable: vi.fn(() => false),
    requiresPermanenceConfirm: vi.fn(() => false),
    moveSelectedBoundaryTo: vi.fn(),
    ...overrides,
  };
  return vm as unknown as SegmenterViewModel;
}

/**
 * Drag boundary 0 from 2s to 3s (80px/s => +80px), i.e. past the drag dead
 * zone so `moved` is true.
 */
function dragBoundary(index: number): void {
  const boundary = screen.getByTestId(`boundary-${index}`);
  fireEvent.pointerDown(boundary, { pointerId: 1, clientX: 160 });
  fireEvent.pointerMove(boundary, { pointerId: 1, clientX: 240 });
  fireEvent.pointerUp(boundary, { pointerId: 1, clientX: 240 });
}

describe("BoundaryLayer drag-commit permanence gate", () => {
  afterEach(() => cleanup());

  it("commits the move directly when the boundary isn't permanence-gated", () => {
    const vm = fakeVm({ requiresPermanenceConfirm: vi.fn(() => false) });
    render(<BoundaryLayer vm={vm} viewport={fakeViewport()} />);
    dragBoundary(0);
    expect(vm.moveSelectedBoundaryTo).toHaveBeenCalledOnce();
  });

  it("confirms before committing when the boundary touches an oral recording, and commits on accept", () => {
    window.confirm = vi.fn().mockReturnValue(true);
    const vm = fakeVm({ requiresPermanenceConfirm: vi.fn(() => true) });
    render(<BoundaryLayer vm={vm} viewport={fakeViewport()} />);
    dragBoundary(0);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(vm.moveSelectedBoundaryTo).toHaveBeenCalledOnce();
  });

  it("does NOT move the boundary when the permanence confirm is declined", () => {
    window.confirm = vi.fn().mockReturnValue(false);
    const vm = fakeVm({ requiresPermanenceConfirm: vi.fn(() => true) });
    render(<BoundaryLayer vm={vm} viewport={fakeViewport()} />);
    dragBoundary(0);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(vm.moveSelectedBoundaryTo).not.toHaveBeenCalled();
  });
});
