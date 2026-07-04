import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryAdapter } from "../../fs/InMemoryAdapter";
import {
  OralAnnotationIndex,
  oralAnnotationsFolderName,
  segmentWavName,
} from "../../fs/OralAnnotationFiles";
import { SpyPlaybackEngine } from "../../audio/PlaybackEngine";
import { SpyRecorder } from "../../audio/recording/Recorder";
import { AnnotationDocumentStore } from "../AnnotationDocumentStore";
import { buildAutoSegmentedEafXml } from "../../audio/autoSegmentToEaf";
import { RecordingFileStore } from "./RecordingFileStore";
import { RecorderViewModel } from "./RecorderViewModel";

const MEDIA = "longerSound.wav";
const FOLDER = oralAnnotationsFolderName(MEDIA);
const DURATION = 10;

// Three contiguous segments plus unsegmented remainder up to DURATION.
const SEGMENTS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
];

/** Identity encoder: the WAV "bytes" are just the sample bytes, for easy assertions. */
function idEncoder(samples: Float32Array): Uint8Array {
  return new Uint8Array(samples.buffer.slice(0));
}

function samplesOfMs(ms: number, sampleRate = 48000): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * sampleRate));
}

async function makeVm(opts?: {
  seedCareful?: Array<[number, number]>;
  ignored?: number[];
}): Promise<{
  vm: RecorderViewModel;
  adapter: InMemoryAdapter;
  playback: SpyPlaybackEngine;
  annotationPlayback: SpyPlaybackEngine;
  recorder: SpyRecorder;
  store: RecordingFileStore;
  document: AnnotationDocumentStore;
  revokedUrls: string[];
}> {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array([1]));
  for (const [s, e] of opts?.seedCareful ?? []) {
    adapter.seed(`${FOLDER}/${s}_to_${e}_Careful.wav`, new Uint8Array([7]));
  }

  const eaf = buildAutoSegmentedEafXml(
    MEDIA,
    SEGMENTS.map(([, end]) => end),
  );
  const document = new AnnotationDocumentStore();
  document.init(MEDIA, DURATION, eaf);
  for (const i of opts?.ignored ?? []) document.tiers.setIgnored(i, true);

  const oralIndex = await OralAnnotationIndex.build(adapter, MEDIA);
  const store = await RecordingFileStore.build(adapter, oralIndex, MEDIA);
  const playback = new SpyPlaybackEngine();
  const annotationPlayback = new SpyPlaybackEngine();
  const recorder = new SpyRecorder();
  await recorder.open();

  let urlSeq = 0;
  const revokedUrls: string[] = [];

  const vm = new RecorderViewModel({
    kind: "Careful",
    document,
    playback,
    recorder,
    store,
    adapter,
    encodeWav: idEncoder,
    annotationPlayback,
    clipUrlFactory: () => `blob:clip-${urlSeq++}`,
    revokeClipUrl: (u) => revokedUrls.push(u),
  });
  return { vm, adapter, playback, annotationPlayback, recorder, store, document, revokedUrls };
}

/** Simulate a full press-and-hold Listen that plays the current segment to its end. */
function listenToCompletion(vm: RecorderViewModel, playback: SpyPlaybackEngine): void {
  const end = vm.currentRange.end;
  vm.listenDown();
  playback.positionSec = end; // playback reached the segment end
  vm.listenUp();
}

describe("RecorderViewModel — current segment", () => {
  it("starts on the first non-ignored, unannotated segment", async () => {
    const { vm } = await makeVm();
    expect(vm.currentIndex).toBe(0);
    expect(vm.mode).toBe("Listen");
  });

  it("skips already-annotated and ignored segments", async () => {
    const { vm } = await makeVm({ seedCareful: [[0, 1]], ignored: [1] });
    expect(vm.currentIndex).toBe(2);
  });

  it("goes to the new-segment slot when all real segments are done", async () => {
    const { vm } = await makeVm({
      seedCareful: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    });
    expect(vm.currentIndex).toBe("new");
    // not fully segmented (remainder to 10s) => still Listen, not Done
    expect(vm.mode).toBe("Listen");
  });
});

describe("RecorderViewModel — listen gate", () => {
  it("does not arm record until the source is heard to completion", async () => {
    const { vm, playback } = await makeVm();
    vm.listenDown();
    playback.positionSec = 0.4; // released early
    vm.listenUp();
    expect(vm.hasListenedToCurrent).toBe(false);
    expect(vm.recordEnabled).toBe(false);
    expect(vm.mode).toBe("Listen");
  });

  it("arms record after hearing the whole segment", async () => {
    const { vm, playback } = await makeVm();
    listenToCompletion(vm, playback);
    expect(vm.hasListenedToCurrent).toBe(true);
    expect(vm.recordEnabled).toBe(true);
    expect(vm.mode).toBe("Record");
  });

  it("resets the gate when advancing to the next segment", async () => {
    const { vm, playback, recorder } = await makeVm();
    listenToCompletion(vm, playback);
    recorder.setNextRecording(samplesOfMs(700));
    vm.speakDown();
    await vm.speakUp();
    expect(vm.currentIndex).toBe(1);
    expect(vm.hasListenedToCurrent).toBe(false);
    expect(vm.mode).toBe("Listen");
  });
});

