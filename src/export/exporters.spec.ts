import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnnotationSegment } from "../model/AnnotationSegment";
import { loadEaf } from "../model/eaf/EafDocument";
import { testDataPath } from "../testData";
import { exportAudacityLabels } from "./audacity";
import { escapeCsvField, exportCsv } from "./csv";
import { buildExport, EXPORT_FORMATS, type ExportContext } from "./exportFormats";
import { exportFlexText } from "./flexText";
import { exportPlainText } from "./plainText";
import { exportSrt } from "./srt";
import { exportToolbox, formatToolboxSeconds } from "./toolbox";

const seg = (
  start: number,
  end: number,
  transcription = "",
  freeTranslation = "",
): AnnotationSegment => ({ range: { start, end }, transcription, freeTranslation });

// SayMore's SubTitleExporterTests / AudacityExporterTests build this tier (floats 1.456 and 2.6789).
const sayMoreTier = [seg(0, 1, "one"), seg(1.456, 2.6789, "two"), seg(2, 3, "three")];

const ctx: ExportContext = {
  sessionId: "ETR009",
  mediaFileName: "ETR009.wav",
  mediaFilePath: "C:\\p\\ETR009\\ETR009.wav",
};

describe("SRT (SubTitleExporterTests)", () => {
  it("writes nothing for no segments", () => {
    expect(exportSrt([], "transcription")).toBe("");
  });

  it("writes numbered blocks with hundredths truncated, CRLF lines, a blank line after each block", () => {
    expect(exportSrt(sayMoreTier, "transcription")).toBe(
      "1\r\n00:00:00,00 --> 00:00:01,00\r\none\r\n\r\n" +
        "2\r\n00:00:01,45 --> 00:00:02,67\r\ntwo\r\n\r\n" +
        "3\r\n00:00:02,00 --> 00:00:03,00\r\nthree\r\n\r\n",
    );
  });

  it("includes ignored segments verbatim and reads the chosen tier", () => {
    const segments = [seg(0, 1, "%ignore%", "ignored translation"), seg(1, 3725.5, "a", "b")];
    expect(exportSrt(segments, "freeTranslation")).toBe(
      "1\r\n00:00:00,00 --> 00:00:01,00\r\nignored translation\r\n\r\n" +
        "2\r\n00:00:01,00 --> 01:02:05,50\r\nb\r\n\r\n",
    );
    expect(exportSrt(segments, "transcription")).toContain("\r\n%ignore%\r\n");
  });
});

describe("Audacity label file (AudacityExporterTests)", () => {
  it("writes nothing for no segments", () => {
    expect(exportAudacityLabels([], "transcription")).toBe("");
  });

  it("writes start, end and text with six decimals; 2.6789 shows as 2.679000", () => {
    expect(exportAudacityLabels(sayMoreTier, "transcription")).toBe(
      "0.000000\t1.000000\tone\r\n1.456000\t2.679000\ttwo\r\n2.000000\t3.000000\tthree\r\n",
    );
  });

  it("reads the free translation tier", () => {
    expect(exportAudacityLabels([seg(0, 1, "x", "y"), seg(1, 2, "z")], "freeTranslation")).toBe(
      "0.000000\t1.000000\ty\r\n1.000000\t2.000000\t\r\n",
    );
  });
});

describe("plain text", () => {
  it("writes the Transcription section then the Free Translation section", () => {
    expect(exportPlainText([seg(0, 1, "a", "x"), seg(1, 2, "%ignore%", "")])).toBe(
      "-- Transcription --\r\n\r\na\r\n%ignore%\r\n\r\n\r\n-- Free Translation --\r\n\r\nx\r\n\r\n",
    );
  });

  it("writes only the headings and blank lines for no segments", () => {
    expect(exportPlainText([])).toBe(
      "-- Transcription --\r\n\r\n\r\n\r\n-- Free Translation --\r\n\r\n",
    );
  });
});

