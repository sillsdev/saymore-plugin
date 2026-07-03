import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { testDataPath } from "../../testData";
import { eafTemplateXml } from "./eafTemplate";
import {
  loadEaf,
  serializeEaf,
  createEafFromTemplate,
  type EafDocument
} from "./EafDocument";

function read(...segments: string[]): string {
  return readFileSync(testDataPath(...segments), "utf8");
}

/** Transcription-tier ANNOTATION_IDs in document order. */
function transcriptionIds(doc: EafDocument): string[] {
  const ids: string[] = [];
  const list = doc.dom.getElementsByTagName("ALIGNABLE_ANNOTATION");
  for (let i = 0; i < list.length; i++) {
    const id = (list.item(i) as Element).getAttribute("ANNOTATION_ID");
    if (id) ids.push(id);
  }
  return ids;
}

describe("EafDocument round-trip of a real SayMore EAF", () => {
  it("preserves segments, out-of-order ids, id counter, and foreign tier", () => {
    const doc = loadEaf(read("real-eaf", "test.eaf"));

    expect(doc.media?.mediaUrl).toBe("AmazingGrace.wav");
    expect(doc.lastUsedAnnotationId).toBe(7);
    expect(transcriptionIds(doc)).toEqual(["a1", "a3", "a2"]);

    expect(doc.segments.map((s) => s.transcription)).toEqual([
      "Transcription1",
      "Transcription3",
      "Transcription2"
    ]);
    expect(doc.segments.map((s) => s.freeTranslation)).toEqual([
      "FreeTranslation1",
      "",
      "FreeTranslation2"
    ]);

    const serialized = serializeEaf(doc);
    // Foreign tier must survive verbatim in the output.
    expect(serialized).toContain('TIER_ID="User Defined Tier"');
    expect(serialized).toContain("UserAnnotationValue1");

    const reloaded = loadEaf(serialized);
    expect(reloaded.lastUsedAnnotationId).toBe(7);
    expect(transcriptionIds(reloaded)).toEqual(["a1", "a3", "a2"]);
    expect(reloaded.segments).toEqual(doc.segments);
    expect(reloaded.media?.mediaUrl).toBe("AmazingGrace.wav");
    // Foreign tier still present after reload.
    const tierIds = Array.from(
      { length: reloaded.dom.getElementsByTagName("TIER").length },
      (_v, i) =>
        (reloaded.dom.getElementsByTagName("TIER").item(i) as Element).getAttribute(
          "TIER_ID"
        )
    );
    expect(tierIds).toContain("User Defined Tier");
  });
});

describe("EafDocument %ignore% handling", () => {
  it("keeps %ignore% as transcription text with empty free-translation", () => {
    const doc = loadEaf(read("session", "longerSound.wav.annotations.eaf"));
    expect(doc.segments).toHaveLength(3);
    expect(doc.segments[2].transcription).toBe("%ignore%");
    expect(doc.segments[2].freeTranslation).toBe("");
  });
});

describe("EafDocument ELAN interpolation + foreign tier", () => {
  it("interpolates missing TIME_VALUEs and preserves the Notes tier", () => {
    const doc = loadEaf(read("elan-authored", "regular-annotations.eaf"));
    expect(doc.segments).toHaveLength(3);

    // ts1=0, ts4=4000 -> ts2=1333ms, ts3=2667ms (as seconds).
    expect(doc.segments[0].range.end).toBeCloseTo(1.333, 3);
    expect(doc.segments[1].range.start).toBeCloseTo(1.333, 3);
    expect(doc.segments[1].range.end).toBeCloseTo(2.667, 3);
    expect(doc.segments[2].range.start).toBeCloseTo(2.667, 3);

    const serialized = serializeEaf(doc);
    expect(serialized).toContain('TIER_ID="Notes"');

    const reloaded = loadEaf(serialized);
    expect(reloaded.segments[1].range.end).toBeCloseTo(2.667, 3);
    const notes = Array.from(
      { length: reloaded.dom.getElementsByTagName("TIER").length },
      (_v, i) =>
        (reloaded.dom.getElementsByTagName("TIER").item(i) as Element).getAttribute(
          "TIER_ID"
        )
    );
    expect(notes).toContain("Notes");
  });
});

describe("EafDocument createFromTemplate + writeSegments", () => {
  it("seeds media/mime, starts empty, then writes segments with a1/a2 ids", () => {
    const doc = createEafFromTemplate(eafTemplateXml, "X.wav");
    expect(doc.media?.mediaUrl).toBe("X.wav");
    expect(doc.media?.mimeType).toBe("audio/x-wav");
    expect(doc.segments).toHaveLength(0);

    doc.writeSegments([
      { range: { start: 0, end: 1.5 }, transcription: "hello", freeTranslation: "" },
      { range: { start: 1.5, end: 3.0 }, transcription: "world", freeTranslation: "" }
    ]);

    const reloaded = loadEaf(serializeEaf(doc));
    expect(reloaded.segments).toHaveLength(2);
    expect(transcriptionIds(reloaded)).toEqual(["a1", "a2"]);
    expect(reloaded.segments[0].transcription).toBe("hello");
    expect(reloaded.segments[1].transcription).toBe("world");
    expect(reloaded.segments[0].range.start).toBeCloseTo(0, 3);
    expect(reloaded.segments[0].range.end).toBeCloseTo(1.5, 3);
    expect(reloaded.segments[1].range.end).toBeCloseTo(3.0, 3);

    // Four distinct time slots (start+end per segment).
    const slotIds: string[] = [];
    const slots = reloaded.dom.getElementsByTagName("TIME_SLOT");
    for (let i = 0; i < slots.length; i++) {
      const id = (slots.item(i) as Element).getAttribute("TIME_SLOT_ID");
      if (id) slotIds.push(id);
    }
    expect(slotIds).toEqual(["ts1", "ts2", "ts3", "ts4"]);
  });

  it("emits a Phrase Free Translation ref only when translation is non-empty", () => {
    const doc = createEafFromTemplate(eafTemplateXml, "X.wav");
    doc.writeSegments([
      { range: { start: 0, end: 1 }, transcription: "a", freeTranslation: "AA" },
      { range: { start: 1, end: 2 }, transcription: "b", freeTranslation: "" }
    ]);
    const refs = doc.dom.getElementsByTagName("REF_ANNOTATION");
    expect(refs.length).toBe(1);
    expect((refs.item(0) as Element).getAttribute("ANNOTATION_REF")).toBe("a1");
  });
});

describe("EafDocument writeSegments id continuity", () => {
  it("continues the id counter (test.eaf lastUsed=7 -> first new id a8)", () => {
    const doc = loadEaf(read("real-eaf", "test.eaf"));
    expect(doc.lastUsedAnnotationId).toBe(7);

    const grown = [
      ...doc.segments,
      { range: { start: 3, end: 4 }, transcription: "new", freeTranslation: "" }
    ];
    doc.writeSegments(grown);

    // All annotations were re-allocated continuing from 7; first is a8.
    expect(transcriptionIds(doc)[0]).toBe("a8");
    expect(doc.lastUsedAnnotationId).toBeGreaterThanOrEqual(8);
    // Existing lower ids are never reused.
    expect(transcriptionIds(doc)).not.toContain("a1");
  });
});
