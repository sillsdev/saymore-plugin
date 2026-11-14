// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SpyPlaybackEngine } from "../audio/PlaybackEngine";
import { SpyRecorder } from "../audio/recording/Recorder";
import { buildAutoSegmentedEafXml } from "../audio/autoSegmentToEaf";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { annotationsEafName } from "../fs/SessionFolder";
import { IGNORE_MARKER } from "../model/IgnoreMarkers";
import { testDataPath } from "../testData";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { GridPreferences } from "./GridPreferences";
import { GridViewModel } from "./GridViewModel";
import { ProjectStore } from "./ProjectStore";
import { SegmenterViewModel } from "./SegmenterViewModel";
import { RecordingFileStore } from "./recorder/RecordingFileStore";
import { RecorderViewModel } from "./recorder/RecorderViewModel";

const MEDIA = "m.wav";
const FOLDER = `${MEDIA}_Annotations`;

/** Segments [0,1] [1,2] [2,3] [3,4] with transcriptions t0..t3, over an optional seeded WAV. */
async function makeSession(opts: { seedCareful?: string } = {}) {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array([1]));
  if (opts.seedCareful) adapter.seed(`${FOLDER}/${opts.seedCareful}`, new Uint8Array([9]));
  const document = new AnnotationDocumentStore();
  document.init(MEDIA, 10, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3, 4]));
  document.segments.forEach((_, i) => document.tiers.setTranscription(i, `t${i}`));
  const oralIndex = await OralAnnotationIndex.build(adapter, MEDIA);
  const segmenter = new SegmenterViewModel({
    document,
    playback: new SpyPlaybackEngine(),
    adapter,
    oralIndex,
  });
  return { adapter, document, oralIndex, segmenter };
}

/** What the grid does when a cell's text is committed (TranscriptionGrid `saveCell`). */
function typeInGrid(document: AnnotationDocumentStore, row: number, text: string): void {
  document.tiers.setTranscription(row, text);
  document.bumpVersion();
}

async function makeRecorder(
  document: AnnotationDocumentStore,
  adapter: InMemoryAdapter,
  oralIndex: OralAnnotationIndex,
) {
  const store = await RecordingFileStore.build(adapter, oralIndex, MEDIA);
  const recorder = new SpyRecorder();
  await recorder.open();
  const playback = new SpyPlaybackEngine();
  const vm = new RecorderViewModel({
    kind: "Careful",
    document,
    playback,
    recorder,
    store,
    adapter,
    encodeWav: (samples) => new Uint8Array(samples.buffer.slice(0)),
    annotationPlayback: new SpyPlaybackEngine(),
    clipUrlFactory: () => "blob:clip",
    revokeClipUrl: () => {},
  });
  return { vm, recorder, playback, store };
}

describe("segmenter undo after text typed in the grid", () => {
  it("undoing a boundary edit keeps transcriptions typed in the grid afterwards", async () => {
    const { document, segmenter } = await makeSession();
    segmenter.selectBoundaryAt(2);
    segmenter.moveSelectedBoundaryTo(2.5);
    typeInGrid(document, 0, "typed in the grid");
    segmenter.undo();
    expect(document.segments[0].transcription).toBe("typed in the grid");
  });

  it("undoing a toggle-ignore keeps transcriptions typed in the grid afterwards", async () => {
    const { document, segmenter } = await makeSession();
    segmenter.toggleIgnore(3);
    typeInGrid(document, 1, "typed in the grid");
    segmenter.undo();
    expect(document.segments[1].transcription).toBe("typed in the grid");
  });

  it("undoing a boundary delete keeps text typed into the joined segment", async () => {
    const { document, segmenter } = await makeSession();
    segmenter.selectBoundaryAt(1);
    segmenter.deleteSelectedBoundary();
    typeInGrid(document, 0, "typed into the joined row");
    segmenter.undo();
    expect(document.segments.map((s) => s.transcription)).toContain("typed into the joined row");
  });

  it("offers no undo or redo once the text changed outside its history", async () => {
    const { document, segmenter } = await makeSession();
    segmenter.toggleIgnore(3);
    segmenter.toggleIgnore(2);
    segmenter.undo();
    expect(segmenter.canUndo).toBe(true);
    expect(segmenter.canRedo).toBe(true);
    typeInGrid(document, 0, "typed");
    expect(segmenter.canUndo).toBe(false);
    expect(segmenter.canRedo).toBe(false);
    segmenter.redo();
    expect(document.segments[2].transcription).toBe("t2");
    expect(document.segments[0].transcription).toBe("typed");
  });

  it("still undoes edits made after the grid typing, then stops at the typing", async () => {
    const { document, segmenter } = await makeSession();
    segmenter.toggleIgnore(3);
    typeInGrid(document, 0, "typed");
    segmenter.toggleIgnore(2);
    segmenter.undo();
    expect(document.segments[2].transcription).toBe("t2");
    expect(segmenter.canUndo).toBe(false);
    segmenter.undo();
    expect(document.segments[3].transcription).toBe(IGNORE_MARKER);
    expect(document.segments[0].transcription).toBe("typed");
  });
});

