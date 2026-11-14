import type { AnnotationSegment } from "../model/AnnotationSegment";
import { IGNORE_MARKER } from "../model/IgnoreMarkers";
import { NEWLINE } from "./timeFormat";

export interface FlexTextOptions {
  /** SayMore passes the media file name. */
  title: string;
  /** Writing system id for the Transcription (`txt`) items. */
  transcriptionWs: string;
  /** Writing system id for the Free Translation (`gls`), title and `segnum` items. */
  freeTranslationWs: string;
  /** Path of the media file as FLEx should find it. */
  mediaFilePath: string;
  /** Second media entry; SayMore adds it when the session has a Source file other than the annotated media. */
  sourceFilePath?: string;
  /** SayMore draws a fresh GUID per export; a caller can pin them. */
  mediaFileGuid?: string;
  sourceFileGuid?: string;
}

interface XmlNode {
  name: string;
  attrs: [string, string][];
  /** Text content, or child elements; `undefined` writes `<name />`. */
  text?: string;
  children?: XmlNode[];
}

const el = (name: string, attrs: [string, string][] = [], content?: string | XmlNode[]): XmlNode =>
  typeof content === "string" ? { name, attrs, text: content } : { name, attrs, children: content };

const item = (lang: string, type: string, text: string) =>
  el(
    "item",
    [
      ["type", type],
      ["lang", lang],
    ],
    text,
  );

// .NET XmlWriter (NewLineHandling.Replace): newlines in text become CRLF, in attributes character references.
const escText = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, NEWLINE);
const escAttr = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#xD;")
    .replace(/\n/g, "&#xA;")
    .replace(/\t/g, "&#x9;");

function writeNode(node: XmlNode, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (node.text !== undefined) {
    out.push(`${indent}<${node.name}${attrs}>${escText(node.text)}</${node.name}>`);
  } else if (!node.children || node.children.length === 0) {
    out.push(`${indent}<${node.name}${attrs} />`);
  } else {
    out.push(`${indent}<${node.name}${attrs}>`);
    for (const c of node.children) writeNode(c, depth + 1, out);
    out.push(`${indent}</${node.name}>`);
  }
}

/** Bytes SayMore's `XElement.Save` writes: a UTF-8 byte order mark first, then this text. */
export const FLEX_TEXT_HAS_BOM = true;

/**
 * SayMore `FLExTextExporter`: the `.flextext` document. A segment whose
 * transcription is exactly `%ignore%` is written as `...` with no `gls` item.
 */
export function exportFlexText(
  segments: readonly AnnotationSegment[],
  options: FlexTextOptions,
): string {
  const mediaGuid = options.mediaFileGuid ?? crypto.randomUUID();
  const sourceGuid = options.sourceFilePath
    ? (options.sourceFileGuid ?? crypto.randomUUID())
    : undefined;

  const paragraphs = segments.map((s, i) => {
    const ignored = s.transcription === IGNORE_MARKER;
    const phraseItems: XmlNode[] = [
      item(options.freeTranslationWs, "segnum", String(i + 1)),
      item(options.transcriptionWs, "txt", ignored ? "..." : (s.transcription ?? "")),
    ];
    if (!ignored && s.freeTranslation != null) {
      phraseItems.push(item(options.freeTranslationWs, "gls", s.freeTranslation));
    }
    phraseItems.push(el("words"));
    const phrase = el(
      "phrase",
      [
        ["begin-time-offset", String(offsetMs(s.range.start))],
        ["end-time-offset", String(offsetMs(s.range.end))],
        ["media-file", mediaGuid],
      ],
      phraseItems,
    );
    return el("paragraph", [], [el("phrases", [], [phrase])]);
  });

  const mediaEntries = [
    el("media", [
      ["guid", mediaGuid],
      ["location", options.mediaFilePath],
    ]),
  ];
  if (sourceGuid) {
    mediaEntries.push(
      el("media", [
        ["guid", sourceGuid],
        ["location", options.sourceFilePath!],
      ]),
    );
  }

  const root = el(
    "document",
    [],
    [
      el(
        "interlinear-text",
        [],
        [
          item(options.freeTranslationWs, "title", options.title),
          el("paragraphs", [], paragraphs),
          el(
            "languages",
            [],
            [
              el("language", [["lang", options.transcriptionWs]]),
              el("language", [["lang", options.freeTranslationWs]]),
            ],
          ),
          el("media-files", [["offset-type", ""]], mediaEntries),
        ],
      ),
    ],
  );

  const out: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  writeNode(root, 0, out);
  return out.join(NEWLINE);
}

/** C# `(int)Math.Round(float * 1000)`: float arithmetic, then round half to even. */
function offsetMs(seconds: number): number {
  const x = Math.fround(Math.fround(seconds) * 1000);
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
