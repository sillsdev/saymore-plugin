import { describe, expect, it } from "vitest";
import { loadEaf } from "../model/eaf/EafDocument";
import { importElanFile, isElanXml } from "./elanImport";

/** A file as ELAN itself writes it: its own linguistic types, a foreign tier, two media descriptors. */
const ELAN_AUTHORED = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="" DATE="2020-01-01T10:00:00+00:00" FORMAT="3.0" VERSION="3.0">
    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
        <MEDIA_DESCRIPTOR MEDIA_URL="file:///C:/old/place/story.mp4" MIME_TYPE="video/mp4"/>
        <MEDIA_DESCRIPTOR EXTRACTED_FROM="file:///C:/old/place/story.mp4" MEDIA_URL="file:///C:/old/place/story.wav" MIME_TYPE="audio/x-wav"/>
        <PROPERTY NAME="URN">urn:nl-mpi-tools-elan-eaf:abc</PROPERTY>
        <PROPERTY NAME="lastUsedAnnotationId">2</PROPERTY>
    </HEADER>
    <TIME_ORDER>
        <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="0"/>
        <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="1500"/>
        <TIME_SLOT TIME_SLOT_ID="ts3" TIME_VALUE="1500"/>
        <TIME_SLOT TIME_SLOT_ID="ts4" TIME_VALUE="4000"/>
    </TIME_ORDER>
    <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="Transcription">
        <ANNOTATION>
            <ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2">
                <ANNOTATION_VALUE>hello</ANNOTATION_VALUE>
            </ALIGNABLE_ANNOTATION>
        </ANNOTATION>
        <ANNOTATION>
            <ALIGNABLE_ANNOTATION ANNOTATION_ID="a2" TIME_SLOT_REF1="ts3" TIME_SLOT_REF2="ts4">
                <ANNOTATION_VALUE>world</ANNOTATION_VALUE>
            </ALIGNABLE_ANNOTATION>
        </ANNOTATION>
    </TIER>
    <TIER LINGUISTIC_TYPE_REF="default-lt" PARENT_REF="Transcription" TIER_ID="Phrase Free Translation">
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="a3" ANNOTATION_REF="a1">
                <ANNOTATION_VALUE>bonjour</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>
    </TIER>
    <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="Gloss">
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="a7" ANNOTATION_REF="a1">
                <ANNOTATION_VALUE>greeting</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>
    </TIER>
    <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
`;

/** An ELAN file whose tiers use the user's own names: nothing SayMore reads. */
const OWN_TIER_NAMES = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT FORMAT="2.7" VERSION="2.7">
  <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds"/>
  <TIME_ORDER>
    <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="0"/>
    <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="900"/>
  </TIME_ORDER>
  <TIER LINGUISTIC_TYPE_REF="word" TIER_ID="tx">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2">
        <ANNOTATION_VALUE>kia ora</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="word" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>`;

describe("isElanXml", () => {
  it("accepts an ELAN document", () => {
    expect(isElanXml(ELAN_AUTHORED)).toBe(true);
  });
  it("rejects an Audacity label file", () => {
    expect(isElanXml("0.000000\t1.500000\thello\n")).toBe(false);
  });
  it("rejects well-formed XML with another root", () => {
    expect(isElanXml("<html><body/></html>")).toBe(false);
  });
  it("rejects malformed XML", () => {
    expect(isElanXml("<ANNOTATION_DOCUMENT><HEADER></ANNOTATION_DOCUMENT>")).toBe(false);
  });
  it("rejects an empty file", () => {
    expect(isElanXml("")).toBe(false);
  });
});

