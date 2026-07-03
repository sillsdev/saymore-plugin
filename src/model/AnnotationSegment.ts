import type { TimeRange } from "./TimeRange";

/**
 * One annotation segment. In SayMore the three tiers (the TimeTier "Source" plus
 * the "Transcription" and "Phrase Free Translation" text tiers) are kept in
 * positional lockstep: **segment identity is the positional index across all
 * three tiers**, not an id. This shape bundles that positional row.
 *
 * The ignore flag is not an XML attribute — it is the magic transcription text
 * `%ignore%` (legacy read alias `%junk%`). IgnoreMarkers (Phase 1) owns that
 * detail; a plain reader can compare `transcription` against the marker.
 */
export interface AnnotationSegment {
  /** Time span on the source media, in seconds. */
  readonly range: TimeRange;
  /** Transcription tier text ("" if none). */
  transcription: string;
  /** Phrase Free Translation tier text ("" if none). */
  freeTranslation: string;
}
