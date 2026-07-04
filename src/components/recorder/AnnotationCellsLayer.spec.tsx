// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { makeAutoObservable } from "mobx";
import { makeTimeRange, type TimeRange } from "../../model/TimeRange";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { SegmentCellState } from "../../state/recorder/recorderTypes";
import type { Viewport } from "../waveform/WaveformSurface";
import { AnnotationCellsLayer } from "./AnnotationCellsLayer";
import * as miniWaveform from "./miniWaveform";

function fakeViewport(pxPerSec = 80): Viewport {
  return {
    pxPerSec,
    scrollLeft: 0,
    contentWidth: 1000,
    height: 72,
    secondsToPx: (sec) => sec * pxPerSec,
    pxToSeconds: (px) => px / pxPerSec,
  };
}

/**
 * A minimal MobX-observable overlay so mutating it (like a re-record
 * overwriting the same key) drives a real `observer()` re-render — the thing
 * the staleness bug depended on NOT happening.
 */
class FakeRecordingStore {
  bytes: Uint8Array | undefined;
  constructor(initial: Uint8Array | undefined) {
    this.bytes = initial;
    makeAutoObservable(this);
  }
  get(_range: TimeRange, _kind: string): Uint8Array | undefined {
    return this.bytes;
  }
  setBytes(b: Uint8Array | undefined): void {
    this.bytes = b;
  }
}

function fakeVm(
  store: FakeRecordingStore,
  overrides: Partial<RecorderViewModel> = {},
): RecorderViewModel {
  const cells: SegmentCellState[] = [
    { range: makeTimeRange(0, 1), annotated: true, ignored: false, isCurrent: false },
  ];
  const vm = {
    kind: "Careful",
    cells,
    currentIndex: 0,
    newSegmentEndSec: 0,
    endOfLastSegment: 1,
    isRecording: false,
    store,
    annotationPlayback: { isPlaying: false, positionSec: 0 },
    playAnnotation: vi.fn(),
    reRecordDown: vi.fn(),
    reRecordUp: vi.fn(),
    abortRecording: vi.fn(),
    eraseAnnotation: vi.fn(),
    ...overrides,
  };
  return vm as unknown as RecorderViewModel;
}

describe("AnnotationCellsLayer mini-waveform staleness", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("redraws the mini-waveform when the SAME vm's overlay bytes change in place (re-record)", () => {
    const bytesA = new Uint8Array([1]);
    const bytesB = new Uint8Array([2]);
    const store = new FakeRecordingStore(bytesA);
    const vm = fakeVm(store);
    const drawSpy = vi.spyOn(miniWaveform, "drawMiniWaveform").mockImplementation(() => {});
    const pointsSpy = vi.spyOn(miniWaveform, "miniWaveformFromWav").mockReturnValue([]);

    render(<AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />);
    expect(pointsSpy).toHaveBeenCalledWith(bytesA, expect.any(Number), 72);

    // Re-record overwrites the SAME store entry — vm/cells/range are all
    // unchanged, only the observable overlay's value at this key differs.
    act(() => store.setBytes(bytesB));

    expect(pointsSpy).toHaveBeenLastCalledWith(bytesB, expect.any(Number), 72);
    expect(drawSpy).toHaveBeenCalledTimes(2);
  });

  it("clears the canvas when the recording is erased (bytes go back to undefined)", () => {
    const bytes = new Uint8Array([1]);
    const store = new FakeRecordingStore(bytes);
    const vm = fakeVm(store);
    vi.spyOn(miniWaveform, "drawMiniWaveform").mockImplementation(() => {});
    vi.spyOn(miniWaveform, "miniWaveformFromWav").mockReturnValue([]);

    render(<AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />);
    const canvas = screen.getByTestId("annotation-cell-0").querySelector("canvas")!;
    const clearRect = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      clearRect,
    } as unknown as CanvasRenderingContext2D);

    act(() => store.setBytes(undefined));

    expect(clearRect).toHaveBeenCalledOnce();
  });
});

describe("AnnotationCellsLayer playback cursor + recording indicator", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a clip playback cursor only while this cell's clip is playing", () => {
    const store = new FakeRecordingStore(new Uint8Array([1]));
    // Kept as a plain mutable object (not accessed through the RecorderViewModel
    // type) since PlaybackEngine declares isPlaying/positionSec readonly.
    const annotationPlayback = { isPlaying: false, positionSec: 0 };
    const vm = fakeVm(store, { annotationPlayback } as unknown as Partial<RecorderViewModel>);
    vi.spyOn(miniWaveform, "drawMiniWaveform").mockImplementation(() => {});
    vi.spyOn(miniWaveform, "miniWaveformFromWav").mockReturnValue([]);
    const { rerender } = render(
      <AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />,
    );

    expect(screen.queryByTestId("playback-cursor")).toBeNull();

    act(() => screen.getByTestId("cell-play-0").click());
    expect(vm.playAnnotation).toHaveBeenCalledWith(0);

    // Clicking play doesn't itself flip isPlaying (that's the engine's job) —
    // simulate the engine starting.
    annotationPlayback.isPlaying = true;
    rerender(<AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />);
    expect(screen.getByTestId("playback-cursor")).toBeTruthy();

    annotationPlayback.isPlaying = false;
    rerender(<AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />);
    expect(screen.queryByTestId("playback-cursor")).toBeNull();
  });

  it("shows the recording indicator (hiding the mini-waveform) while (re-)recording this segment, and restores it when isRecording clears (abort)", () => {
    const store = new FakeRecordingStore(new Uint8Array([1]));
    const vm = fakeVm(store, { isRecording: true, currentIndex: 0 });
    vi.spyOn(miniWaveform, "drawMiniWaveform").mockImplementation(() => {});
    vi.spyOn(miniWaveform, "miniWaveformFromWav").mockReturnValue([]);
    const { rerender } = render(
      <AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />,
    );

    expect(screen.getByTestId("recording-indicator")).toBeTruthy();
    expect(screen.getByTestId("annotation-cell-0").querySelector("canvas")).toBeNull();

    // Abort: isRecording clears, model/bytes untouched -> old waveform is back.
    vm.isRecording = false;
    rerender(<AnnotationCellsLayer vm={vm} viewport={fakeViewport()} height={72} />);
    expect(screen.queryByTestId("recording-indicator")).toBeNull();
    expect(screen.getByTestId("annotation-cell-0").querySelector("canvas")).toBeTruthy();
  });
});
