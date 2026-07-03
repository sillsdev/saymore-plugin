import type { AnnotationSegment } from "./AnnotationSegment";
import { isSegmentIgnored } from "./IgnoreMarkers";

/**
 * SayMore completeness rules (TierCollection.cs): the transcription is complete
 * when every segment has non-empty text (an ignored segment's `%ignore%` counts
 * as text); the free translation is complete when every NON-ignored segment has
 * a non-empty translation.
 */
export function isTranscriptionComplete(segments: readonly AnnotationSegment[]): boolean {
  return segments.every((s) => s.transcription.trim().length > 0);
}

export function isTranslationComplete(segments: readonly AnnotationSegment[]): boolean {
  return segments.every((s) => isSegmentIgnored(s) || s.freeTranslation.trim().length > 0);
}
