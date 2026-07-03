import type { AnnotationSegment } from "./AnnotationSegment";
import { makeTimeRange } from "./TimeRange";
import { IGNORE_MARKER, isIgnoredText } from "./IgnoreMarkers";
import { MIN_SEGMENT_LENGTH_MS } from "./SayMoreConstants";

/**
 * Pure boundary-editing rules, ported from SayMore's `TimeTier.cs` /
 * `TierCollection.cs` / `TextTier.cs`. Segment identity is the positional index
 * across the three tiers, bundled here in one `AnnotationSegment[]`. Every
 * function is pure: it returns a NEW array on success and the original array
 * (plus a non-Success result code) on rejection.
 */

/** Mirrors SayMore `BoundaryModificationResult` (TimeTier.cs:13-20). */
export enum BoundaryResult {
  Success = "Success",
  SegmentNotFound = "SegmentNotFound",
  SegmentWillBeTooShort = "SegmentWillBeTooShort",
  NextSegmentWillBeTooShort = "NextSegmentWillBeTooShort",
  BlockedByOralAnnotations = "BlockedByOralAnnotations"
}

export interface BoundaryEdit {
  result: BoundaryResult;
  segments: readonly AnnotationSegment[];
}

const MIN_SEC = MIN_SEGMENT_LENGTH_MS / 1000;

/**
 * SayMore's canonical min-length predicate (TimeTier.cs:323-332). The ×100 +
 * round absorbs ~2 extra decimals of a millisecond of float noise.
 */
export function isAcceptableSegmentLength(
  startSec: number,
  endSec: number,
  minMs = MIN_SEGMENT_LENGTH_MS
): boolean {
  return Math.round(((endSec - startSec) * 1000 - minMs) * 100) >= 0;
}

/** Boundary-equality at millisecond granularity (SayMore rounds to whole ms). */
export function msEquals(aSec: number, bSec: number): boolean {
  return Math.round(aSec * 1000) === Math.round(bSec * 1000);
}

function seg(
  startSec: number,
  endSec: number,
  transcription = "",
  freeTranslation = ""
): AnnotationSegment {
  return { range: makeTimeRange(startSec, endSec), transcription, freeTranslation };
}

/** Index of the segment whose END equals `boundarySec` (ms-granular), or -1. */
export function indexOfSegmentEndingAt(
  segments: readonly AnnotationSegment[],
  boundarySec: number
): number {
  return segments.findIndex((s) => msEquals(s.range.end, boundarySec));
}

/**
 * Insert a boundary at `boundarySec`. Splits the enclosing segment (original
 * text follows the RIGHT half, the new empty/`%ignore%` text takes the LEFT
 * half — SayMore inserts the new text slot at the left index, shifting the
 * original right), or appends a new segment past the last one.
 */
export function insertBoundary(
  segments: readonly AnnotationSegment[],
  boundarySec: number
): BoundaryEdit {
  if (boundarySec <= 0) {
    return { result: BoundaryResult.SegmentWillBeTooShort, segments };
  }
  // A boundary already exactly here → duplicate, reject.
  if (indexOfSegmentEndingAt(segments, boundarySec) !== -1) {
    return { result: BoundaryResult.SegmentWillBeTooShort, segments };
  }

  // Enclosing segment: Start <= b <= End (inclusive), matching C# Contains(_, true).
  const i = segments.findIndex(
    (s) => s.range.start <= boundarySec && s.range.end >= boundarySec
  );

  if (i === -1) {
    // Append case: new segment [lastEnd, boundary].
    const newStart = segments.length ? segments[segments.length - 1].range.end : 0;
    if (!isAcceptableSegmentLength(newStart, boundarySec)) {
      return { result: BoundaryResult.SegmentWillBeTooShort, segments };
    }
    return {
      result: BoundaryResult.Success,
      segments: [...segments, seg(newStart, boundarySec)]
    };
  }

  // Split case.
  const orig = segments[i];
  if (!isAcceptableSegmentLength(orig.range.start, boundarySec)) {
    return { result: BoundaryResult.SegmentWillBeTooShort, segments };
  }
  if (!isAcceptableSegmentLength(boundarySec, orig.range.end)) {
    return { result: BoundaryResult.NextSegmentWillBeTooShort, segments };
  }
  const origIgnored = isIgnoredText(orig.transcription);
  const left = seg(orig.range.start, boundarySec, origIgnored ? IGNORE_MARKER : "", "");
  const right = seg(boundarySec, orig.range.end, orig.transcription, orig.freeTranslation);
  const next = segments.slice();
  next.splice(i, 1, left, right);
  return { result: BoundaryResult.Success, segments: next };
}

/**
 * Move the END boundary of segment `index` (shared with the start of the next
 * segment). Clamped so neither resulting side drops below the minimum.
 */
export function moveBoundary(
  segments: readonly AnnotationSegment[],
  index: number,
  newEndSec: number
): BoundaryEdit {
  if (index < 0 || index >= segments.length) {
    return { result: BoundaryResult.SegmentNotFound, segments };
  }
  const cur = segments[index];
  if (!isAcceptableSegmentLength(cur.range.start, newEndSec)) {
    return { result: BoundaryResult.SegmentWillBeTooShort, segments };
  }
  const hasNext = index + 1 < segments.length;
  if (hasNext && !isAcceptableSegmentLength(newEndSec, segments[index + 1].range.end)) {
    return { result: BoundaryResult.NextSegmentWillBeTooShort, segments };
  }
  const next = segments.slice();
  next[index] = seg(cur.range.start, newEndSec, cur.transcription, cur.freeTranslation);
  if (hasNext) {
    const n = segments[index + 1];
    next[index + 1] = seg(newEndSec, n.range.end, n.transcription, n.freeTranslation);
  }
  return { result: BoundaryResult.Success, segments: next };
}

