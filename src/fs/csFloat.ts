/**
 * C# .NET Framework 4.8 `Single.ToString()` parity, the top on-disk
 * compatibility risk (plan Risk #1). SayMore names oral-annotation WAVs with
 * `string.Format("{0}_to_{1}{2}", (float)startSec, (float)endSec, suffix)` under
 * the current culture. net48's default float formatting emits ~7 significant
 * figures (legacy "G7"), which differs from modern shortest-round-trip output.
 *
 * Rule (validated against test-data/csfloat/csfloat-parity.json): round the
 * float32 value to 7 significant figures, then trim trailing zeros and any
 * trailing decimal point (integers get no decimal). We always WRITE the
 * invariant (`.`) form; the scanner tolerates `,` decimals on READ.
 */

/** Format a number as net48 invariant `Single.ToString()` would. */
export function csFloatToString(value: number): string {
  const f = Math.fround(value);
  if (!Number.isFinite(f)) return String(f);
  if (f === 0) return "0";

  let s = f.toPrecision(7);

  // toPrecision may emit exponential notation for extreme magnitudes; segment
  // times never reach that range, but expand defensively via the number's own
  // decimal form.
  if (s.includes("e") || s.includes("E")) {
    s = f.toString();
    return s;
  }

  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/** Parse a filename time token that may use `.` or `,` as the decimal mark. */
export function parseCsFloat(token: string): number {
  return Number(token.trim().replace(",", "."));
}

/** The canonical (invariant, float32-rounded) token for a value. */
export function canonicalToken(value: number): string {
  return csFloatToString(value);
}
