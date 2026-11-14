import { describe, expect, it } from "vitest";
import { makeTimeRange } from "../../model/TimeRange";
import { DEFAULT_ROW_HEIGHT, gridFontStyle, gridRowHeight, quoteFamily } from "./gridFontStyle";
import {
  playbackFillFraction,
  sayMoreRangeText,
  sayMoreTimeString,
  segmentTooltip,
} from "./segmentCell";

describe("sayMoreTimeString (MediaPlayerViewModel.MakeTimeString)", () => {
  it("formats as SayMore does", () => {
    expect(sayMoreTimeString(0)).toBe("00.0");
    expect(sayMoreTimeString(2.1)).toBe("02.1");
    expect(sayMoreTimeString(2)).toBe("02.0");
    expect(sayMoreTimeString(2.04)).toBe("02.0");
    expect(sayMoreTimeString(2.05)).toBe("02.1");
    expect(sayMoreTimeString(65.3)).toBe("01:05.3");
    expect(sayMoreTimeString(3725.5)).toBe("01:02:05.5");
    expect(sayMoreTimeString(59.96)).toBe("01:00.0");
  });
});

describe("the first cell's tooltip (AudioWaveFormCell.SetToolTipText)", () => {
  const range = makeTimeRange(2.1, 4.6);
  it("is the time range on other rows", () => {
    expect(sayMoreRangeText(range)).toBe("02.1 - 04.6");
    expect(segmentTooltip(range, false)).toBe("02.1 - 04.6");
  });
  it("adds how to play on the current row", () => {
    expect(segmentTooltip(range, true)).toBe("Segment range: 02.1 - 04.6\nPress F2 to Play/Pause");
  });
});

describe("playbackFillFraction (DrawPlaybackProgressBar)", () => {
  const range = makeTimeRange(10, 12);
  const at = (
    positionSec: number,
    extra: Partial<Parameters<typeof playbackFillFraction>[0]> = {},
  ) => playbackFillFraction({ positionSec, clipUrl: undefined, inProgress: true, ...extra }, range);

  it("grows with the position within the segment", () => {
    expect(at(10)).toBe(0);
    expect(at(10.5)).toBeCloseTo(0.25);
    expect(at(11)).toBeCloseTo(0.5);
    expect(at(12)).toBe(1);
    expect(at(12.02)).toBe(1);
  });

  it("divides by the length rounded to a tenth of a second", () => {
    const short = makeTimeRange(0, 0.96);
    expect(
      playbackFillFraction({ positionSec: 0.5, clipUrl: undefined, inProgress: true }, short),
    ).toBeCloseTo(0.5);
  });

  it("is empty unless the row's playback is in progress, at position 0, or while a recording plays", () => {
    expect(at(11, { inProgress: false })).toBe(0);
    expect(at(0)).toBe(0);
    expect(at(11, { clipUrl: "blob:careful" })).toBe(0);
    expect(at(9)).toBe(0);
  });
});

describe("grid fonts", () => {
  it("styles a cell with the column font, falling back to the grid's font", () => {
    expect(gridFontStyle(undefined)).toEqual({});
    const style = gridFontStyle({ family: "Charis SIL", sizePt: 14, bold: true });
    expect(style.fontFamily?.startsWith('"Charis SIL", ')).toBe(true);
    expect(style).toMatchObject({ fontSize: "14pt", fontWeight: 700, fontStyle: "normal" });
    expect(gridFontStyle({ family: "A", sizePt: 9, italic: true }).fontStyle).toBe("italic");
  });

  it("quotes family names safely", () => {
    expect(quoteFamily('Bad"Name\\')).toBe('"Bad\\"Name\\\\"');
  });

  it("rows grow for large fonts and never shrink below the default", () => {
    expect(gridRowHeight([undefined, undefined])).toBe(DEFAULT_ROW_HEIGHT);
    expect(gridRowHeight([{ family: "A", sizePt: 8 }, undefined])).toBe(DEFAULT_ROW_HEIGHT);
    const big = gridRowHeight([
      { family: "A", sizePt: 10 },
      { family: "B", sizePt: 36 },
    ]);
    expect(big).toBeGreaterThanOrEqual(Math.ceil(36 * (96 / 72)));
  });
});
