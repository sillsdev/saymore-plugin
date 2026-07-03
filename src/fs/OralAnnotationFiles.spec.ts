import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "./InMemoryAdapter";
import { makeTimeRange } from "../model/TimeRange";
import {
  OralAnnotationIndex,
  coalesceFileOps,
  oralAnnotationsFolderName,
  segmentWavName,
  type FileOp
} from "./OralAnnotationFiles";

const MEDIA = "longerSound.wav";
const FOLDER = oralAnnotationsFolderName(MEDIA); // "longerSound.wav_Annotations"

function seededAdapter(): InMemoryAdapter {
  const a = new InMemoryAdapter();
  a.seed(MEDIA, new Uint8Array([1]));
  a.seed(`${FOLDER}/0.75_to_1.25_Careful.wav`, new Uint8Array([1]));
  a.seed(`${FOLDER}/1.25_to_2.121_Careful.wav`, new Uint8Array([2]));
  a.seed(`${FOLDER}/1.25_to_2.121_Translation.wav`, new Uint8Array([3]));
  return a;
}

describe("segment WAV naming", () => {
  it("builds SayMore-compatible relative paths", () => {
    expect(segmentWavName(MEDIA, makeTimeRange(0.75, 1.25), "Careful")).toBe(
      `${FOLDER}/0.75_to_1.25_Careful.wav`
    );
    expect(segmentWavName(MEDIA, makeTimeRange(1.25, 2.121), "Translation")).toBe(
      `${FOLDER}/1.25_to_2.121_Translation.wav`
    );
  });
});

describe("OralAnnotationIndex", () => {
  it("scans careful + translation files", async () => {
    const idx = await OralAnnotationIndex.build(seededAdapter(), MEDIA);
    expect(idx.count).toBe(3);
    expect(idx.hasAnyForRange(makeTimeRange(0.75, 1.25))).toBe(true);
    expect(idx.hasAnyForRange(makeTimeRange(1.25, 2.121))).toBe(true);
    expect(idx.hasAnyForRange(makeTimeRange(2.5, 3))).toBe(false);
  });

  it("computes rename ops when the shared 1.25 boundary moves, reusing the 2.121 token", async () => {
    const idx = await OralAnnotationIndex.build(seededAdapter(), MEDIA);
    const ops = idx.computeRenameOps(
      makeTimeRange(1.25, 2.121),
      makeTimeRange(1.4, 2.121)
    );
    expect(ops).toHaveLength(2); // careful + translation both renamed
    expect(ops).toContainEqual({
      kind: "rename",
      from: `${FOLDER}/1.25_to_2.121_Careful.wav`,
      to: `${FOLDER}/1.4_to_2.121_Careful.wav`
    });
    expect(ops).toContainEqual({
      kind: "rename",
      from: `${FOLDER}/1.25_to_2.121_Translation.wav`,
      to: `${FOLDER}/1.4_to_2.121_Translation.wav`
    });
  });

  it("applyOps mutates the adapter", async () => {
    const adapter = seededAdapter();
    const idx = await OralAnnotationIndex.build(adapter, MEDIA);
    await idx.applyOps(idx.computeDeleteOps(makeTimeRange(0.75, 1.25)));
    expect(await adapter.exists(`${FOLDER}/0.75_to_1.25_Careful.wav`)).toBe(false);
    expect(idx.count).toBe(2);
  });

  it("reads a segment's WAV bytes by kind", async () => {
    const idx = await OralAnnotationIndex.build(seededAdapter(), MEDIA);
    const bytes = await idx.readSegmentWav(makeTimeRange(1.25, 2.121), "Translation");
    expect(bytes).toEqual(new Uint8Array([3]));
    expect(await idx.readSegmentWav(makeTimeRange(9, 10), "Careful")).toBeUndefined();
  });

  it("tolerates comma-decimal filenames on read", async () => {
    const a = new InMemoryAdapter();
    a.seed(`${FOLDER}/1,25_to_2,121_Careful.wav`, new Uint8Array([9]));
    const idx = await OralAnnotationIndex.build(a, MEDIA);
    expect(idx.hasAnyForRange(makeTimeRange(1.25, 2.121))).toBe(true);
  });
});

describe("coalesceFileOps", () => {
  it("folds a rename chain a→b→c into a→c", () => {
    const ops: FileOp[] = [
      { kind: "rename", from: "a.wav", to: "b.wav" },
      { kind: "rename", from: "b.wav", to: "c.wav" }
    ];
    expect(coalesceFileOps(ops)).toEqual([{ kind: "rename", from: "a.wav", to: "c.wav" }]);
  });

  it("a later delete supersedes prior renames", () => {
    const ops: FileOp[] = [
      { kind: "rename", from: "a.wav", to: "b.wav" },
      { kind: "delete", name: "b.wav" }
    ];
    expect(coalesceFileOps(ops)).toEqual([{ kind: "delete", name: "a.wav" }]);
  });

  it("drops no-op round trips", () => {
    const ops: FileOp[] = [
      { kind: "rename", from: "a.wav", to: "b.wav" },
      { kind: "rename", from: "b.wav", to: "a.wav" }
    ];
    expect(coalesceFileOps(ops)).toEqual([]);
  });
});
