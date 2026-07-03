/**
 * A span of media time in **seconds** (floating point), matching SayMore's
 * internal representation (C# `float` seconds; EAF stores integer ms, but the
 * model and the oral-annotation WAV filenames work in seconds).
 *
 * Ranges are treated as [start, end). All values are seconds unless a name ends
 * in `Ms`.
 */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export function makeTimeRange(start: number, end: number): TimeRange {
  return { start, end };
}

export function rangeLength(r: TimeRange): number {
  return r.end - r.start;
}

export function rangeLengthMs(r: TimeRange): number {
  return (r.end - r.start) * 1000;
}

/** True if `seconds` falls within [start, end). */
export function rangeContains(r: TimeRange, seconds: number): boolean {
  return seconds >= r.start && seconds < r.end;
}

export function secondsToMs(seconds: number): number {
  // EAF TIME_VALUE is an integer millisecond (round(sec × 1000)).
  return Math.round(seconds * 1000);
}

export function msToSeconds(ms: number): number {
  return ms / 1000;
}
