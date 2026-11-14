import type { AnnotationSegment } from "../model/AnnotationSegment";
import { secondsToTimeSpanMs, tierText, writeLines, type TextTierKind } from "./timeFormat";

/** SayMore `AudacityExporter`: `start<TAB>end<TAB>text` per segment, seconds with six decimals. */
export function exportAudacityLabels(
  segments: readonly AnnotationSegment[],
  tier: TextTierKind,
): string {
  return writeLines(
    segments.map((segment) => {
      const start = (secondsToTimeSpanMs(segment.range.start) / 1000).toFixed(6);
      const end = (secondsToTimeSpanMs(segment.range.end) / 1000).toFixed(6);
      return `${start}\t${end}\t${tierText(segment, tier)}`;
    }),
  );
}
