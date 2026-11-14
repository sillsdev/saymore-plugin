import type { AnnotationSegment } from "../model/AnnotationSegment";
import { formatTimeSpanHundredths, tierText, writeLines, type TextTierKind } from "./timeFormat";

/**
 * SayMore `SRTFormatSubTitleExporter`: one numbered block per segment, ignored
 * segments included with their `%ignore%` text, each block ended by a blank line.
 */
export function exportSrt(segments: readonly AnnotationSegment[], tier: TextTierKind): string {
  const lines: string[] = [];
  segments.forEach((segment, i) => {
    lines.push(String(i + 1));
    lines.push(
      `${formatTimeSpanHundredths(segment.range.start, ",")} --> ${formatTimeSpanHundredths(segment.range.end, ",")}`,
    );
    lines.push(tierText(segment, tier));
    lines.push("");
  });
  return writeLines(lines);
}