describe("RecorderViewModel — push to talk", () => {
  it("records, writes the clip, and advances on a long-enough take", async () => {
    const { vm, playback, recorder, store, adapter } = await makeVm();
    listenToCompletion(vm, playback);
    const samples = samplesOfMs(700);
    recorder.setNextRecording(samples);

    vm.speakDown();
    expect(vm.isRecording).toBe(true);
    expect(recorder.calls).toContain("beginRecording");
    await vm.speakUp();

    expect(vm.isRecording).toBe(false);
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(true);
    expect(store.get({ start: 0, end: 1 }, "Careful")).toEqual(idEncoder(samples));
    await store.whenSettled();
    expect(await adapter.exists(segmentWavName(MEDIA, { start: 0, end: 1 }, "Careful"))).toBe(true);
    expect(vm.currentIndex).toBe(1);
  });

  it("discards a too-short take with a warning and does not advance", async () => {
    const { vm, playback, recorder, store } = await makeVm();
    listenToCompletion(vm, playback);
    recorder.setNextRecording(samplesOfMs(200)); // < 460ms

    vm.speakDown();
    await vm.speakUp();

    expect(vm.warning).toBe(
      "Whoops. You need to hold down the SPACE BAR or mouse button while talking.",
    );
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(false);
    expect(vm.currentIndex).toBe(0); // no advance
  });

  it("undo removes the just-recorded clip and restores the current segment", async () => {
    const { vm, playback, recorder, store } = await makeVm();
    listenToCompletion(vm, playback);
    recorder.setNextRecording(samplesOfMs(700));
    vm.speakDown();
    await vm.speakUp();
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(true);

    vm.undo();
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(false);
    expect(vm.currentIndex).toBe(0);
  });
});

describe("RecorderViewModel — new segment", () => {
  async function allRealDone(): Promise<Awaited<ReturnType<typeof makeVm>>> {
    return makeVm({
      seedCareful: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    });
  }

  it("listening extends the virtual boundary into the remainder", async () => {
    const { vm, playback } = await allRealDone();
    expect(vm.currentIndex).toBe("new");
    vm.listenDown();
    playback.positionSec = 3.8; // heard into the remainder
    vm.listenUp();
    expect(vm.newSegmentEndSec).toBeCloseTo(3.8, 5);
    expect(vm.mode).toBe("Record");
  });

  it("nudge/drag clamp the boundary to >=460ms past the last segment and <= media end", async () => {
    const { vm } = await allRealDone();
    vm.selectSegment("new");
    vm.dragNewBoundaryTo(3.1); // only 100ms past last segment
    expect(vm.newSegmentEndSec).toBeCloseTo(3.46, 5); // clamped up to 460ms
    vm.dragNewBoundaryTo(999);
    expect(vm.newSegmentEndSec).toBeCloseTo(DURATION, 5); // clamped to media end
  });

  it("recording the remainder inserts the boundary and writes as one undo step", async () => {
    const { vm, playback, recorder, store, document } = await allRealDone();
    vm.listenDown();
    playback.positionSec = 4;
    vm.listenUp();
    recorder.setNextRecording(samplesOfMs(1000));
    vm.speakDown();
    await vm.speakUp();

    expect(document.tiers.segments.map((s) => s.range.end)).toEqual([1, 2, 3, 4]);
    expect(store.has({ start: 3, end: 4 }, "Careful")).toBe(true);

    vm.undo();
    expect(document.tiers.segments.map((s) => s.range.end)).toEqual([1, 2, 3]);
    expect(store.has({ start: 3, end: 4 }, "Careful")).toBe(false);
  });
});

