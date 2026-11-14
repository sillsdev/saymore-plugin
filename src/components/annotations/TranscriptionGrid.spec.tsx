// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { makeObservable, observable, runInAction } from "mobx";
import { SpyPlaybackEngine } from "../../audio/PlaybackEngine";
import { InMemoryAdapter } from "../../fs/InMemoryAdapter";
import { IGNORE_MARKER } from "../../model/IgnoreMarkers";
import { makeTimeRange } from "../../model/TimeRange";
import { AnnotationDocumentStore } from "../../state/AnnotationDocumentStore";
import { gridPreferences } from "../../state/GridPreferences";
import { gridFonts, type SettingsStorage } from "../../state/GridFonts";
import { AUTOPLAY_DELAY_MS } from "../../state/GridViewModel";
import type { ProjectStore } from "../../state/ProjectStore";
import { SegmenterViewModel } from "../../state/SegmenterViewModel";
import { TranscriptionGrid } from "./TranscriptionGrid";

function makeStore(rows: number, ignored: number[] = []) {
  const adapter = new InMemoryAdapter();
  const document = new AnnotationDocumentStore();
  document.init("m.wav", rows, undefined);
  document.tiers.replaceAll(
    Array.from({ length: rows }, (_, i) => ({
      range: makeTimeRange(i, i + 1),
      transcription: ignored.includes(i) ? IGNORE_MARKER : `t${i}`,
      freeTranslation: `f${i}`,
    })),
  );
  const playback = new SpyPlaybackEngine();
  const segmenter = new SegmenterViewModel({ document, playback, adapter });
  const store = { document, segmenter, oralIndex: undefined, adapter };
  return { store: store as unknown as ProjectStore, playback, document };
}

const cell = (row: number, column: "transcription" | "freeTranslation") =>
  globalThis.document.querySelector<HTMLElement>(`[data-grid-cell="${row}:${column}"]`)!;

describe("TranscriptionGrid", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows ignored rows as 'Ignored', greyed and without editable cells", () => {
    const { store } = makeStore(3, [1]);
    render(<TranscriptionGrid store={store} />);
    const row = screen.getByTestId("grid-row-1");
    expect(row.dataset.ignored).toBe("true");
    expect(within(row).queryAllByRole("textbox", { hidden: true })).toHaveLength(2);
    expect(row.querySelector("input")).toBeNull();
    expect(within(row).getAllByText("Ignored")).toHaveLength(2);
    expect(row.textContent).not.toContain(IGNORE_MARKER);
    expect(screen.getByTestId("grid-row-0").querySelector("input")).not.toBeNull();
  });

  it("renders only the rows near the scroll position for a long session", () => {
    const { store } = makeStore(2000);
    render(<TranscriptionGrid store={store} />);
    const rendered = globalThis.document.querySelectorAll('[data-testid^="grid-row-"]').length;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(100);
  });

  it("Tab from Free Translation moves to the next row's Transcription", () => {
    const { store } = makeStore(4);
    render(<TranscriptionGrid store={store} />);
    act(() => cell(0, "freeTranslation").focus());
    fireEvent.keyDown(cell(0, "freeTranslation"), { key: "Tab" });
    expect(globalThis.document.activeElement).toBe(cell(1, "transcription"));
    fireEvent.keyDown(cell(1, "transcription"), { key: "Tab", shiftKey: true });
    expect(globalThis.document.activeElement).toBe(cell(0, "freeTranslation"));
  });

  it("Down skips ignored rows", () => {
    const { store } = makeStore(5, [1, 2]);
    render(<TranscriptionGrid store={store} />);
    act(() => cell(0, "transcription").focus());
    fireEvent.keyDown(cell(0, "transcription"), { key: "ArrowDown" });
    expect(globalThis.document.activeElement).toBe(cell(3, "transcription"));
    fireEvent.keyDown(cell(3, "transcription"), { key: "ArrowUp" });
    expect(globalThis.document.activeElement).toBe(cell(0, "transcription"));
  });

  it("autoplays a focused row after 250ms, and F2 stops it", async () => {
    vi.useFakeTimers();
    const { store, playback } = makeStore(3);
    render(<TranscriptionGrid store={store} />);
    act(() => cell(2, "transcription").focus());
    await act(() => vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS));
    expect(playback.calls.filter((c) => c.kind === "play").map((c) => c.range)).toEqual([
      makeTimeRange(2, 3),
    ]);
    fireEvent.keyDown(cell(2, "transcription"), { key: "F2" });
    expect(playback.isPlaying).toBe(false);
  });

  it("the cell context menu's Ignored item toggles the row", () => {
    const { store, document } = makeStore(3);
    render(<TranscriptionGrid store={store} />);
    fireEvent.contextMenu(cell(1, "freeTranslation"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Ignored/ }));
    expect(document.segments[1].transcription).toBe(IGNORE_MARKER);
    expect(within(screen.getByTestId("grid-row-1")).getAllByText("Ignored")).toHaveLength(2);

    fireEvent.contextMenu(cell(1, "transcription"));
    const item = screen.getByRole("menuitemcheckbox", { name: /Ignored/ });
    expect(item.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item);
    expect(document.segments[1].transcription).toBe("");
  });

  it("the Transcription Options menu sets that column's playback", () => {
    const { store } = makeStore(2);
    render(<TranscriptionGrid store={store} />);
    fireEvent.click(screen.getByTestId("transcription-options"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Careful Speech/ }));
    expect(gridPreferences.transcriptionPlayback).toBe("careful");
    fireEvent.click(screen.getByTestId("translation-options"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Both/ }));
    expect(gridPreferences.translationPlayback).toBe("both");
    gridPreferences.setTranscriptionPlayback("source");
    gridPreferences.setTranslationPlayback("translation");
  });
});

