import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { loadEaf } from "../model/eaf/EafDocument";
import { parseAudacityLabels, segmentsFromAudacityLabels, splitLabelLines } from "./audacityLabels";
import { buildEafFromChosenFile, createEafFromChosenFile } from "./createFromFile";

const triples = (labels: { start: number; end: number; text: string | undefined }[]) =>
  labels.map((l) => [l.start, l.end, l.text]);

describe("parseAudacityLabels (ports of SayMore's AudacityLabelHelper cases)", () => {
  it("leaves ranges that start at zero as they are", () => {
    const labels = parseAudacityLabels(["0\t10\ta", "11\t20\tb", "21\t30\tc"], 40);
    expect(triples(labels)).toEqual([
      [0, 10, "a"],
      [11, 20, "b"],
      [21, 30, "c"],
    ]);
  });

  it("inserts an unlabelled segment from zero when the first label starts later", () => {
    const labels = parseAudacityLabels(["11\t20\ta", "21\t30\tb"], 40);
    expect(triples(labels)).toEqual([
      [0, 11, undefined],
      [11, 20, "a"],
      [21, 30, "b"],
    ]);
  });

  it("ends each point label where the next starts and the last at the media end", () => {
    const labels = parseAudacityLabels(["0\t0", "0.5\t0.5", "0.9\t0.9"], 1.45);
    expect(labels.map((l) => [l.start, l.end])).toEqual([
      [0, 0.5],
      [0.5, 0.9],
      [0.9, 1.45],
    ]);
  });

  it("treats a line with only a start time as a point label", () => {
    const labels = parseAudacityLabels(["1.5", "3"], 5);
    expect(labels.map((l) => [l.start, l.end])).toEqual([
      [0, 1.5],
      [1.5, 3],
      [3, 5],
    ]);
  });

  it("reads a start and an end with no text", () => {
    expect(triples(parseAudacityLabels(["4.123\t9.123"], 20))).toEqual([
      [0, 4.123, undefined],
      [4.123, 9.123, undefined],
    ]);
  });

  it("drops a final point label that starts exactly at the end of the media", () => {
    const labels = parseAudacityLabels(["0\t1\ta", "2\t2"], 2);
    expect(triples(labels)).toEqual([
      [0, 1, "a"],
      // the second label is gone; the gap before it is not filled
    ]);
  });

  it("skips Audacity's spectral lines and blank lines", () => {
    const labels = parseAudacityLabels(
      ["1\t2\tvowel", "\\\t4000.000000\t200.000000", "", "3\t4\tnext"],
      10,
    );
    expect(triples(labels)).toEqual([
      [0, 1, undefined],
      [1, 2, "vowel"],
      [3, 4, "next"],
    ]);
  });

  it("keeps text with spaces and ignores any fields after the text", () => {
    const [, second] = parseAudacityLabels(["1\t2\thello there\textra"], 10);
    expect(second.text).toBe("hello there");
  });

  it("gives no segments for a file without labels", () => {
    expect(parseAudacityLabels(["", "not a label"], 10)).toEqual([]);
    expect(parseAudacityLabels([], 10)).toEqual([]);
  });
});

