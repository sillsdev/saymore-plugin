import type { TimeRange } from "../../model/TimeRange";
import type { OralAnnotationKind } from "../../fs/OralAnnotationFiles";

/**
 * Shared recorder contracts (LOCKED — see `recorder-contracts.md`). All three
 * tracks code against these; Worker A owns this file.
 */

/**
 * SayMore's `SpaceBarMode`: the recorder is a small state machine driven mostly
 * by the space bar. `Listen` = must hear the source segment before recording;
 * `Record` = push-to-talk armed; `Done` = every segment annotated; `Error` =
 * the capture device was lost (recovery polling).
 */
export type SpaceBarMode = "Listen" | "Record" | "Done" | "Error";

/** Which kind of oral annotation this recorder produces (= {@link OralAnnotationKind}). */
export type RecorderKind = OralAnnotationKind; // "Careful" | "Translation"

/** One row in the per-segment annotation strip below the source waveform. */
export interface SegmentCellState {
  /** Time span on the source media, in seconds. */
  range: TimeRange;
  /** True when this segment already has a WAV of *this* recorder's kind. */
  annotated: boolean;
  /** True when the segment is `%ignore%`d (skipped by the recorder). */
  ignored: boolean;
  /** True when this is the segment the recorder is currently working on. */
  isCurrent: boolean;
}
