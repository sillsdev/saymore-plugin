import { t } from "../../l10n";
import { sayMoreRangeText } from "../../model/sayMoreTime";
import type { TimeRange } from "../../model/TimeRange";

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