describe("splitLabelLines", () => {
  it("splits CRLF, LF and CR and ignores one trailing line break", () => {
    expect(splitLabelLines("a\r\nb\nc\rd\r\n")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("segmentsFromAudacityLabels (SayMore's SaveFromSegments)", () => {
  const file = "0.000000\t1.500000\tkia ora\n1.500000\t3.000000\tgood day\n";

  it("puts label text in the transcription tier", () => {
    const segments = segmentsFromAudacityLabels(file, 10, "Transcription");
    expect(
      segments.map((s) => [s.range.start, s.range.end, s.transcription, s.freeTranslation]),
    ).toEqual([
      [0, 1.5, "kia ora", ""],
      [1.5, 3, "good day", ""],
    ]);
  });

  it("puts label text in the free translation tier and leaves transcription empty", () => {
    const segments = segmentsFromAudacityLabels(file, 10, "FreeTranslation");
    expect(segments.map((s) => [s.transcription, s.freeTranslation])).toEqual([
      ["", "kia ora"],
      ["", "good day"],
    ]);
  });

  it("drops labels that start after the media ends and cuts the one that runs past it", () => {
    const segments = segmentsFromAudacityLabels("0\t2\ta\n2\t6\tb\n7\t8\tc\n", 5, "Transcription");
    expect(segments.map((s) => [s.range.start, s.range.end, s.transcription])).toEqual([
      [0, 2, "a"],
      [2, 5, "b"],
    ]);
  });

  it("removes characters XML cannot carry from the text", () => {
    const [segment] = segmentsFromAudacityLabels("0\t1\tab\u0001c\u000bd\n", 5, "Transcription");
    expect(segment.transcription).toBe("abcd");
  });
});

describe("buildEafFromChosenFile", () => {
  const labels = "0.5\t1.25\tfirst\n1.25\t2.5\tsecond\n";
  const duration = async () => 3;

  it("makes an eaf from Audacity labels, with the implicit segment from zero", async () => {
    const { xml, kind } = await buildEafFromChosenFile({
      fileText: labels,
      mediaFileName: "story.wav",
      tier: "Transcription",
      getMediaDurationSec: duration,
    });
    expect(kind).toBe("audacity");
    const doc = loadEaf(xml);
    expect(doc.media?.mediaUrl).toBe("story.wav");
    expect(doc.segments.map((s) => [s.range.start, s.range.end, s.transcription])).toEqual([
      [0, 0.5, ""],
      [0.5, 1.25, "first"],
      [1.25, 2.5, "second"],
    ]);
  });

  it("puts the text in Phrase Free Translation when asked", async () => {
    const { xml } = await buildEafFromChosenFile({
      fileText: labels,
      mediaFileName: "story.wav",
      tier: "FreeTranslation",
      getMediaDurationSec: duration,
    });
    expect(loadEaf(xml).segments.map((s) => [s.transcription, s.freeTranslation])).toEqual([
      ["", ""],
      ["", "first"],
      ["", "second"],
    ]);
  });

  it("decides by content: an ELAN file chosen through the Audacity button is copied", async () => {
    const eaf = `<ANNOTATION_DOCUMENT><HEADER MEDIA_FILE="" TIME_UNITS="milliseconds"/><TIME_ORDER/></ANNOTATION_DOCUMENT>`;
    let asked = false;
    const { kind } = await buildEafFromChosenFile({
      fileText: eaf,
      mediaFileName: "story.wav",
      tier: "FreeTranslation",
      getMediaDurationSec: async () => {
        asked = true;
        return 3;
      },
    });
    expect(kind).toBe("elan");
    expect(asked).toBe(false);
  });

  it("decides by content: a non-ELAN file chosen through the ELAN button is read as labels", async () => {
    const { kind, xml } = await buildEafFromChosenFile({
      fileText: labels,
      mediaFileName: "story.wav",
      tier: "Transcription",
      getMediaDurationSec: duration,
    });
    expect(kind).toBe("audacity");
    expect(loadEaf(xml).segments).toHaveLength(3);
  });
});

describe("createEafFromChosenFile", () => {
  it("writes <media>.annotations.eaf beside the media", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed("story.wav", new Uint8Array(4));
    const rel = await createEafFromChosenFile({
      adapter,
      mediaFileName: "story.wav",
      fileText: "0\t1\thi\n",
      tier: "Transcription",
      getMediaDurationSec: async () => 2,
    });
    expect(rel).toBe("story.wav.annotations.eaf");
    expect(loadEaf(await adapter.readText(rel)).segments[0].transcription).toBe("hi");
  });

  it("never overwrites an eaf that already exists", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed("story.wav", new Uint8Array(4));
    await adapter.writeText("story.wav.annotations.eaf", "ORIGINAL");
    await createEafFromChosenFile({
      adapter,
      mediaFileName: "story.wav",
      fileText: "0\t1\thi\n",
      tier: "Transcription",
      getMediaDurationSec: async () => 2,
    });
    expect(await adapter.readText("story.wav.annotations.eaf")).toBe("ORIGINAL");
  });
});