describe("RecorderViewModel — per-cell playback / erase / re-record", () => {
  it("playSourceOf plays the segment's source range", async () => {
    const { vm, playback } = await makeVm();
    vm.playSourceOf(1);
    const call = playback.calls.at(-1);
    expect(call?.kind).toBe("play");
    expect(call?.range).toEqual({ start: 1, end: 2 });
  });

  it("playAnnotation plays the recorded clip via a blob URL", async () => {
    const { vm, annotationPlayback } = await makeVm({ seedCareful: [[0, 1]] });
    vm.playAnnotation(0);
    const call = annotationPlayback.calls.at(-1);
    expect(call?.kind).toBe("playSequence");
    expect(call?.sources?.[0].url).toBe("blob:clip-0");
  });

  it("playAnnotation is a no-op for an unrecorded segment", async () => {
    const { vm, annotationPlayback } = await makeVm();
    vm.playAnnotation(0);
    expect(annotationPlayback.calls).toHaveLength(0);
  });

  it("erase removes the clip (undoable) and makes that segment current", async () => {
    const { vm, store } = await makeVm({ seedCareful: [[0, 1]] });
    expect(vm.currentIndex).toBe(1); // 0 already annotated at start
    vm.eraseAnnotation(0);
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(false);
    expect(vm.currentIndex).toBe(0);
    vm.undo();
    expect(store.has({ start: 0, end: 1 }, "Careful")).toBe(true);
  });

  it("re-record overwrites the clip without advancing; undo restores the backup", async () => {
    const { vm, recorder, store } = await makeVm({ seedCareful: [[0, 1]] });
    const original = store.get({ start: 0, end: 1 }, "Careful");
    const replacement = samplesOfMs(700);
    recorder.setNextRecording(replacement);

    vm.reRecordDown(0);
    expect(vm.isRecording).toBe(true);
    expect(vm.currentIndex).toBe(0);
    await vm.reRecordUp(0);

    expect(vm.currentIndex).toBe(0); // no advance on re-record
    expect(store.get({ start: 0, end: 1 }, "Careful")).toEqual(idEncoder(replacement));
    vm.undo();
    expect(store.get({ start: 0, end: 1 }, "Careful")).toEqual(original);
  });

  it("too-short re-record keeps the backup and warns", async () => {
    const { vm, recorder, store } = await makeVm({ seedCareful: [[0, 1]] });
    const original = store.get({ start: 0, end: 1 }, "Careful");
    recorder.setNextRecording(samplesOfMs(200));

    vm.reRecordDown(0);
    await vm.reRecordUp(0);

    expect(vm.warning).toContain("Whoops");
    expect(store.get({ start: 0, end: 1 }, "Careful")).toEqual(original);
  });

  it("revokes the clip blob URL on dispose", async () => {
    const { vm, revokedUrls } = await makeVm({ seedCareful: [[0, 1]] });
    vm.playAnnotation(0);
    vm.dispose();
    expect(revokedUrls).toContain("blob:clip-0");
  });
});

describe("RecorderViewModel — error / recovery", () => {
  let vm: RecorderViewModel;
  let recorder: SpyRecorder;
  let playback: SpyPlaybackEngine;
  beforeEach(async () => {
    ({ vm, recorder, playback } = await makeVm());
  });
  afterEach(() => vm.dispose()); // clears the device-check poll timer

  it("enters Error mode when the device errors mid-take", () => {
    recorder.emitError();
    expect(vm.mode).toBe("Error");
    expect(vm.isRecording).toBe(false);
  });

  it("recovers to Listen when the device returns", async () => {
    recorder.emitError();
    recorder.recover();
    await vm.retryDevice();
    expect(vm.mode).toBe("Listen");
  });

  it("recovers to Record when the current segment was already heard", async () => {
    listenToCompletion(vm, playback);
    expect(vm.mode).toBe("Record");
    recorder.emitError();
    expect(vm.mode).toBe("Error");
    recorder.recover();
    await vm.retryDevice();
    expect(vm.mode).toBe("Record");
  });

  it("stays in Error while the device is still unavailable", async () => {
    recorder.emitError();
    await vm.retryDevice(); // not recovered yet
    expect(vm.mode).toBe("Error");
  });
});

describe("RecorderViewModel — done mode", () => {
  it("is Done when every segment is annotated and fully segmented", async () => {
    // Media exactly 3s so [0,3] is fully segmented once all three are recorded.
    const adapter = new InMemoryAdapter();
    adapter.seed(MEDIA, new Uint8Array([1]));
    for (const [s, e] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as Array<[number, number]>) {
      adapter.seed(`${FOLDER}/${s}_to_${e}_Careful.wav`, new Uint8Array([7]));
    }
    const document = new AnnotationDocumentStore();
    document.init(MEDIA, 3, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3]));
    const oralIndex = await OralAnnotationIndex.build(adapter, MEDIA);
    const store = await RecordingFileStore.build(adapter, oralIndex, MEDIA);
    const recorder = new SpyRecorder();
    await recorder.open();
    const vm = new RecorderViewModel({
      kind: "Careful",
      document,
      playback: new SpyPlaybackEngine(),
      recorder,
      store,
      annotationPlayback: new SpyPlaybackEngine(),
      clipUrlFactory: () => "blob:x",
      revokeClipUrl: () => {},
    });
    expect(vm.currentIndex).toBe("new");
    expect(vm.mode).toBe("Done");
  });
});
