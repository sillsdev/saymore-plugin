import { describe, it, expect, vi } from "vitest";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { SpyPlaybackEngine } from "../audio/PlaybackEngine";
import { BoundaryResult } from "../model/BoundaryRules";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { SegmenterViewModel } from "./SegmenterViewModel";

function makeVm(opts: { withOral?: boolean } = {}) {
  const adapter = new InMemoryAdapter();
  adapter.seed("m.wav", new Uint8Array([1]));
  if (opts.withOral) {
    adapter.seed("m.wav_Annotations/0.75_to_1.25_Careful.wav", new Uint8Array([9]));
  }
  const document = new AnnotationDocumentStore();
  document.init("m.wav", 10, undefined); // template → empty segments, 10s media
  const playback = new SpyPlaybackEngine();
  return { adapter, document, playback };
}

describe("SegmenterViewModel edits + undo", () => {
  it("adds boundaries, tracks count/dirty, and undoes", async () => {
    const { document, playback, adapter } = makeVm();
    const oralIndex = await OralAnnotationIndex.build(adapter, "m.wav");
    const vm = new SegmenterViewModel({ document, playback, adapter, oralIndex });
    try {
      vm.setCursor(0.75);
      expect(vm.addBoundaryAtCursor()).toBe(BoundaryResult.Success);
      vm.setCursor(1.25);
      expect(vm.addBoundaryAtCursor()).toBe(BoundaryResult.Success);
      expect(vm.segmentCount).toBe(2);
      expect(vm.isDirty).toBe(true);
      vm.undo();
      expect(vm.segmentCount).toBe(1);
    } finally {
      vm.dispose();
    }
  });

  it("adds a boundary at the playhead while listening (not the stale cursor)", () => {
    const { document, playback } = makeVm();
    const vm = new SegmenterViewModel({ document, playback });
    try {
      // Listening: cursor still at 0, but the playhead has advanced.
      playback.isPlaying = true;
      playback.positionSec = 5;
      expect(vm.editPositionSec).toBe(5);
      expect(vm.addBoundaryAtCursor()).toBe(BoundaryResult.Success);
      expect(vm.boundaries).toEqual([5]);
      expect(vm.warning).toBeUndefined();
    } finally {
      vm.dispose();
    }
  });

  it("flashes the too-short warning on a rejected insert", () => {
    const { document, playback } = makeVm();
    const vm = new SegmenterViewModel({ document, playback });
    try {
      vm.setCursor(0.2); // < 460ms from 0
      expect(vm.addBoundaryAtCursor()).toBe(BoundaryResult.SegmentWillBeTooShort);
      expect(vm.warning).toBeTruthy();
      expect(vm.segmentCount).toBe(0);
    } finally {
      vm.dispose();
    }
  });

  it("toggles ignore through an undoable command", () => {
    const { document, playback } = makeVm();
    const vm = new SegmenterViewModel({ document, playback });
    try {
      vm.setCursor(2);
      vm.addBoundaryAtCursor(); // [0,2]
      vm.toggleIgnore(0);
      expect(vm.segments[0].transcription).toBe("%ignore%");
      vm.undo();
      expect(vm.segments[0].transcription).toBe("");
    } finally {
      vm.dispose();
    }
  });

  it("zoom steps by ±10 and clamps at 100%", () => {
    const { document, playback } = makeVm();
    const vm = new SegmenterViewModel({ document, playback });
    try {
      expect(vm.zoomPercent).toBe(100);
      vm.zoomIn();
      expect(vm.zoomPercent).toBe(110);
      expect(vm.minPxPerSec).toBeCloseTo(88, 5); // 80 * 1.1
      vm.zoomOut();
      vm.zoomOut();
      expect(vm.zoomPercent).toBe(100); // clamped, never below 100
    } finally {
      vm.dispose();
    }
  });
});

describe("SegmenterViewModel oral-file journal on save", () => {
  it("renames the adjacent _Careful.wav when its boundary moves, and writes the EAF", async () => {
    vi.useFakeTimers();
    const { document, playback, adapter } = makeVm({ withOral: true });
    const oralIndex = await OralAnnotationIndex.build(adapter, "m.wav");
    const vm = new SegmenterViewModel({ document, playback, adapter, oralIndex });
    try {
      // Build [0,0.75] [0.75,1.25] [1.25,5]
      vm.setCursor(0.75);
      vm.addBoundaryAtCursor();
      vm.setCursor(1.25);
      vm.addBoundaryAtCursor();
      vm.setCursor(5);
      vm.addBoundaryAtCursor();

      // Move the boundary at 1.25 (end of segment 1) to 1.4.
      vm.selectBoundaryAt(1.25);
      expect(vm.moveSelectedBoundaryTo(1.4)).toBe(BoundaryResult.Success);

      await vm.save();

      // The careful WAV followed the boundary; the EAF was written.
      expect(await adapter.exists("m.wav_Annotations/0.75_to_1.4_Careful.wav")).toBe(true);
      expect(await adapter.exists("m.wav_Annotations/0.75_to_1.25_Careful.wav")).toBe(false);
      expect(await adapter.exists("m.wav.annotations.eaf")).toBe(true);
      expect(vm.isDirty).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vm.dispose();
    }
  });
});
