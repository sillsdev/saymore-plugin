import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { testDataPath } from "../testData";
import { csFloatToString, parseCsFloat } from "./csFloat";

interface ParityRow {
  input: number;
  float32RoundTrip: number;
  invariant: string;
  deDE: string;
}
const table = JSON.parse(
  readFileSync(testDataPath("csfloat", "csfloat-parity.json"), "utf8")
) as { entries: ParityRow[] };

describe("csFloat net48 parity", () => {
  it.each(table.entries)(
    "csFloatToString($input) === '$invariant'",
    ({ input, invariant }) => {
      expect(csFloatToString(input)).toBe(invariant);
    }
  );

  it.each(table.entries)(
    "parseCsFloat reads '.' and ',' forms of $input to the same token value",
    ({ invariant, deDE }) => {
      // The token is a lossy 7-sig-fig string; parseCsFloat recovers the token's
      // own numeric value (and must treat a comma decimal identically to a dot).
      const tokenValue = Number(invariant);
      expect(parseCsFloat(invariant)).toBe(tokenValue);
      expect(parseCsFloat(deDE)).toBe(tokenValue);
    }
  );

  it("integers get no decimal point", () => {
    expect(csFloatToString(10)).toBe("10");
    expect(csFloatToString(3600)).toBe("3600");
    expect(csFloatToString(0)).toBe("0");
  });
});
