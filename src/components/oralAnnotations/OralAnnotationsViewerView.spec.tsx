// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ProjectStore } from "../../state/ProjectStore";
import * as wavCodec from "../../audio/wavCodec";
import { OralAnnotationsViewerView } from "./OralAnnotationsViewerView";

function fakeStore(overrides: {
  oralViewer?: Record<string, unknown>;
  envelope?: { channels: unknown[] };
}): ProjectStore {
  return {
    oralViewer: overrides.oralViewer,
    envelope: overrides.envelope ?? { channels: [{}] },
  } as unknown as ProjectStore;
}

describe("OralAnnotationsViewerView", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when the viewer hasn't been opened", () => {
    const { container } = render(<OralAnnotationsViewerView store={fakeStore({})} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading message while loading, with no rows yet", () => {
    render(
      <OralAnnotationsViewerView
        store={fakeStore({ oralViewer: { bytes: undefined, durationSec: 0, loading: true } })}
      />,
    );
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByTestId("oralann-row-source")).toBeNull();
  });

  it("shows the three labeled rows and enables Play once bytes are loaded", () => {
    vi.spyOn(wavCodec, "decodeWav").mockReturnValue({
      channels: [new Float32Array(10), new Float32Array(10)], // 1 source ch + careful
      sampleRate: 48000,
    });
    const store = fakeStore({
      oralViewer: { bytes: new Uint8Array([1]), durationSec: 5, loading: false },
      envelope: { channels: [{}] }, // mono source
    });
    render(<OralAnnotationsViewerView store={store} />);

    expect(screen.getByTestId("oralann-row-source")).toBeTruthy();
    expect(screen.getByTestId("oralann-row-careful")).toBeTruthy();
    expect(screen.getByTestId("oralann-row-translation")).toBeTruthy();
    expect((screen.getByTestId("oralann-play") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("oralann-stop") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the pos/total readout and calls regenerate() from the toolbar button", () => {
    vi.spyOn(wavCodec, "decodeWav").mockReturnValue({
      channels: [new Float32Array(10), new Float32Array(10)],
      sampleRate: 48000,
    });
    const regenerate = vi.fn();
    const store = fakeStore({
      oralViewer: {
        bytes: new Uint8Array([1]),
        durationSec: 16.8,
        loading: false,
        isRegenerating: false,
        regenerate,
      },
    });
    render(<OralAnnotationsViewerView store={store} />);

    expect(screen.getByTestId("oralann-time-readout").textContent).toBe("00.0 / 16.8");

    fireEvent.click(screen.getByTestId("oralann-regenerate"));
    expect(regenerate).toHaveBeenCalledOnce();
  });

  it("shows the not-generated message when there are no bytes and nothing is loading", () => {
    render(
      <OralAnnotationsViewerView
        store={fakeStore({ oralViewer: { bytes: undefined, durationSec: 0, loading: false } })}
      />,
    );
    expect(screen.getByText(/Not generated yet/)).toBeTruthy();
  });

  it("anchors the spanning cursor inside the waveform column (x=0 at canvas left), not over the row labels", () => {
    vi.spyOn(wavCodec, "decodeWav").mockReturnValue({
      channels: [new Float32Array(10), new Float32Array(10)],
      sampleRate: 48000,
    });
    const store = fakeStore({
      oralViewer: { bytes: new Uint8Array([1]), durationSec: 5, loading: false },
    });
    render(<OralAnnotationsViewerView store={store} />);

    expect(screen.queryByTestId("oralann-cursor")).toBeNull(); // hidden while not playing

    fireEvent.click(screen.getByTestId("oralann-play"));
    const cursor = screen.getByTestId("oralann-cursor") as HTMLElement;
    // At position 0 the cursor should sit exactly at the label column's width
    // (the row label is 90px — see LABEL_WIDTH), i.e. the canvas' own left
    // edge, not at 0 (which would be over the labels).
    expect(cursor.style.left).toBe("90px");
  });

  it("shows the error message when the viewer failed to load", () => {
    render(
      <OralAnnotationsViewerView
        store={fakeStore({
          oralViewer: { bytes: undefined, durationSec: 0, loading: false, error: "disk error" },
        })}
      />,
    );
    expect(screen.getByText("disk error")).toBeTruthy();
  });
});
