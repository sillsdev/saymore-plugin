// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ProjectStore } from "../../state/ProjectStore";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { SegmentCellState, SpaceBarMode } from "../../state/recorder/recorderTypes";
import { makeTimeRange } from "../../model/TimeRange";
import { RecorderView } from "./RecorderView";

/**
 * A minimal fake VM (not a real RecorderViewModel — Track A's skeleton is
 * still no-ops) covering exactly the surface RecorderView/ListenSpeakButtons/
 * PeakMeter read, plus spies for every action they can trigger.
 */
function fakeVm(overrides: Partial<RecorderViewModel> = {}): RecorderViewModel {
  const cells: SegmentCellState[] = [
    { range: makeTimeRange(0, 1), annotated: false, ignored: false, isCurrent: true },
  ];
  const vm = {
    kind: "Careful",
    mode: "Listen" as SpaceBarMode,
    currentIndex: 0,
    newSegmentEndSec: 0,
    endOfLastSegment: cells.length ? cells[cells.length - 1].range.end : 0,
    hasListenedToCurrent: false,
    isListening: false,
    isRecording: false,
    micLevel: 0,
    deviceLabel: "Spy Microphone",
    warning: undefined,
    cells,
    // Only exercised when a cell is `annotated` — none of the fixtures below are.
    store: { get: vi.fn(() => undefined) },
    playback: { dispose: vi.fn() },
    listenDown: vi.fn(),
    listenUp: vi.fn(),
    speakDown: vi.fn(),
    speakUp: vi.fn().mockResolvedValue(undefined),
    replayCurrentSource: vi.fn(),
    playAnnotation: vi.fn(),
    playSourceOf: vi.fn(),
    eraseAnnotation: vi.fn(),
    reRecordDown: vi.fn(),
    reRecordUp: vi.fn().mockResolvedValue(undefined),
    abortRecording: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
  return vm as unknown as RecorderViewModel;
}

function fakeStore(vm: RecorderViewModel | undefined): ProjectStore {
  return {
    recorder: vm,
    envelope: undefined,
    closeRecorder: vi.fn(),
  } as unknown as ProjectStore;
}

describe("RecorderView", () => {
  // No global test-framework auto-registration here (vitest isn't run with
  // `globals: true`), so testing-library won't clean up between tests on its
  // own — do it explicitly, since several tests below render more than once.
  afterEach(() => cleanup());

  it("titles the pane by kind", () => {
    const { rerender } = render(<RecorderView store={fakeStore(fakeVm({ kind: "Careful" }))} />);
    expect(screen.getByText("Careful Speech Recorder")).toBeTruthy();

    rerender(<RecorderView store={fakeStore(fakeVm({ kind: "Translation" }))} />);
    expect(screen.getByText("Oral Translation Recorder")).toBeTruthy();
  });

  it("Back to transcriptions closes the recorder", () => {
    const store = fakeStore(fakeVm());
    render(<RecorderView store={store} />);
    fireEvent.click(screen.getByText(/Back to transcriptions/));
    expect(store.closeRecorder).toHaveBeenCalledOnce();
  });

  it("Speak is disabled until the current segment has been listened to", () => {
    render(
      <RecorderView store={fakeStore(fakeVm({ mode: "Record", hasListenedToCurrent: false }))} />,
    );
    const button = screen.getByRole("button", { name: /Speak/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("Speak enables once armed (mode Record + hasListenedToCurrent)", () => {
    render(
      <RecorderView store={fakeStore(fakeVm({ mode: "Record", hasListenedToCurrent: true }))} />,
    );
    const button = screen.getByRole("button", { name: /Speak/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("pointer down/up on Listen calls listenDown/listenUp", () => {
    const vm = fakeVm();
    render(<RecorderView store={fakeStore(vm)} />);
    const button = screen.getByRole("button", { name: /Listen/ });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
    expect(vm.listenDown).toHaveBeenCalledOnce();
    fireEvent.pointerUp(button, { pointerId: 1, button: 0 });
    expect(vm.listenUp).toHaveBeenCalledOnce();
  });

  it("pointer down/up on Speak calls speakDown/speakUp once armed", () => {
    const vm = fakeVm({ mode: "Record", hasListenedToCurrent: true });
    render(<RecorderView store={fakeStore(vm)} />);
    const button = screen.getByRole("button", { name: /Speak/ });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
    expect(vm.speakDown).toHaveBeenCalledOnce();
    fireEvent.pointerUp(button, { pointerId: 1, button: 0 });
    expect(vm.speakUp).toHaveBeenCalledOnce();
  });

  it("losing pointer capture mid-press aborts rather than completing the take", () => {
    const vm = fakeVm({ mode: "Record", hasListenedToCurrent: true });
    render(<RecorderView store={fakeStore(vm)} />);
    const button = screen.getByRole("button", { name: /Speak/ });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(vm.abortRecording).toHaveBeenCalledOnce();
    expect(vm.speakUp).not.toHaveBeenCalled();
  });

  it("shows the listen hint in Listen mode and the record hint in Record mode", () => {
    const { rerender } = render(<RecorderView store={fakeStore(fakeVm({ mode: "Listen" }))} />);
    expect(
      screen.getByText(/To listen to the source recording, press and hold the SPACE BAR/),
    ).toBeTruthy();

    rerender(<RecorderView store={fakeStore(fakeVm({ mode: "Record" }))} />);
    expect(screen.getByText(/To record, press and hold the SPACE BAR/)).toBeTruthy();
  });

  it("shows a green Finished banner in Done mode and a red banner in Error mode", () => {
    const { rerender } = render(<RecorderView store={fakeStore(fakeVm({ mode: "Done" }))} />);
    expect(screen.getByText(/Finished/)).toBeTruthy();

    rerender(
      <RecorderView
        store={fakeStore(fakeVm({ mode: "Error", warning: "Microphone unplugged." }))}
      />,
    );
    expect(screen.getByText(/Microphone unplugged\./)).toBeTruthy();
  });

  it("shows the too-short warning as its own banner alongside the Listen hint, not replacing it", () => {
    render(
      <RecorderView
        store={fakeStore(
          fakeVm({ mode: "Listen", warning: "Whoops. You need to hold down the SPACE BAR." }),
        )}
      />,
    );
    expect(
      screen.getByText(/To listen to the source recording, press and hold the SPACE BAR/),
    ).toBeTruthy();
    expect(screen.getByText(/Whoops\. You need to hold down the SPACE BAR\./)).toBeTruthy();
  });

  it("shows the device label from the mic meter", () => {
    render(<RecorderView store={fakeStore(fakeVm({ deviceLabel: "USB Headset" }))} />);
    expect(screen.getByText("USB Headset")).toBeTruthy();
  });

  it("renders one cell per segment, and ignored cells read 'skipped'", () => {
    const cells: SegmentCellState[] = [
      { range: makeTimeRange(0, 1), annotated: false, ignored: false, isCurrent: true },
      { range: makeTimeRange(1, 2), annotated: true, ignored: false, isCurrent: false },
      { range: makeTimeRange(2, 3), annotated: false, ignored: true, isCurrent: false },
    ];
    render(<RecorderView store={fakeStore(fakeVm({ cells }))} />);
    expect(screen.getByTestId("annotation-cell-0")).toBeTruthy();
    expect(screen.getByTestId("annotation-cell-1")).toBeTruthy();
    expect(screen.getByTestId("annotation-cell-2")).toBeTruthy();
    expect(screen.getByText("skipped")).toBeTruthy();
  });
});
