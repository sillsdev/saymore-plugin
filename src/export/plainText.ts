import type { AnnotationSegment } from "../model/AnnotationSegment";
import { writeLines } from "./timeFormat";

/** The tier display names SayMore writes in the section headings (`CommonUIStrings`). */
export interface PlainTextHeadings {
  transcription: string;
  freeTranslation: string;
}

export const DEFAULT_PLAIN_TEXT_HEADINGS: PlainTextHeadings = {
  transcription: "Transcription",
  freeTranslation: "Free Translation",
};

/** SayMore `PlainTextTranscriptionExporter`: the Transcription tier, then the Free Translation tier, one line per segment. */
export function exportPlainText(
  segments: readonly AnnotationSegment[],
  headings: PlainTextHeadings = DEFAULT_PLAIN_TEXT_HEADINGS,
): string {
  return writeLines([
    `-- ${headings.transcription} --`,
    "",
    ...segments.map((s) => s.transcription ?? ""),
    "",
    "",
    `-- ${headings.freeTranslation} --`,
    "",
    ...segments.map((s) => s.freeTranslation ?? ""),
  ]);
}