describe("grid ignore toggle on the segmenter's undo history", () => {
  it("undoing an un-ignore keeps the text typed into the row afterwards", async () => {
    const { adapter, document, oralIndex, segmenter } = await makeSession();
    document.tiers.setIgnored(1, true);
    const grid = new GridViewModel(
      { document, segmenter, oralIndex, adapter },
      new GridPreferences(undefined),
      () => "blob:clip",
    );
    grid.setIgnored(1, false);
    typeInGrid(document, 1, "typed after un-ignoring");
    segmenter.undo();
    expect(document.segments[1].transcription).toBe("typed after un-ignoring");
  });
});

describe("segmenter undo after recorder edits", () => {
  it("undoing a boundary edit keeps a segment that the recorder ignored afterwards", async () => {
    const { adapter, document, oralIndex, segmenter } = await makeSession();
    segmenter.selectBoundaryAt(2);
    segmenter.moveSelectedBoundaryTo(2.5);
    const { vm } = await makeRecorder(document, adapter, oralIndex);
    vm.toggleIgnore(0);
    vm.dispose();
    segmenter.undo();
    expect(document.segments[0].transcription).toBe(IGNORE_MARKER);
  });

  it("undoing a boundary edit keeps the segment that a recording at the remainder added", async () => {
    const { adapter, document, oralIndex, segmenter } = await makeSession();
    segmenter.selectBoundaryAt(2);
    segmenter.moveSelectedBoundaryTo(2.5);
    const { vm, recorder, playback } = await makeRecorder(document, adapter, oralIndex);
    vm.selectSegment("new");
    vm.listenDown();
    playback.positionSec = 6;
    vm.listenUp();
    recorder.setNextRecording(new Float32Array(48000));
    vm.speakDown();
    await vm.speakUp();
    expect(document.segments.map((s) => s.range.end)).toEqual([1, 2.5, 3, 4, 6]);
    vm.dispose();
    segmenter.undo();
    expect(document.segments.map((s) => s.range.end)).toEqual([1, 2.5, 3, 4, 6]);
  });
});

describe("recorder undo after the eaf is reloaded from disk", () => {
  it("undoing a toggle-ignore keeps the text that the reload brought in", async () => {
    const { adapter, document, oralIndex } = await makeSession();
    const { vm } = await makeRecorder(document, adapter, oralIndex);
    vm.toggleIgnore(3);
    const other = new AnnotationDocumentStore();
    other.init(MEDIA, 10, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3, 4]));
    other.tiers.setTranscription(0, "edited in another program");
    document.reloadFrom(other.serialize());
    vm.undo();
    expect(document.segments[0].transcription).toBe("edited in another program");
    vm.dispose();
  });
});

describe("oral-annotation WAVs stay consistent when undo history is dropped", () => {
  it("a flushed rename stays on disk after grid typing makes the history unusable", async () => {
    vi.useFakeTimers();
    const { document, segmenter, adapter } = await makeSession({
      seedCareful: "1_to_2_Careful.wav",
    });
    try {
      segmenter.selectBoundaryAt(2);
      segmenter.moveSelectedBoundaryTo(2.5);
      await vi.advanceTimersByTimeAsync(600);
      expect(await adapter.exists(`${FOLDER}/1_to_2.5_Careful.wav`)).toBe(true);

      typeInGrid(document, 0, "typed");
      segmenter.undo();
      await vi.advanceTimersByTimeAsync(600);
      expect(document.segments[1].range.end).toBe(2.5);
      expect(await adapter.exists(`${FOLDER}/1_to_2.5_Careful.wav`)).toBe(true);
      expect(await adapter.exists(`${FOLDER}/1_to_2_Careful.wav`)).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      segmenter.dispose();
    }
  });
});

describe("ProjectStore: opening a recorder ends the segmenter's undo history", () => {
  it("leaves the segmenter nothing to undo once a recorder opens", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed(
      "shortSound.wav",
      new Uint8Array(readFileSync(testDataPath("media", "shortSound.wav"))),
    );
    adapter.seed(
      annotationsEafName("shortSound.wav"),
      readFileSync(testDataPath("session", "longerSound.wav.annotations.eaf"), "utf8"),
    );
    const store = new ProjectStore();
    await store.openSession(adapter);
    const segmenter = store.segmenter!;
    store.showSegmenter();
    segmenter.toggleIgnore(0);
    expect(segmenter.canUndo).toBe(true);
    store.openRecorder("Careful");
    await vi.waitFor(() => expect(store.recorder).toBeDefined());
    expect(segmenter.canUndo).toBe(false);
  });
});
