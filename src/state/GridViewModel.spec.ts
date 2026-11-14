import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpyPlaybackEngine } from "../audio/PlaybackEngine";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { IGNORE_MARKER } from "../model/IgnoreMarkers";
import { makeTimeRange } from "../model/TimeRange";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { GridPreferences } from "./GridPreferences";
import {
  AUTOPLAY_DELAY_MS,
  AUTOPLAY_MAX_LOOPS,
  GridViewModel,
  playbackParts,
  type GridHost,
} from "./GridViewModel";
import { SegmenterViewModel } from "./SegmenterViewModel";

/** Rows 0..n-1, one second each; `ignored` rows carry the ignore marker. */
async function makeGrid(opts: { rows?: number; ignored?: number[]; seed?: string[] } = {}) {
  const rows = opts.rows ?? 5;
  const adapter = new InMemoryAdapter();
  adapter.seed("m.wav", new Uint8Array([1]));
  for (const name of opts.seed ?? []) adapter.seed(name, new Uint8Array([7, 7]));
  const document = new AnnotationDocumentStore();
  document.init("m.wav", rows, undefined);
  document.tiers.replaceAll(
    Array.from({ length: rows }, (_, i) => ({
      range: makeTimeRange(i, i + 1),
      transcription: opts.ignored?.includes(i) ? IGNORE_MARKER : `t${i}`,
      freeTranslation: `f${i}`,
    })),
  );
  const playback = new SpyPlaybackEngine();
  const oralIndex = await OralAnnotationIndex.build(adapter, "m.wav");
  const segmenter = new SegmenterViewModel({ document, playback, adapter, oralIndex });
  const host: GridHost = { document, segmenter, oralIndex, adapter };
  const prefs = new GridPreferences(undefined);
  const urls: Uint8Array[] = [];
  const vm = new GridViewModel(host, prefs, (bytes) => {
    urls.push(bytes);
    return `blob:clip-${urls.length}`;
  });
  return { vm, playback, document, segmenter, prefs, adapter };
}

const plays = (p: SpyPlaybackEngine) =>
  p.calls.filter((c) => c.kind === "play" || c.kind === "playSequence");

describe("GridViewModel keyboard movement", () => {
  it("Tab goes Transcription → Free Translation → next row's Transcription", async () => {
    const { vm } = await makeGrid();
    expect(vm.tabTarget(0, "transcription", false)).toEqual({ row: 0, column: "freeTranslation" });
    expect(vm.tabTarget(0, "freeTranslation", false)).toEqual({ row: 1, column: "transcription" });
  });

  it("Shift+Tab goes back, wrapping to the previous row's Free Translation", async () => {
    const { vm } = await makeGrid();
    expect(vm.tabTarget(2, "freeTranslation", true)).toEqual({ row: 2, column: "transcription" });
    expect(vm.tabTarget(2, "transcription", true)).toEqual({ row: 1, column: "freeTranslation" });
  });

  it("Tab leaves the grid at its first and last text cells", async () => {
    const { vm } = await makeGrid({ rows: 3 });
    expect(vm.tabTarget(2, "freeTranslation", false)).toBeUndefined();
    expect(vm.tabTarget(0, "transcription", true)).toBeUndefined();
    expect(vm.tab(2, "freeTranslation", false)).toBe(false);
  });

  it("Tab does not skip ignored rows (SayMore only skips them with the arrow keys)", async () => {
    const { vm } = await makeGrid({ ignored: [1] });
    expect(vm.tabTarget(0, "freeTranslation", false)).toEqual({ row: 1, column: "transcription" });
  });

  it("Up/Down skip ignored rows and stay put when only ignored rows remain", async () => {
    const { vm } = await makeGrid({ rows: 6, ignored: [1, 2, 5] });
    expect(vm.verticalTarget(0, 1)).toBe(3);
    expect(vm.verticalTarget(3, -1)).toBe(0);
    expect(vm.verticalTarget(4, 1)).toBeUndefined();
    expect(vm.verticalTarget(0, -1)).toBeUndefined();
  });

  it("moving requests focus on the target cell, keeping the column", async () => {
    const { vm } = await makeGrid({ ignored: [1] });
    vm.moveVertical(0, "freeTranslation", 1);
    expect(vm.focusRequest).toMatchObject({ row: 2, column: "freeTranslation" });
    vm.tab(2, "freeTranslation", false);
    expect(vm.focusRequest).toMatchObject({ row: 3, column: "transcription" });
  });

  it("starts on the first row that is not ignored", async () => {
    const { vm } = await makeGrid({ ignored: [0, 1] });
    expect(vm.currentRow).toBe(2);
  });
});

