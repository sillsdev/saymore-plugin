import type { AnnotationSegment } from "../model/AnnotationSegment";

/** `Environment.NewLine` on Windows; SayMore writes every export with `WriteLine`. */
export const NEWLINE = "\r\n";

/** Join lines the way a series of `StreamWriter.WriteLine` calls ends: every line, including the last, is terminated. */
export function writeLines(lines: readonly string[]): string {
  return lines.map((l) => l + NEWLINE).join("");
}

/**
 * C# `TimeSpan.FromSeconds(float)` as .NET Framework computes it: the value is a
 * `float` held as a double, then rounded half-up to whole milliseconds.
 */
export function secondsToTimeSpanMs(seconds: number): number {
  const value = Math.fround(seconds);
  return Math.floor(value * 1000 + 0.5);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * C# `TimeSpan.ToString("hh\:mm\:ss<sep>ff")`: hours wrap at 24 and the two
 * fraction digits are the milliseconds truncated (not rounded) to hundredths.
 */
export function formatTimeSpanHundredths(seconds: number, fractionSeparator: "," | "."): string {
  const ms = secondsToTimeSpanMs(seconds);
  const hours = Math.floor(ms / 3_600_000) % 24;
  const minutes = Math.floor(ms / 60_000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}${fractionSeparator}${pad2(hundredths)}`;
}

/** Which of the two text tiers an export reads. */
export type TextTierKind = "transcription" | "freeTranslation";

export function tierText(segment: AnnotationSegment, tier: TextTierKind): string {
  return (tier === "transcription" ? segment.transcription : segment.freeTranslation) ?? "";
}
