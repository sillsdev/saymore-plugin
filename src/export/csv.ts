import type { AnnotationSegment } from "../model/AnnotationSegment";
import { formatTimeSpanHundredths, writeLines } from "./timeFormat";

/** SayMore `CSVTranscriptionExporter.Escape`. */
export function escapeCsvField(s: string | null | undefined): string {
  if (s == null) return "";
  let out = s.includes('"') ? s.replace(/"/g, '""') : s;
  if (/[,"\n]/.test(out)) out = `"${out}"`;
  return out;
}

/** SayMore `CSVTranscriptionExporter`: `n,start,end,transcription,freeTranslation` rows, no header row. */
export function exportCsv(segments: readonly AnnotationSegment[]): string {
  return writeLines(
    segments.map(
      (s, i) =>
        `${i + 1},${formatTimeSpanHundredths(s.range.start, ".")},${formatTimeSpanHundredths(s.range.end, ".")},` +
        `${escapeCsvField(s.transcription)},${escapeCsvField(s.freeTranslation)}`,
    ),
  );
}