describe("CSV", () => {
  it("quotes fields that hold a comma, a quote or a newline, doubling quotes", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("two\nlines")).toBe('"two\nlines"');
    expect(escapeCsvField("only\rreturn")).toBe("only\rreturn");
    expect(escapeCsvField(null)).toBe("");
  });

  it("writes one row per segment with a dot before the hundredths and no header", () => {
    expect(
      exportCsv([seg(0, 1.456, "one, two", 'he said "x"'), seg(1.456, 2.6789, "%ignore%")]),
    ).toBe(
      '1,00:00:00.00,00:00:01.45,"one, two","he said ""x"""\r\n' +
        "2,00:00:01.45,00:00:02.67,%ignore%,\r\n",
    );
  });
});

describe("Toolbox standard format", () => {
  it('formats seconds like C# float.ToString("00.00###")', () => {
    expect(formatToolboxSeconds(0)).toBe("00.00");
    expect(formatToolboxSeconds(1)).toBe("01.00");
    expect(formatToolboxSeconds(1.456)).toBe("01.456");
    expect(formatToolboxSeconds(2.6789)).toBe("02.6789");
    expect(formatToolboxSeconds(2.678912)).toBe("02.67891");
    expect(formatToolboxSeconds(12.5)).toBe("12.50");
    expect(formatToolboxSeconds(123.4567)).toBe("123.4567");
    expect(formatToolboxSeconds(1234.5678)).toBe("1234.568");
  });

  it("writes a record per segment", () => {
    expect(
      exportToolbox([seg(0, 1.456, "t1", "f1"), seg(1.456, 3, "%ignore%")], "ETR009", "ETR009.wav"),
    ).toBe(
      "\\ref ETR009_0001\r\n\\begin 00.00\r\n\\end 01.456\r\n\\media ETR009.wav 00.00 01.456\r\n\\t t1\r\n\\f f1\r\n\r\n" +
        "\\ref ETR009_0002\r\n\\begin 01.456\r\n\\end 03.00\r\n\\media ETR009.wav 01.456 03.00\r\n\\t %ignore%\r\n\\f \r\n\r\n",
    );
  });
});

describe("FLEx interlinear text (FLExTextExporterTests)", () => {
  const options = {
    title: "Homer",
    transcriptionWs: "en",
    freeTranslationWs: "fr",
    mediaFilePath: "filename1",
    sourceFilePath: "filename2",
    mediaFileGuid: "G1",
    sourceFileGuid: "G2",
  };

  it("writes the document SayMore's test tier produces, offsets in whole milliseconds", () => {
    const segments = [
      seg(10, 20, "up", "in"),
      seg(20, 30, "down", "around"),
      seg(30, 40, "over", "through"),
    ];
    const xml = exportFlexText(segments, options);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n<document>\r\n')).toBe(true);
    expect(xml).toContain('<item type="title" lang="fr">Homer</item>');
    expect(xml).toContain(
      '<phrase begin-time-offset="10000" end-time-offset="20000" media-file="G1">',
    );
    expect(xml).toContain('<phrase begin-time-offset="30000" end-time-offset="40000"');
    expect(xml).toContain('<item type="segnum" lang="fr">3</item>');
    expect(xml).toContain('<item type="txt" lang="en">down</item>');
    expect(xml).toContain('<item type="gls" lang="fr">around</item>');
    expect(xml).toContain('<language lang="en" />\r\n      <language lang="fr" />');
    expect(xml).toContain('<media guid="G1" location="filename1" />');
    expect(xml).toContain('<media guid="G2" location="filename2" />');
  });

  it("writes an ignored segment as ... with no gls item, an empty translation as an empty gls", () => {
    const xml = exportFlexText([seg(0, 1, "%ignore%", "dropped"), seg(1, 2, "text", "")], options);
    expect(xml).toContain('<item type="txt" lang="en">...</item>');
    expect(xml).not.toContain("dropped");
    expect(xml).toContain('<item type="gls" lang="fr"></item>');
  });

  it("is byte-exact for a one-segment document", () => {
    expect(
      exportFlexText([seg(0.75, 1.25, "a & <b>", "c")], {
        ...options,
        sourceFilePath: undefined,
      }),
    ).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<document>",
        "  <interlinear-text>",
        '    <item type="title" lang="fr">Homer</item>',
        "    <paragraphs>",
        "      <paragraph>",
        "        <phrases>",
        '          <phrase begin-time-offset="750" end-time-offset="1250" media-file="G1">',
        '            <item type="segnum" lang="fr">1</item>',
        '            <item type="txt" lang="en">a &amp; &lt;b&gt;</item>',
        '            <item type="gls" lang="fr">c</item>',
        "            <words />",
        "          </phrase>",
        "        </phrases>",
        "      </paragraph>",
        "    </paragraphs>",
        "    <languages>",
        '      <language lang="en" />',
        '      <language lang="fr" />',
        "    </languages>",
        '    <media-files offset-type="">',
        '      <media guid="G1" location="filename1" />',
        "    </media-files>",
        "  </interlinear-text>",
        "</document>",
      ].join("\r\n"),
    );
  });

  it("draws a fresh GUID per export when none is pinned", () => {
    const a = exportFlexText([seg(0, 1, "a")], { ...options, mediaFileGuid: undefined });
    const b = exportFlexText([seg(0, 1, "a")], { ...options, mediaFileGuid: undefined });
    expect(a).not.toBe(b);
  });
});

