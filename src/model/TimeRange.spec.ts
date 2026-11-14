import { describe, it, expect } from "vitest";
import { roundToWholeMs, secondsToMs } from "./TimeRange";
import { csFloatToString } from "../fs/csFloat";

/** What a reload produces for a boundary that was saved as TIME_VALUE. */
function reloadedFromEaf(seconds: number): number {
  const timeValue = String(secondsToMs(seconds)); // as written to the eaf
  return Number(timeValue) / 1000; // as EafDocument reads it back
}

describe("roundToWholeMs", () => {
  it("rounds to the nearest whole millisecond", () => {
    expect(roundToWholeMs(1.006053)).toBe(1.006);
    expect(roundToWholeMs(1.0065)).toBe(1.007);
    expect(roundToWholeMs(2.3456789)).toBe(2.346);
    expect(roundToWholeMs(0)).toBe(0);
    expect(roundToWholeMs(5)).toBe(5);
  });

  it("is idempotent", () => {
    for (const v of [0.123, 1.006, 3.4567, 59.9999, 3599.0004]) {
      const once = roundToWholeMs(v);
      expect(roundToWholeMs(once)).toBe(once);
    }
  });

  it("gives exactly the value, and the WAV-name token, that an eaf reload gives", () => {
    // A sweep of unrounded playhead-like positions, including hour-long media.
    for (let i = 0; i < 2000; i++) {
      const v = i * 1.8133457 + (i % 7) * 0.0001234;
      const rounded = roundToWholeMs(v);
      const reloaded = reloadedFromEaf(v);
      expect(rounded).toBe(reloaded);
      expect(csFloatToString(rounded)).toBe(csFloatToString(reloaded));
    }
  });
});
