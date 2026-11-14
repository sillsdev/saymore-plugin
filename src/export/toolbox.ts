import type { AnnotationSegment } from "../model/AnnotationSegment";
import { writeLines } from "./timeFormat";

/**
 * C# `float.ToString("00.00###")`: the float is shown with 7 significant digits,
 * then written with at least two integer digits and two to five decimals. The
 * decimal separator is ".", where SayMore uses the current culture's.
 */
export function formatToolboxSeconds(seconds: number): string {
  const sevenDigits = Number(Math.fround(seconds).toPrecision(7));
  const [whole, fraction = ""] = sevenDigits.toFixed(5).split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole.padStart(2, "0")}.${trimmed}`;
}

/** SayMore `ToolboxTranscriptionExporter`: a `\ref` record per segment with `\begin`, `\end`, `\media`, `\t` and `\f` fields. */
export function exportToolbox(
  segments: readonly AnnotationSegment[],
  referencePrefix: string,
  mediaFileName: string,
): string {
  const lines: string[] = [];
  segments.forEach((s, i) => {
    const begin = formatToolboxSeconds(s.range.start);
    const end = formatToolboxSeconds(s.range.end);
    lines.push(`\\ref ${referencePrefix}_${String(i + 1).padStart(4, "0")}`);
    lines.push(`\\begin ${begin}`);
    lines.push(`\\end ${end}`);
    lines.push(`\\media ${mediaFileName} ${begin} ${end}`);
    lines.push(`\\t ${s.transcription ?? ""}`);
    lines.push(`\\f ${s.freeTranslation ?? ""}`);
    lines.push("");
  });
  return writeLines(lines);
}
