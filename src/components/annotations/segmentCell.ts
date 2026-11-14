import { t } from "../../l10n";
import type { TimeRange } from "../../model/TimeRange";

/** SayMore's `MediaPlayerViewModel.MakeTimeString`: "00.0", "02.1", "01:05.3", "01:02:05.5". */
export function sayMoreTimeString(seconds: number): string {
  if (seconds === 0) return "00.0";
  const tenths = Math.round(Math.abs(seconds) * 10);
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  // TimeSpan.ToString() is hh:mm:ss[.fffffff]; SayMore drops each leading "00:".
  let text = `${two(h)}:${two(m)}:${two(s)}`;
  while (text.startsWith("00:")) text = text.slice(3);
  return `${text}.${fraction}`;
}

/** SayMore's `TimeRange.ToString()`: "02.1 - 04.6". */
export function sayMoreRangeText(range: TimeRange): string {
  const start = Math.min(range.start, range.end);
  return t("grid.timeRange", "{start} - {end}", {
    start: sayMoreTimeString(start),
    end: sayMoreTimeString(range.end),
  });
}

/**
 * The tooltip of a row's first cell (SayMore `AudioWaveFormCell.SetToolTipText`):
 * the segment's time range, and on the current row how to play it.
 */
export function segmentTooltip(range: TimeRange, isCurrentRow: boolean): string {
  const text = sayMoreRangeText(range);
  return isCurrentRow
    ? t("grid.segmentTooltip", "Segment range: {range}\nPress {key} to Play/Pause", {
        range: text,
        key: "F2",
      })
    : text;
}

/**
 * How much of the current row's first cell the playback fill covers, 0 to 1
 * (SayMore `TextAnnotationEditorGrid.DrawPlaybackProgressBar`): the playback
 * position within the segment over the segment's length rounded to a tenth of a
 * second. There is no fill unless the row's playback is in progress (playing or
 * paused), at position 0, or while an oral recording plays instead of the source.
 */
export function playbackFillFraction(
  playback: { positionSec: number; clipUrl: string | undefined; inProgress: boolean },
  range: TimeRange,
): number {
  if (!playback.inProgress || playback.clipUrl !== undefined || playback.positionSec === 0) {
    return 0;
  }
  const elapsed = playback.positionSec - range.start;
  if (elapsed <= 0) return 0;
  const length = Math.round((range.end - range.start) * 10) / 10;
  if (length <= 0) return 1;
  return Math.min(1, elapsed / length);
}