describe("GridViewModel autoplay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays an entered row after 250ms, looping 5 times at the chosen speed", async () => {
    const { vm, playback, prefs } = await makeGrid();
    prefs.setSpeedPercent(60);
    vm.enterCell(2, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS - 1);
    expect(plays(playback)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(plays(playback)).toEqual([
      {
        kind: "play",
        range: makeTimeRange(2, 3),
        opts: { rate: 0.6, maxLoops: AUTOPLAY_MAX_LOOPS },
      },
    ]);
    expect(AUTOPLAY_MAX_LOOPS).toBe(5);
  });

  it("moving on before 250ms plays only the row the user settles on", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(100);
    vm.enterCell(2, "transcription");
    await vi.advanceTimersByTimeAsync(100);
    vm.enterCell(3, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    expect(plays(playback).map((c) => c.range)).toEqual([makeTimeRange(3, 4)]);
  });

  it("entering a cell stops what is playing", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    expect(playback.isPlaying).toBe(true);
    vm.enterCell(2, "freeTranslation");
    expect(playback.isPlaying).toBe(false);
  });

  it("does not autoplay an ignored row", async () => {
    const { vm, playback } = await makeGrid({ ignored: [1] });
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS * 4);
    expect(plays(playback)).toEqual([]);
  });

  it("focus leaving the grid cancels a pending autoplay", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    vm.leaveGrid();
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS * 2);
    expect(plays(playback)).toEqual([]);
  });

  it("F2 pauses playback and resumes it without restarting the row", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    vm.togglePlayback();
    expect(playback.isPlaying).toBe(false);
    expect(playback.isPaused).toBe(true);
    vm.togglePlayback();
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.isPlaying).toBe(true);
    expect(playback.isPaused).toBe(false);
    expect(plays(playback)).toHaveLength(1);
  });

  it("F2 plays the row from the start when nothing is playing or paused", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    vm.stop();
    vm.togglePlayback();
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.isPlaying).toBe(true);
    expect(plays(playback)).toHaveLength(2);
  });

  it("F2 before the autoplay delay ends plays at once, and moving rows after a pause stops the pause", async () => {
    const { vm, playback } = await makeGrid();
    vm.enterCell(1, "transcription");
    vm.togglePlayback();
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS * 2);
    expect(plays(playback)).toHaveLength(1);
    vm.togglePlayback();
    expect(playback.isPaused).toBe(true);
    vm.enterCell(2, "transcription");
    expect(playback.isPaused).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    expect(plays(playback)).toHaveLength(2);
  });

  it("a speed change reaches playback that is already running", async () => {
    const { vm, playback, prefs } = await makeGrid();
    const detach = vm.attach();
    prefs.setSpeedPercent(30);
    expect(playback.calls.at(-1)).toEqual({ kind: "setPlaybackRate", rate: 0.3 });
    detach();
  });

  it("the row play button plays that row now and stops it on a second click", async () => {
    const { vm, playback } = await makeGrid();
    vm.togglePlayRow(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.currentRow).toBe(3);
    expect(plays(playback).map((c) => c.range)).toEqual([makeTimeRange(3, 4)]);
    vm.togglePlayRow(3);
    expect(playback.isPlaying).toBe(false);
  });
});

