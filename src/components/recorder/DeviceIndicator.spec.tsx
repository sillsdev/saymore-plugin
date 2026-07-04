// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import { DeviceIndicator } from "./DeviceIndicator";

function fakeVm(overrides: Partial<RecorderViewModel> = {}): RecorderViewModel {
  const vm = {
    deviceLabel: undefined,
    availableDevices: [],
    setDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return vm as unknown as RecorderViewModel;
}

describe("DeviceIndicator", () => {
  afterEach(() => cleanup());

  it("tooltips the current device label, or 'no input device' when undefined", () => {
    const { rerender } = render(<DeviceIndicator vm={fakeVm({ deviceLabel: undefined })} />);
    expect(screen.getByTitle("no input device")).toBeTruthy();

    rerender(<DeviceIndicator vm={fakeVm({ deviceLabel: "USB Audio Device" })} />);
    expect(screen.getByTitle("USB Audio Device")).toBeTruthy();
  });

  it("opens a picker listing availableDevices, and choosing one calls setDevice", () => {
    const vm = fakeVm({
      deviceLabel: "Internal Microphone",
      availableDevices: [
        { id: "a", label: "Internal Microphone" },
        { id: "b", label: "USB Audio Device" },
      ],
    });
    render(<DeviceIndicator vm={vm} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Internal Microphone/)).toBeTruthy();
    expect(screen.getByText(/USB Audio Device/)).toBeTruthy();

    fireEvent.click(screen.getByText(/USB Audio Device/));
    expect(vm.setDevice).toHaveBeenCalledWith("b");
  });

  it("shows a disabled placeholder when there are no devices to pick from", () => {
    render(<DeviceIndicator vm={fakeVm({ availableDevices: [] })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/No devices found/)).toBeTruthy();
  });
});
