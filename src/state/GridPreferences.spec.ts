import { describe, expect, it } from "vitest";
import { GridPreferences, type PreferenceStorage } from "./GridPreferences";

function memoryStorage(): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("GridPreferences", () => {
  it("defaults to SayMore's choices", () => {
    const prefs = new GridPreferences(undefined);
    expect(prefs.speedPercent).toBe(100);
    expect(prefs.transcriptionPlayback).toBe("source");
    expect(prefs.translationPlayback).toBe("translation");
  });

  it("remembers speed and column options across instances", () => {
    const storage = memoryStorage();
    const a = new GridPreferences(storage);
    a.setSpeedPercent(40);
    a.setTranscriptionPlayback("both");
    a.setTranslationPlayback("source");
    const b = new GridPreferences(storage);
    expect(b.speedPercent).toBe(40);
    expect(b.rate).toBeCloseTo(0.4);
    expect(b.transcriptionPlayback).toBe("both");
    expect(b.translationPlayback).toBe("source");
  });

  it("ignores speeds outside 10%–100% and unknown stored values", () => {
    const storage = memoryStorage();
    storage.data.set("grid.playbackSpeedPercent", "250");
    storage.data.set("grid.transcriptionPlayback", "bogus");
    const prefs = new GridPreferences(storage);
    expect(prefs.speedPercent).toBe(100);
    expect(prefs.transcriptionPlayback).toBe("source");
    prefs.setSpeedPercent(5);
    expect(prefs.speedPercent).toBe(100);
  });

  it("keeps working when storage throws", () => {
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const prefs = new GridPreferences(throwing);
    prefs.setSpeedPercent(50);
    expect(prefs.speedPercent).toBe(50);
  });
});
