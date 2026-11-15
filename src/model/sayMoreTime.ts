import { t } from "../l10n";
import type { TimeRange } from "./TimeRange";

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

/**
 * SayMore's `MediaPlayerViewModel.GetTimeDisplay`, the readout of its segmenter and its oral
 * annotation editor: "01:05.3 / 08:03.5", with the position kept between 0 and the total.
 */
export function sayMoreTimeDisplay(positionSec: number, totalSec: number): string {
  return t("media.timeDisplay", "{current} / {total}", {
    current: sayMoreTimeString(Math.min(Math.max(positionSec, 0), totalSec)),
    total: sayMoreTimeString(totalSec),
  });
}

/** SayMore's `TimeRange.ToString()`: "02.1 - 04.6". */
export function sayMoreRangeText(range: TimeRange): string {
  const start = Math.min(range.start, range.end);
  return t("grid.timeRange", "{start} - {end}", {
    start: sayMoreTimeString(start),
    end: sayMoreTimeString(range.end),
  });
}
