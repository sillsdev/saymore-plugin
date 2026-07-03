import type { AnnotationSegment } from "./AnnotationSegment";

/**
 * The "ignore" flag is not an XML attribute — SayMore stores the magic string
 * `%ignore%` as the transcription-tier text (see `TierCollection.kIgnoreSegment`).
 * Legacy files used `%junk%`; we read both but always write `%ignore%`.
 * The flag lives ONLY on the transcription tier.
 */
export const IGNORE_MARKER = "%ignore%";
const LEGACY_IGNORE_MARKER = "%junk%";

/** True if the transcription text marks the segment as ignored (incl. legacy). */
export function isIgnoredText(transcription: string): boolean {
  const t = transcription.trim();
  return t === IGNORE_MARKER || t === LEGACY_IGNORE_MARKER;
}

export function isSegmentIgnored(segment: AnnotationSegment): boolean {
  return isIgnoredText(segment.transcription);
}
