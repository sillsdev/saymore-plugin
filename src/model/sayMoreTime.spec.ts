import { describe, expect, it } from "vitest";
import { sayMoreRangeText, sayMoreTimeDisplay, sayMoreTimeString } from "./sayMoreTime";
import { makeTimeRange } from "./TimeRange";

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

describe("the segmenter's and oral annotations viewer's time readout (MediaPlayerViewModel.GetTimeDisplay)", () => {
  it("shows the current time over the total, each as MakeTimeString makes it", () => {
    expect(sayMoreTimeDisplay(65.3, 483.5)).toBe("01:05.3 / 08:03.5");
    expect(sayMoreTimeDisplay(0, 2.9)).toBe("00.0 / 02.9");
  });
  it("clamps a current time past the end to the total", () => {
    expect(sayMoreTimeDisplay(10, 8.2)).toBe("08.2 / 08.2");
  });
  it("matches SayMore's zero-padded one-decimal readout", () => {
    expect(sayMoreTimeDisplay(2.6, 16.8)).toBe("02.6 / 16.8");
  });
  it("pads single-digit seconds with a leading zero", () => {
    expect(sayMoreTimeDisplay(0, 5.2)).toBe("00.0 / 05.2");
  });
  it("shows minutes from 60 seconds on, as SayMore does", () => {
    expect(sayMoreTimeDisplay(12.3, 123.4)).toBe("12.3 / 02:03.4");
  });
  it("clamps negative positions to 0", () => {
    expect(sayMoreTimeDisplay(-1, 10)).toBe("00.0 / 10.0");
  });
});

describe("sayMoreRangeText (TimeRange.ToString)", () => {
  it("shows the start and end", () => {
    expect(sayMoreRangeText(makeTimeRange(2.1, 4.6))).toBe("02.1 - 04.6");
  });
});
