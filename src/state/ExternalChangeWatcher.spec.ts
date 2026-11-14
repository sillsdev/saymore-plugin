import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { annotationsEafName } from "../fs/SessionFolder";
import { SpyPlaybackEngine } from "../audio/PlaybackEngine";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { SegmenterViewModel } from "./SegmenterViewModel";
import { ExternalChangeWatcher, EXTERNAL_POLL_MS } from "./ExternalChangeWatcher";

const MEDIA = "m.wav";
const EAF = annotationsEafName(MEDIA);

/** The text of an `.eaf` with segments ending at each of `ends` seconds. */
function eafWith(ends: number[]): string {
  const doc = new AnnotationDocumentStore();
  doc.init(MEDIA, 10, undefined);
  for (const e of ends) doc.tiers.insertBoundary(e);
  return doc.serialize();
}

async function setup(opts: { useAdapterWatch?: boolean } = {}) {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array([1]));
  adapter.seed(EAF, eafWith([1]));
  const document = new AnnotationDocumentStore();
  document.init(MEDIA, 10, await adapter.readText(EAF));
  const oralIndex = await OralAnnotationIndex.build(adapter, MEDIA);
  const segmenter = new SegmenterViewModel({
    document,
    playback: new SpyPlaybackEngine(),
    adapter,
    oralIndex,
  });
  const watcher = new ExternalChangeWatcher({
    adapter,
    document,
    segmenter,
    useAdapterWatch: opts.useAdapterWatch ?? false,
  });
  await vi.advanceTimersByTimeAsync(0);
  return { adapter, document, segmenter, watcher };
}

async function poll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(EXTERNAL_POLL_MS);
}

describe("ExternalChangeWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads silently when the file changes behind a clean document", async () => {
    const { adapter, document, watcher, segmenter } = await setup();
    const versionBefore = document.version;
    await adapter.writeText(EAF, eafWith([1, 2, 3]));
    await poll();
    expect(document.segments.length).toBe(3);
    expect(document.isDirty).toBe(false);
    expect(document.version).toBeGreaterThan(versionBefore);
    expect(watcher.conflict).toBe(false);
    segmenter.dispose();
    watcher.dispose();
  });

  it("does not reload for the plugin's own writes", async () => {
    const { document, watcher, segmenter } = await setup();
    const reload = vi.spyOn(document, "reloadFrom");
    segmenter.setCursor(2);
    segmenter.addBoundaryAtCursor();
    await vi.advanceTimersByTimeAsync(1000); // autosave fires
    expect(document.isDirty).toBe(false);
    await poll();
    await poll();
    expect(reload).not.toHaveBeenCalled();
    expect(segmenter.segmentCount).toBe(2);
    expect(watcher.conflict).toBe(false);
    segmenter.dispose();
    watcher.dispose();
  });

  it("raises a conflict instead of reloading when edits are unsaved, and holds the write", async () => {
    const { adapter, document, watcher, segmenter } = await setup();
    segmenter.setCursor(2);
    segmenter.addBoundaryAtCursor();
    expect(document.isDirty).toBe(true);
    const external = eafWith([1, 4]);
    await adapter.writeText(EAF, external);
    await watcher.check(); // a window-focus check lands inside the autosave debounce
    expect(watcher.conflict).toBe(true);
    expect(document.segments.length).toBe(2); // still the user's own edit
    await vi.advanceTimersByTimeAsync(2000); // the autosave timer passes
    expect(await adapter.readText(EAF)).toBe(external);
    segmenter.dispose();
    watcher.dispose();
  });

  it("Keep mine writes the user's edits over the file", async () => {
    const { adapter, document, watcher, segmenter } = await setup();
    segmenter.setCursor(2);
    segmenter.addBoundaryAtCursor();
    await adapter.writeText(EAF, eafWith([1, 4, 5]));
    await watcher.check();
    expect(watcher.conflict).toBe(true);
    await watcher.keepMine();
    expect(watcher.conflict).toBe(false);
    expect(document.isDirty).toBe(false);
    const written = new AnnotationDocumentStore();
    written.init(MEDIA, 10, await adapter.readText(EAF));
    expect(written.segments.map((s) => s.range.end)).toEqual([1, 2]);
    expect(document.segments.length).toBe(2);
    await poll();
    expect(watcher.conflict).toBe(false);
    segmenter.dispose();
    watcher.dispose();
  });

  it("Reload discards the user's edits and takes the file", async () => {
    const { adapter, document, watcher, segmenter } = await setup();
    segmenter.setCursor(2);
    segmenter.addBoundaryAtCursor();
    const external = eafWith([1, 4, 5]);
    await adapter.writeText(EAF, external);
    await watcher.check();
    await watcher.reload();
    expect(watcher.conflict).toBe(false);
    expect(document.isDirty).toBe(false);
    expect(document.segments.length).toBe(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await adapter.readText(EAF)).toBe(external);
    expect(document.segments.length).toBe(3);
    segmenter.dispose();
    watcher.dispose();
  });

  it("undo after a reload cannot bring the old file back", async () => {
    const { adapter, document, watcher, segmenter } = await setup();
    segmenter.setCursor(2);
    segmenter.addBoundaryAtCursor();
    await vi.advanceTimersByTimeAsync(1000);
    expect(segmenter.canUndo).toBe(true);
    await adapter.writeText(EAF, eafWith([1, 6]));
    await poll();
    expect(segmenter.canUndo).toBe(false);
    expect(segmenter.canRedo).toBe(false);
    segmenter.undo();
    expect(document.segments.map((s) => s.range.end)).toEqual([1, 6]);
    segmenter.dispose();
    watcher.dispose();
  });

  it("keeps the selected boundary through a reload when it still exists", async () => {
    const { adapter, watcher, segmenter } = await setup();
    segmenter.selectedBoundaryIndex = 0;
    await adapter.writeText(EAF, eafWith([1, 2, 3]));
    await poll();
    expect(segmenter.selectedBoundaryIndex).toBe(0);
    segmenter.dispose();
    watcher.dispose();
  });

  it("reacts to adapter.watch without waiting for a poll", async () => {
    const { adapter, document, watcher, segmenter } = await setup({ useAdapterWatch: true });
    await adapter.writeText(EAF, eafWith([1, 2]));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.segments.length).toBe(2);
    segmenter.dispose();
    watcher.dispose();
  });
});
