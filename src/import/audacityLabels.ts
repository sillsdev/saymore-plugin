import type { AnnotationSegment } from "../model/AnnotationSegment";
import { makeTimeRange } from "../model/TimeRange";

/**
 * "Import an Audacity Label file" (SayMore `AudacityLabelHelper` plus
 * `AnnotationFileHelper.SaveFromSegments`). An Audacity label file is one label per line,
 * tab-separated: `start<TAB>end<TAB>text`. A point label has the same start and end (or no
 * end). Audacity also writes a `\<TAB>highFreq<TAB>lowFreq` line after a spectral label;
 * its first field is not a number, so it is skipped.
 */

/** Which SayMore tier the label text lands in. */
export type LabelTextTier = "Transcription" | "FreeTranslation";

interface Label {
  start: number;
  end: number;
  text: string | undefined;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseNumber(field: string): number | undefined {
  const trimmed = field.trim();
  return NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/** SayMore `CreateSingleSegment`: an unreadable start is -1, an unreadable end is the start. */
function parseLine(line: string): Label {
  const fields = line.split("\t");
  const start = parseNumber(fields[0]);
  const end = fields.length > 1 ? parseNumber(fields[1]) : undefined;
  return {
    start: start ?? -1,
    end: end ?? start ?? -1,
    text: fields.length >= 3 ? fields[2] : undefined,
  };
}

/** Lines the way .NET `File.ReadAllLines` splits them: CRLF, LF or CR. */
export function splitLabelLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * SayMore `AudacityLabelHelper` constructor + `FixUpLabelInfo`:
 *  - lines without a readable start time (> -1) are dropped;
 *  - a label whose end is not after its start (a point) ends where the next label starts;
 *  - the last such label ends at `mediaDurationSec`, or is dropped when it starts exactly there;
 *  - when the first label starts after 0, an unlabelled segment from 0 is inserted first.
 */
export function parseAudacityLabels(
  lines: readonly string[],
  mediaDurationSec: number,
): { start: number; end: number; text: string | undefined }[] {
  const labels = lines.map(parseLine).filter((l) => l.start > -1);

  for (let i = 0; i < labels.length; i++) {
    if (labels[i].end > labels[i].start) continue;
    if (i < labels.length - 1) {
      labels[i].end = labels[i + 1].start;
    } else if (labels[i].start === mediaDurationSec) {
      labels.splice(i, 1);
    } else {
      labels[i].end = mediaDurationSec;
    }
  }

  if (labels.length > 0 && labels[0].start > 0) {
    labels.unshift({ start: 0, end: labels[0].start, text: undefined });
  }
  return labels;
}

/** Characters XML 1.0 cannot carry (SayMore runs label text through `XmlUtils.SanitizeString`). */
function sanitizeXmlText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

/**
 * SayMore `SaveFromSegments`: labels that start after the end of the media are dropped, a
 * label that runs past it is cut at the end, and the text goes into the chosen tier (the
 * other tier stays empty).
 */
export function segmentsFromAudacityLabels(
  text: string,
  mediaDurationSec: number,
  tier: LabelTextTier,
): AnnotationSegment[] {
  const labels = parseAudacityLabels(splitLabelLines(text), mediaDurationSec);
  const segments: AnnotationSegment[] = [];
  for (const label of labels) {
    if (label.start > mediaDurationSec) continue;
    const end = Math.min(label.end, mediaDurationSec);
    const labelText = sanitizeXmlText(label.text ?? "");
    segments.push({
      range: makeTimeRange(label.start, end),
      transcription: tier === "Transcription" ? labelText : "",
      freeTranslation: tier === "FreeTranslation" ? labelText : "",
    });
  }
  return segments;
}