/** The real engine's state is observable; the spy's is made so for the grid to follow it. */
function observePlayback(playback: SpyPlaybackEngine): SpyPlaybackEngine {
  return makeObservable(playback, {
    isPlaying: observable,
    isPaused: observable,
    positionSec: observable,
    clipUrl: observable,
  });
}

function memorySettings(): SettingsStorage {
  let value: unknown = null;
  return {
    read: async () => value,
    write: async (v) => {
      value = v;
    },
  };
}

describe("TranscriptionGrid: SayMore's first column", () => {
  afterEach(() => cleanup());

  it("draws the play button only on the current row", () => {
    const { store } = makeStore(3);
    render(<TranscriptionGrid store={store} />);
    expect(screen.getAllByTitle("Play this segment")).toHaveLength(1);
    expect(within(screen.getByTestId("grid-row-0")).getByTitle("Play this segment")).toBeTruthy();
    fireEvent.click(screen.getByTestId("segment-cell-2"));
    expect(screen.getAllByTitle("Play this segment")).toHaveLength(1);
    expect(within(screen.getByTestId("grid-row-2")).getByTitle("Play this segment")).toBeTruthy();
  });

  it("shows the segment's time range as the tooltip, with how to play on the current row", () => {
    const { store } = makeStore(3);
    render(<TranscriptionGrid store={store} />);
    expect(screen.getByTestId("segment-cell-1").getAttribute("title")).toBe("01.0 - 02.0");
    expect(screen.getByTestId("segment-cell-0").getAttribute("title")).toBe(
      "Segment range: 00.0 - 01.0\nPress F2 to Play/Pause",
    );
  });

  it("fills the current row's first cell as far as playback has got into the segment", async () => {
    const { store, playback } = makeStore(3);
    observePlayback(playback);
    render(<TranscriptionGrid store={store} />);
    fireEvent.click(screen.getByTestId("segment-cell-1"));
    expect(screen.queryByTestId("playback-progress")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Play this segment"));
    });
    expect(playback.isPlaying).toBe(true);
    const width = () =>
      within(screen.getByTestId("segment-cell-1")).getByTestId("playback-progress").style.width;
    act(() => runInAction(() => (playback.positionSec = 1.25)));
    expect(width()).toBe("25%");
    act(() => runInAction(() => (playback.positionSec = 1.75)));
    expect(width()).toBe("75%");

    // Paused playback keeps its fill; stopping removes it.
    act(() => playback.pause());
    expect(width()).toBe("75%");
    act(() => playback.stop());
    expect(screen.queryByTestId("playback-progress")).toBeNull();
  });
});

describe("TranscriptionGrid: column fonts", () => {
  afterEach(async () => {
    cleanup();
    await gridFonts.setFont("transcription", undefined);
    await gridFonts.setFont("freeTranslation", undefined);
  });

  it("applies each column's font to its cells", async () => {
    await gridFonts.useStorage(memorySettings());
    await gridFonts.setFont("transcription", { family: "Charis SIL", sizePt: 14, bold: true });
    const { store } = makeStore(2, [1]);
    render(<TranscriptionGrid store={store} />);
    const input = cell(0, "transcription") as HTMLInputElement;
    expect(input.style.fontFamily).toContain("Charis SIL");
    expect(input.style.fontSize).toBe("14pt");
    expect(input.style.fontWeight).toBe("700");
    expect(cell(1, "transcription").style.fontFamily).toContain("Charis SIL");
    expect(cell(0, "freeTranslation").style.fontFamily).toBe("");
  });

  it("Options > Fonts... sets the column's font and stores it with the project", async () => {
    const storage = memorySettings();
    await gridFonts.useStorage(storage);
    const { store } = makeStore(2);
    render(<TranscriptionGrid store={store} />);
    fireEvent.click(screen.getByTestId("translation-options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Fonts\.\.\./ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Font"), { target: { value: "Andika" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });
    expect(gridFonts.freeTranslation).toEqual({ family: "Andika", sizePt: 10 });
    expect(await storage.read()).toEqual({
      version: 1,
      freeTranslationFont: { family: "Andika", sizePt: 10 },
    });
    expect(cell(0, "freeTranslation").style.fontFamily).toContain("Andika");
  });
});
