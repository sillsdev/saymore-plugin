import { describe, it, expect } from "vitest";
import {
  segmentsFromBoundaries,
  buildAutoSegmentedEafXml,
  autoSegmentToEaf,
} from "./autoSegmentToEaf";
import { loadEaf } from "../model/eaf/EafDocument";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { annotationsEafName } from "../fs/SessionFolder";
import type { Envelope } from "./EnvelopeCache";

describe("segmentsFromBoundaries", () => {
  it("returns no segments for no boundaries", () => {
    expect(segmentsFromBoundaries([])).toEqual([]);
  });

  it("makes contiguous segments, first starting at 0, each empty", () => {
    const segs = segmentsFromBoundaries([2, 5, 10]);
    expect(segs.map((s) => [s.range.start, s.range.end])).toEqual([
      [0, 2],
      [2, 5],
      [5, 10],
    ]);
    expect(segs.every((s) => s.transcription === "" && s.freeTranslation === "")).toBe(true);
  });

  it("skips degenerate boundaries that don't advance", () => {
    const segs = segmentsFromBoundaries([2, 2, 1.5, 5]);
    expect(segs.map((s) => [s.range.start, s.range.end])).toEqual([
      [0, 2],
      [2, 5],
    ]);
  });
});

describe("buildAutoSegmentedEafXml", () => {
  it("writes SayMore-parity segments (integer-ms slots, empty transcription) that round-trip", () => {
    const xml = buildAutoSegmentedEafXml("X.wav", [1.234, 3, 7.5]);

    // Media descriptor points at the file by name only.
    expect(xml).toContain('MEDIA_URL="X.wav"');

    const doc = loadEaf(xml);
    expect(doc.segments.map((s) => [s.range.start, s.range.end])).toEqual([
      [0, 1.234],
      [1.234, 3],
      [3, 7.5],
    ]);
    // All transcription text empty.
    expect(doc.segments.every((s) => s.transcription === "" && s.freeTranslation === "")).toBe(
      true,
    );

    // Integer-ms TIME_VALUEs, ascending, excluding a spurious extra 0.
    const values = [...xml.matchAll(/TIME_VALUE="(\d+)"/g)].map((m) => Number(m[1]));
    expect(values).toEqual([0, 1234, 1234, 3000, 3000, 7500]);
    expect(values.every((v) => Number.isInteger(v))).toBe(true);
  });

  it("produces an empty (but valid) eaf for no boundaries", () => {
    const xml = buildAutoSegmentedEafXml("X.wav", []);
    expect(loadEaf(xml).segments).toEqual([]);
  });
});

describe("autoSegmentToEaf", () => {
  const fakeEnvelope: Envelope = {
    channels: [{ min: new Float32Array(1), max: new Float32Array(1) }],
    samplesPerMs: 1,
    sampleRate: 1000,
    durationSec: 8,
  };

  it("runs the segmenter and writes the eaf beside the media", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed("X.wav", new Uint8Array(0));

    const { eafRel, boundaries } = await autoSegmentToEaf({
      adapter,
      mediaFileName: "X.wav",
      envelope: fakeEnvelope,
      runSegmenter: async (_env, _settings, onProgress) => {
        onProgress?.(0.5);
        onProgress?.(1);
        return [2, 5, 8];
      },
    });

    expect(eafRel).toBe(annotationsEafName("X.wav"));
    expect(boundaries).toEqual([2, 5, 8]);
    expect(await adapter.exists(eafRel)).toBe(true);
    const doc = loadEaf(await adapter.readText(eafRel));
    expect(doc.segments.map((s) => s.range.end)).toEqual([2, 5, 8]);
  });

  it("does not clobber an existing eaf", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed("X.wav", new Uint8Array(0));
    const eafRel = annotationsEafName("X.wav");
    adapter.seed(eafRel, "<ANNOTATION_DOCUMENT/>");

    let ran = false;
    const { boundaries } = await autoSegmentToEaf({
      adapter,
      mediaFileName: "X.wav",
      envelope: fakeEnvelope,
      runSegmenter: async () => {
        ran = true;
        return [2, 5, 8];
      },
    });

    expect(ran).toBe(false);
    expect(boundaries).toEqual([]);
    expect(await adapter.readText(eafRel)).toBe("<ANNOTATION_DOCUMENT/>");
  });
});
