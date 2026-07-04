import { describe, it, expect } from "vitest";
import { AnnotationDocumentStore } from "../state/AnnotationDocumentStore";
import { buildAutoSegmentedEafXml } from "../audio/autoSegmentToEaf";
import { loadEaf } from "../model/eaf/EafDocument";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { annotationsEafName } from "../fs/SessionFolder";

/**
 * The grid↔eaf editing round-trip that {@link HarnessStore.saveCell} performs:
 * edit a Transcription / Free Translation cell → persist to the eaf → reload →
 * the text is there, and any foreign tier survived the DOM-preserving save.
 */
const MEDIA = "m.wav";

/** A 2-segment eaf plus a foreign (non-SayMore) "Notes" tier to guard survival. */
function sampleEafWithForeignTier(): string {
  const base = buildAutoSegmentedEafXml(MEDIA, [1, 2]);
  return base.replace(
    "</ANNOTATION_DOCUMENT>",
    `  <TIER LINGUISTIC_TYPE_REF="note" TIER_ID="Notes">
    <ANNOTATION>
      <REF_ANNOTATION ANNOTATION_ID="a99" ANNOTATION_REF="a1">
        <ANNOTATION_VALUE>keep-me</ANNOTATION_VALUE>
      </REF_ANNOTATION>
    </ANNOTATION>
  </TIER>
</ANNOTATION_DOCUMENT>`,
  );
}

describe("harness grid ↔ eaf editing", () => {
  it("persists Transcription and Free Translation edits back to the eaf", async () => {
    const adapter = new InMemoryAdapter();
    const eafRel = annotationsEafName(MEDIA);
    adapter.seed(eafRel, sampleEafWithForeignTier());

    const doc = new AnnotationDocumentStore();
    doc.init(MEDIA, 2, await adapter.readText(eafRel));
    expect(doc.segments.length).toBe(2);

    // What saveCell does:
    doc.tiers.setTranscription(0, "fly the pollinators");
    doc.tiers.setFreeTranslation(0, "les pollinisateurs");
    doc.bumpVersion();
    await doc.save(adapter);

    // Reload from disk → edits persisted.
    const reloaded = loadEaf(await adapter.readText(eafRel));
    expect(reloaded.segments[0].transcription).toBe("fly the pollinators");
    expect(reloaded.segments[0].freeTranslation).toBe("les pollinisateurs");
    expect(reloaded.segments[1].transcription).toBe("");
  });

  it("preserves foreign tiers through the save", async () => {
    const adapter = new InMemoryAdapter();
    const eafRel = annotationsEafName(MEDIA);
    adapter.seed(eafRel, sampleEafWithForeignTier());

    const doc = new AnnotationDocumentStore();
    doc.init(MEDIA, 2, await adapter.readText(eafRel));
    doc.tiers.setTranscription(1, "second");
    doc.bumpVersion();
    await doc.save(adapter);

    const xml = await adapter.readText(eafRel);
    expect(xml).toContain('TIER_ID="Notes"');
    expect(xml).toContain("keep-me");
  });
});
