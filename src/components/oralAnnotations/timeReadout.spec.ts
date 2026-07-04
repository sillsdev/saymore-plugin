import { describe, it, expect } from "vitest";
import { formatPosTotal } from "./timeReadout";

describe("formatPosTotal", () => {
  it("matches SayMore's zero-padded one-decimal readout", () => {
    expect(formatPosTotal(2.6, 16.8)).toBe("02.6 / 16.8");
  });

  it("pads single-digit seconds with a leading zero", () => {
    expect(formatPosTotal(0, 5.2)).toBe("00.0 / 05.2");
  });

  it("does not pad once seconds reach two digits", () => {
    expect(formatPosTotal(12.3, 123.4)).toBe("12.3 / 123.4");
  });

  it("clamps negative positions to 0", () => {
    expect(formatPosTotal(-1, 10)).toBe("00.0 / 10.0");
  });
});
