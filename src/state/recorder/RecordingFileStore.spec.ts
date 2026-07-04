import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../fs/InMemoryAdapter";
import { makeTimeRange } from "../../model/TimeRange";
import {
  OralAnnotationIndex,
  oralAnnotationsFolderName,
  segmentWavName,
} from "../../fs/OralAnnotationFiles";
import { RecordingFileStore } from "./RecordingFileStore";

const MEDIA = "longerSound.wav";
const FOLDER = oralAnnotationsFolderName(MEDIA);
const R1 = makeTimeRange(0.75, 1.25);
const R2 = makeTimeRange(1.25, 2.121);

function seededAdapter(): InMemoryAdapter {
  const a = new InMemoryAdapter();
  a.seed(MEDIA, new Uint8Array([1]));
  a.seed(`${FOLDER}/0.75_to_1.25_Careful.wav`, new Uint8Array([10, 11]));
  return a;
}

async function build(adapter: InMemoryAdapter): Promise<{
  store: RecordingFileStore;
  index: OralAnnotationIndex;
}> {
  const index = await OralAnnotationIndex.build(adapter, MEDIA);
  const store = await RecordingFileStore.build(adapter, index, MEDIA);
  return { store, index };
}

describe("RecordingFileStore", () => {
  it("pre-warms the overlay from existing annotation WAVs", async () => {
    const { store } = await build(seededAdapter());
    expect(store.has(R1, "Careful")).toBe(true);
    expect(store.has(R1, "Translation")).toBe(false);
    expect(store.get(R1, "Careful")).toEqual(new Uint8Array([10, 11]));
    expect(store.hasAny(R2)).toBe(false);
  });

  it("canonicalizes comma-decimal disk names on pre-warm", async () => {
    const a = new InMemoryAdapter();
    a.seed(MEDIA, new Uint8Array([1]));
    a.seed(`${FOLDER}/1,25_to_2,121_Careful.wav`, new Uint8Array([9]));
    const { store } = await build(a);
    expect(store.has(R2, "Careful")).toBe(true);
    expect(store.get(R2, "Careful")).toEqual(new Uint8Array([9]));
  });

  it("write: overlay updates synchronously, disk + index catch up after settle", async () => {
    const adapter = seededAdapter();
    const { store, index } = await build(adapter);
    const bytes = new Uint8Array([20, 21, 22]);

    const mutation = store.writeRecording(R2, "Careful", bytes);
    mutation.apply();

    // Synchronous: overlay is truth immediately.
    expect(store.get(R2, "Careful")).toEqual(bytes);
    // Disk not necessarily written yet, but settles to the same bytes + refreshes index.
    await store.whenSettled();
    const key = segmentWavName(MEDIA, R2, "Careful");
    expect(await adapter.readBytes(key)).toEqual(bytes);
    expect(index.hasAnyForRange(R2)).toBe(true);
  });

  it("revert of a fresh write removes the overlay entry and deletes the file", async () => {
    const adapter = seededAdapter();
    const { store, index } = await build(adapter);
    const key = segmentWavName(MEDIA, R2, "Careful");

    const mutation = store.writeRecording(R2, "Careful", new Uint8Array([5]));
    mutation.apply();
    await store.whenSettled();
    expect(await adapter.exists(key)).toBe(true);

    mutation.revert();
    expect(store.has(R2, "Careful")).toBe(false);
    await store.whenSettled();
    expect(await adapter.exists(key)).toBe(false);
    expect(index.hasAnyForRange(R2)).toBe(false);
  });

  it("re-record: revert restores the previous bytes (backup semantics)", async () => {
    const adapter = seededAdapter();
    const { store } = await build(adapter);
    const key = segmentWavName(MEDIA, R1, "Careful");
    const original = new Uint8Array([10, 11]);
    const replacement = new Uint8Array([99]);

    const mutation = store.writeRecording(R1, "Careful", replacement);
    mutation.apply();
    expect(store.get(R1, "Careful")).toEqual(replacement);
    await store.whenSettled();
    expect(await adapter.readBytes(key)).toEqual(replacement);

    mutation.revert();
    expect(store.get(R1, "Careful")).toEqual(original);
    await store.whenSettled();
    expect(await adapter.readBytes(key)).toEqual(original);
  });

  it("erase: apply deletes, revert restores prior bytes", async () => {
    const adapter = seededAdapter();
    const { store } = await build(adapter);
    const key = segmentWavName(MEDIA, R1, "Careful");

    const mutation = store.eraseRecording(R1, "Careful");
    mutation.apply();
    expect(store.has(R1, "Careful")).toBe(false);
    await store.whenSettled();
    expect(await adapter.exists(key)).toBe(false);

    mutation.revert();
    expect(store.get(R1, "Careful")).toEqual(new Uint8Array([10, 11]));
    await store.whenSettled();
    expect(await adapter.readBytes(key)).toEqual(new Uint8Array([10, 11]));
  });

  it("serializes a write→undo→re-record burst to a consistent final disk state", async () => {
    const adapter = seededAdapter();
    const { store } = await build(adapter);
    const key = segmentWavName(MEDIA, R2, "Careful");

    const first = store.writeRecording(R2, "Careful", new Uint8Array([1]));
    first.apply();
    first.revert(); // undo
    const second = store.writeRecording(R2, "Careful", new Uint8Array([2]));
    second.apply(); // re-record

    await store.whenSettled();
    expect(await adapter.readBytes(key)).toEqual(new Uint8Array([2]));
    expect(store.get(R2, "Careful")).toEqual(new Uint8Array([2]));
  });

  it("single-file mode (no adapter): overlay works, nothing persists, whenSettled resolves", async () => {
    const store = await RecordingFileStore.build(undefined, undefined, MEDIA);
    const mutation = store.writeRecording(R1, "Careful", new Uint8Array([7]));
    mutation.apply();
    expect(store.get(R1, "Careful")).toEqual(new Uint8Array([7]));
    await expect(store.whenSettled()).resolves.toBeUndefined();
  });
});