describe("GridViewModel playback options", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("playbackParts follows SayMore's fallbacks", () => {
    const none = { careful: false, translation: false };
    const all = { careful: true, translation: true };
    expect(playbackParts("careful", all, "transcription")).toEqual(["Careful"]);
    expect(playbackParts("careful", none, "transcription")).toEqual(["source"]);
    expect(playbackParts("both", all, "transcription")).toEqual(["source", "Careful"]);
    expect(playbackParts("both", none, "transcription")).toEqual(["source"]);
    expect(playbackParts("translation", all, "freeTranslation")).toEqual(["Translation"]);
    expect(playbackParts("translation", none, "freeTranslation")).toEqual(["source"]);
    expect(playbackParts("both", all, "freeTranslation")).toEqual(["source", "Translation"]);
    expect(playbackParts("source", all, "freeTranslation")).toEqual(["source"]);
  });

  it("Both on the Transcription column plays the source then the Careful Speech WAV", async () => {
    const { vm, playback } = await makeGrid({ seed: ["m.wav_Annotations/1_to_2_Careful.wav"] });
    vm.setTranscriptionPlayback("both");
    playback.calls.length = 0;
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    const [call] = plays(playback);
    expect(call.kind).toBe("playSequence");
    expect(call.sources?.map((s) => s.url)).toEqual([undefined, "blob:clip-1"]);
    expect(call.sources?.[0].range).toEqual(makeTimeRange(1, 2));
    expect(call.opts).toEqual({ rate: 1, maxLoops: AUTOPLAY_MAX_LOOPS });
  });

  it("the Free Translation column defaults to the Oral Translation WAV, else the source", async () => {
    const { vm, playback } = await makeGrid({
      seed: ["m.wav_Annotations/2_to_3_Translation.wav"],
    });
    vm.enterCell(2, "freeTranslation");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    expect(plays(playback)[0].sources?.map((s) => s.url)).toEqual(["blob:clip-1"]);
    vm.enterCell(3, "freeTranslation");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    expect(plays(playback)[1]).toMatchObject({ kind: "play", range: makeTimeRange(3, 4) });
  });

  it("choosing an option plays the current row with it", async () => {
    const { vm, playback, prefs } = await makeGrid();
    vm.enterCell(1, "transcription");
    vm.setTranscriptionPlayback("careful");
    await vi.advanceTimersByTimeAsync(0);
    expect(prefs.transcriptionPlayback).toBe("careful");
    expect(plays(playback)[0]).toMatchObject({ kind: "play", range: makeTimeRange(1, 2) });
  });
});

describe("GridViewModel ignore toggle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignoring writes the marker, stops playback, and saves the eaf", async () => {
    const { vm, playback, document, adapter } = await makeGrid();
    vm.enterCell(1, "transcription");
    await vi.advanceTimersByTimeAsync(AUTOPLAY_DELAY_MS);
    vm.setIgnored(1, true);
    expect(document.segments[1].transcription).toBe(IGNORE_MARKER);
    expect(playback.isPlaying).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(await adapter.readText("m.wav.annotations.eaf")).toContain(IGNORE_MARKER);
  });

  it("is undone by the segmenter's Undo, restoring the earlier transcription", async () => {
    const { vm, document, segmenter } = await makeGrid();
    vm.setIgnored(2, true);
    expect(segmenter.canUndo).toBe(true);
    segmenter.undo();
    expect(document.segments[2].transcription).toBe("t2");
    segmenter.redo();
    expect(vm.isIgnored(2)).toBe(true);
  });

  it("un-ignoring clears the text and puts focus back in the row", async () => {
    const { vm, document } = await makeGrid({ ignored: [3] });
    vm.enterCell(3, "freeTranslation");
    vm.setIgnored(3, false);
    expect(document.segments[3].transcription).toBe("");
    expect(vm.focusRequest).toMatchObject({ row: 3, column: "freeTranslation" });
  });
});