describe("a real SayMore session (longerSound.wav)", () => {
  const eaf = loadEaf(
    readFileSync(testDataPath("session/longerSound.wav.annotations.eaf"), "utf8"),
  );
  const segments = eaf.segments;

  it("exports every segment, ignored one included", () => {
    expect(segments.length).toBeGreaterThanOrEqual(3);
    const srt = exportSrt(segments, "transcription");
    expect(srt).toContain("1\r\n00:00:00,75 --> 00:00:01,25\r\nFirst phrase\r\n\r\n");
    expect(srt).toContain("00:00:02,50 --> 00:00:10,00\r\n%ignore%\r\n");
    expect(exportCsv(segments)).toContain(
      "1,00:00:00.75,00:00:01.25,First phrase,First translation\r\n",
    );
    expect(exportAudacityLabels(segments, "freeTranslation")).toContain(
      "0.750000\t1.250000\tFirst translation\r\n",
    );
    expect(
      exportFlexText(segments, {
        title: "longerSound.wav",
        transcriptionWs: "qaa",
        freeTranslationWs: "en",
        mediaFilePath: "longerSound.wav",
      }),
    ).toContain('begin-time-offset="750" end-time-offset="1250"');
  });
});

describe("export menu", () => {
  it("lists SayMore's labels in its order", () => {
    expect(EXPORT_FORMATS.map((f) => f.label())).toEqual([
      "Audacity Label File (Free Translation)...",
      "Audacity Label File (Transcription)...",
      "FLEx Interlinear Text...",
      "Plain Text...",
      "Subtitles File (Free Translation)...",
      "Subtitles File (Transcription)...",
      "Spreadsheet (CSV) File...",
      "Toolbox File...",
    ]);
  });

  it("names files the way SayMore's Save dialog does", () => {
    const names = Object.fromEntries(
      EXPORT_FORMATS.map((f) => [
        f.id,
        buildExport(f.id, sayMoreTier, ctx, { transcriptionWs: "en", freeTranslationWs: "en" })
          .fileName,
      ]),
    );
    expect(names).toEqual({
      audacityFreeTranslation: "ETR009_audacity_freeTranslation.txt",
      audacityTranscription: "ETR009_audacity_transcription.txt",
      flexInterlinear: "ETR009.wav.flextext",
      plainText: "ETR009_transcription.txt",
      srtFreeTranslation: "ETR009_freeTranslation_subtitle.srt",
      srtTranscription: "ETR009_transcription_subtitle.srt",
      csv: "ETR009_transcription.csv",
      toolbox: "ETR009_interlinear.txt",
    });
  });

  it("marks only the FLEx file as starting with a byte order mark", () => {
    const ws = { transcriptionWs: "en", freeTranslationWs: "en" };
    for (const f of EXPORT_FORMATS) {
      expect(buildExport(f.id, sayMoreTier, ctx, ws).bom).toBe(f.id === "flexInterlinear");
    }
    expect(() => buildExport("flexInterlinear", sayMoreTier, ctx)).toThrow();
  });
});
