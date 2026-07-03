import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { testDataPath } from "./testData";

// Proves the fixture corpus is present and loadable, and that the net48 parity
// table parses. Also a worked example for tracks needing fixtures.
describe("test-data fixtures", () => {
  it("has the real EAF, template, media, and ELAN interpolation case", () => {
    for (const p of [
      "annotationTemplate.etf",
      "real-eaf/test.eaf",
      "media/shortSound.wav",
      "media/longerSound.wav",
      "elan-authored/regular-annotations.eaf",
      "session/longerSound.wav",
      "session/longerSound.wav.annotations.eaf",
    ]) {
      expect(existsSync(testDataPath(p)), p).toBe(true);
    }
  });

  it("has oral-annotation WAVs named with net48 C#-float tokens", () => {
    for (const name of [
      "0.75_to_1.25_Careful.wav",
      "1.25_to_2.121_Careful.wav",
      "1.25_to_2.121_Translation.wav",
    ]) {
      expect(existsSync(testDataPath("session/longerSound.wav_Annotations", name)), name).toBe(
        true,
      );
    }
  });

  it("parses the C#-float parity table with the key net48 discriminator", () => {
    const table = JSON.parse(readFileSync(testDataPath("csfloat/csfloat-parity.json"), "utf8"));
    expect(table.entries.length).toBeGreaterThan(10);
    expect(table.suffixes.careful).toBe("_Careful.wav");

    // 1/3 -> float32 0.333333343; net48 formats it as "0.3333333" (7 sig figs),
    // NOT the modern shortest-round-trip "0.33333334". This is the value that
    // proves the table is genuine net48 output and pins the csFloat.ts contract.
    const oneThird = table.entries.find(
      (e: { float32RoundTrip: number }) => Math.abs(e.float32RoundTrip - 0.333333343) < 1e-9,
    );
    expect(oneThird?.invariant).toBe("0.3333333");
    expect(oneThird?.deDE).toBe("0,3333333");
  });
});
