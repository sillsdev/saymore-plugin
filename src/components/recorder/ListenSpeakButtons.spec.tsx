// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import { ListenButton, SpeakButton } from "./ListenSpeakButtons";

function fakeVm(): RecorderViewModel {
  return {
    mode: "Record",
    hasListenedToCurrent: true,
    isListening: false,
    isRecording: false,
    listenDown: vi.fn(),
    listenUp: vi.fn(),
    speakDown: vi.fn(),
    speakUp: vi.fn(),
    abortRecording: vi.fn(),
  } as unknown as RecorderViewModel;
}

describe("push-to-talk buttons end the press on every release path", () => {
  afterEach(cleanup);

  const cases = [
    ["Speak", "speakDown", "speakUp", SpeakButton],
    ["Listen", "listenDown", "listenUp", ListenButton],
  ] as const;

  describe.each(cases)("%s", (label, down, up, Button) => {
    it("stops on pointerup anywhere in the window", () => {
      const vm = fakeVm();
      render(<Button vm={vm} />);
      fireEvent.pointerDown(screen.getByRole("button", { name: label }), {
        button: 0,
        pointerId: 1,
      });
      expect(vm[down]).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(window);
      expect(vm[up]).toHaveBeenCalledTimes(1);
      expect(vm.abortRecording).not.toHaveBeenCalled();
    });

    it.each([
      ["window blur", () => fireEvent.blur(window)],
      ["pointercancel", () => fireEvent.pointerCancel(window)],
    ])("aborts on %s", (_name, end) => {
      const vm = fakeVm();
      render(<Button vm={vm} />);
      fireEvent.pointerDown(screen.getByRole("button", { name: label }), {
        button: 0,
        pointerId: 1,
      });
      end();
      expect(vm.abortRecording).toHaveBeenCalledTimes(1);
      expect(vm[up]).not.toHaveBeenCalled();
    });
  });

  it("does not start a press on a disabled Speak button", () => {
    const vm = { ...fakeVm(), hasListenedToCurrent: false } as unknown as RecorderViewModel;
    render(<SpeakButton vm={vm} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Speak" }), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(window);
    expect(vm.speakDown).not.toHaveBeenCalled();
    expect(vm.speakUp).not.toHaveBeenCalled();
  });
});