describe("importElanFile", () => {
  it("keeps the segments and both SayMore tiers' text", () => {
    const doc = loadEaf(importElanFile(ELAN_AUTHORED, "story.wav"));
    expect(doc.segments.map((s) => [s.range.start, s.range.end, s.transcription])).toEqual([
      [0, 1.5, "hello"],
      [1.5, 4, "world"],
    ]);
    expect(doc.segments[0].freeTranslation).toBe("bonjour");
    expect(doc.segments[1].freeTranslation).toBe("");
  });

  it("replaces every media descriptor with one for the session media", () => {
    const out = importElanFile(ELAN_AUTHORED, "story.wav");
    const doc = loadEaf(out);
    expect(doc.media).toEqual({ mediaUrl: "story.wav", mimeType: "audio/x-wav" });
    expect(out).not.toContain("EXTRACTED_FROM");
    expect(out).not.toContain("C:/old");
    expect(out.match(/<MEDIA_DESCRIPTOR/g)).toHaveLength(1);
  });

  it("uses video/* for a video media file and mpeg for .mpg", () => {
    expect(importElanFile(ELAN_AUTHORED, "clip.mp4")).toContain('MIME_TYPE="video/*"');
    expect(importElanFile(ELAN_AUTHORED, "clip.mpg")).toContain('MIME_TYPE="video/mpeg"');
    expect(importElanFile(ELAN_AUTHORED, "clip.mp3")).toContain('MIME_TYPE="audio/*"');
  });

  it("keeps the descriptor ahead of the header's PROPERTY elements", () => {
    const out = importElanFile(ELAN_AUTHORED, "story.wav");
    expect(out.indexOf("MEDIA_DESCRIPTOR")).toBeLessThan(out.indexOf('NAME="URN"'));
  });

  it("sets lastUsedAnnotationId to the highest id on any tier, foreign tiers included", () => {
    const out = importElanFile(ELAN_AUTHORED, "story.wav");
    expect(out).toMatch(/<PROPERTY NAME="lastUsedAnnotationId">7<\/PROPERTY>/);
    expect(out.match(/lastUsedAnnotationId/g)).toHaveLength(1);
    expect(loadEaf(out).lastUsedAnnotationId).toBe(7);
  });

  it("creates lastUsedAnnotationId when the header has none", () => {
    expect(importElanFile(OWN_TIER_NAMES, "story.wav")).toMatch(
      /<PROPERTY NAME="lastUsedAnnotationId">1<\/PROPERTY>/,
    );
  });

  it("leaves foreign tiers, linguistic types and the other header properties untouched", () => {
    const out = importElanFile(ELAN_AUTHORED, "story.wav");
    expect(out).toContain('TIER_ID="Gloss"');
    expect(out).toContain("<ANNOTATION_VALUE>greeting</ANNOTATION_VALUE>");
    expect(out).toContain('LINGUISTIC_TYPE_ID="default-lt"');
    expect(out).toContain("urn:nl-mpi-tools-elan-eaf:abc");
    expect(out).toContain('FORMAT="3.0"');
    expect(out.match(/<TIER /g)).toHaveLength(3);
  });

  it("matches the SayMore tiers case-insensitively and adds nothing when both exist", () => {
    const upper = ELAN_AUTHORED.replace(
      'TIER_ID="Transcription"',
      'TIER_ID="TRANSCRIPTION"',
    ).replace('TIER_ID="Phrase Free Translation"', 'TIER_ID="phrase free translation"');
    const out = importElanFile(upper, "story.wav");
    expect(out.match(/<TIER /g)).toHaveLength(3);
    expect(loadEaf(out).segments).toHaveLength(2);
  });

  it("opens a file with differently named tiers as zero segments and adds the SayMore tiers", () => {
    const out = importElanFile(OWN_TIER_NAMES, "story.wav");
    const doc = loadEaf(out);
    expect(doc.segments).toEqual([]);
    expect(out).toContain('TIER_ID="tx"');
    expect(out).toContain("kia ora");
    expect(out).toMatch(/TIER_ID="Transcription"/);
    expect(out).toMatch(
      /PARENT_REF="Transcription" TIER_ID="Phrase Free Translation"|TIER_ID="Phrase Free Translation"/,
    );
    // The new tiers are usable: the tools can write segments into the imported file.
    expect(() =>
      doc.writeSegments([{ range: { start: 0, end: 1 }, transcription: "x", freeTranslation: "" }]),
    ).not.toThrow();
    expect(doc.segments).toHaveLength(1);
    // ...and the linguistic type those tiers name exists.
    expect(out).toContain('LINGUISTIC_TYPE_ID="Transcription"');
  });

  it("adds only the missing tier", () => {
    const onlyTranscription = ELAN_AUTHORED.replace(
      /<TIER LINGUISTIC_TYPE_REF="default-lt" PARENT_REF="Transcription" TIER_ID="Phrase Free Translation">[\s\S]*?<\/TIER>\s*/,
      "",
    );
    const out = importElanFile(onlyTranscription, "story.wav");
    expect(out.match(/TIER_ID="Phrase Free Translation"/g)).toHaveLength(1);
    expect(out.match(/TIER_ID="Transcription"/g)).toHaveLength(1);
    expect(loadEaf(out).segments).toHaveLength(2);
  });

  it("creates a header when the file has none", () => {
    const noHeader = OWN_TIER_NAMES.replace(/<HEADER[^>]*\/>/, "");
    const doc = loadEaf(importElanFile(noHeader, "story.wav"));
    expect(doc.media?.mediaUrl).toBe("story.wav");
  });

  it("keeps slots without a TIME_VALUE so they interpolate when read", () => {
    const regular = ELAN_AUTHORED.replace(
      '<TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="1500"/>',
      '<TIME_SLOT TIME_SLOT_ID="ts2"/>',
    ).replace(
      '<TIME_SLOT TIME_SLOT_ID="ts3" TIME_VALUE="1500"/>',
      '<TIME_SLOT TIME_SLOT_ID="ts3"/>',
    );
    const out = importElanFile(regular, "story.wav");
    expect(out).toContain('<TIME_SLOT TIME_SLOT_ID="ts2"/>');
    const segments = loadEaf(out).segments;
    // ts1=0, ts2 and ts3 interpolated between 0 and 4000.
    expect(segments[0].range).toEqual({ start: 0, end: 1.333 });
    expect(segments[1].range).toEqual({ start: 2.667, end: 4 });
  });

  it("writes UTF-8 whatever encoding the source declared, and keeps non-ASCII text", () => {
    const latin = OWN_TIER_NAMES.replace("UTF-8", "ISO-8859-1").replace("kia ora", "mā tātou");
    const out = importElanFile(latin, "story.wav");
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out.match(/<\?xml/g)).toHaveLength(1);
    expect(out).toContain("mā tātou");
  });

  it("throws for text that is not an ELAN file", () => {
    expect(() => importElanFile("0\t1\tx", "story.wav")).toThrow();
  });
});