/**
 * Clamp a desired drag position for segment `index`'s end boundary to the valid
 * range [start+min, (nextEnd|duration)-min]. Used by the UI so dragging stops at
 * the legal limits rather than being rejected.
 */
export function clampBoundaryPosition(
  segments: readonly AnnotationSegment[],
  index: number,
  desiredSec: number,
  durationSec: number
): number {
  const cur = segments[index];
  const lo = cur.range.start + MIN_SEC;
  const hasNext = index + 1 < segments.length;
  const hi = (hasNext ? segments[index + 1].range.end : durationSec) - (hasNext ? MIN_SEC : 0);
  return Math.min(Math.max(desiredSec, lo), hi);
}

/**
 * Nudge segment `index`'s end boundary by `deltaMs` (±5ms per keystroke). Refuses
 * (returns a non-Success code, original array) if it would go too short or past
 * the media end.
 */
export function nudgeBoundary(
  segments: readonly AnnotationSegment[],
  index: number,
  deltaMs: number,
  durationSec: number
): BoundaryEdit {
  if (index < 0 || index >= segments.length) {
    return { result: BoundaryResult.SegmentNotFound, segments };
  }
  const newEnd = segments[index].range.end + deltaMs / 1000;
  if (newEnd <= 0 || newEnd > durationSec) {
    return { result: BoundaryResult.NextSegmentWillBeTooShort, segments };
  }
  return moveBoundary(segments, index, newEnd);
}

/** Text-join helper mirroring TextTier.JoinSements (%ignore% collapse rules). */
function joinText(
  fromText: string,
  toText: string,
  fromIsLast: boolean,
  fromBeforeTo: boolean
): string {
  let f = (fromText ?? "").trim();
  let tt = (toText ?? "").trim();
  if (f === IGNORE_MARKER) {
    f = "";
  } else if (tt === IGNORE_MARKER && (f.length > 0 || !fromIsLast)) {
    tt = "";
  }
  return fromBeforeTo ? `${f} ${tt}`.trim() : `${tt} ${f}`.trim();
}

/**
 * Delete the segment at `index` (i.e. the boundary at its end). The following
 * segment absorbs its time; its text is joined into the neighbor (next segment,
 * or the previous one when deleting the last). Mirrors RemoveTierSegments.
 */
export function deleteSegment(
  segments: readonly AnnotationSegment[],
  index: number
): BoundaryEdit {
  if (index < 0 || index >= segments.length) {
    return { result: BoundaryResult.SegmentNotFound, segments };
  }
  const removed = segments[index];
  const next = segments.slice();

  const isLast = index === segments.length - 1;

  // Time side: the following segment absorbs the removed time range.
  if (!isLast) {
    const n = segments[index + 1];
    next[index + 1] = seg(removed.range.start, n.range.end, n.transcription, n.freeTranslation);
  }

  // Text side: join into a neighbor (only when more than one segment exists).
  if (segments.length > 1) {
    const joinTo = isLast ? index - 1 : index + 1;
    const target = next[joinTo];
    const mergedTranscription = joinText(
      removed.transcription,
      target.transcription,
      isLast,
      !isLast
    );
    const mergedFreeTranslation = joinText(
      removed.freeTranslation,
      target.freeTranslation,
      isLast,
      !isLast
    );
    next[joinTo] = seg(
      target.range.start,
      target.range.end,
      mergedTranscription,
      mergedFreeTranslation
    );
  }

  next.splice(index, 1);
  return { result: BoundaryResult.Success, segments: next };
}

/**
 * SayMore's end-of-file rule applied on save/OK (SegmenterDlgBase.cs:521-527,
 * step 1 only — text backfill is implicit in our bundled model). If the last
 * segment ends within CLOSE_TO_END_SEC of the media end: extend it to the end
 * when the remaining gap is below the minimum, otherwise append a trailing
 * ignored segment.
 */
export function addFinalSegmentIfAlmostComplete(
  segments: readonly AnnotationSegment[],
  durationSec: number
): readonly AnnotationSegment[] {
  if (segments.length === 0) return segments;
  const last = segments[segments.length - 1];
  if (msEquals(last.range.end, durationSec)) return segments;
  const gap = durationSec - last.range.end;
  if (gap > 5) return segments; // CLOSE_TO_END_SEC; larger gap left unsegmented
  const next = segments.slice();
  if (gap * 1000 < MIN_SEGMENT_LENGTH_MS) {
    next[next.length - 1] = seg(
      last.range.start,
      durationSec,
      last.transcription,
      last.freeTranslation
    );
  } else {
    next.push(seg(last.range.end, durationSec, IGNORE_MARKER, ""));
  }
  return next;
}

/**
 * Trim on save (SaveFromSegments): drop segments starting past the media
 * duration; clamp any segment whose end runs past it.
 */
export function trimSegmentsToDuration(
  segments: readonly AnnotationSegment[],
  durationSec: number
): readonly AnnotationSegment[] {
  return segments
    .filter((s) => s.range.start <= durationSec)
    .map((s) =>
      s.range.end > durationSec
        ? seg(s.range.start, durationSec, s.transcription, s.freeTranslation)
        : s
    );
}
