import { describe, expect, it } from "vitest";
import { computeCompanionAllowlist, standardAudioNameFor } from "./companionAllowlist";

describe("computeCompanionAllowlist", () => {
  describe("selected file is non-WAV media (F + S families)", () => {
    const a = computeCompanionAllowlist("ETR009.mp3");

    it("derives the _StandardAudio.wav sibling", () => {
      expect(standardAudioNameFor("ETR009.mp3")).toBe("ETR009_StandardAudio.wav");
    });

    it("allows both families' annotation eaf + prefs (both spellings)", () => {
      for (const p of [
        "ETR009.mp3.annotations.eaf",
        "ETR009.mp3.annotations.pfsx",
        "ETR009.mp3.annotations.psfx",
        "ETR009.mp3.oralAnnotations.wav",
        "ETR009_StandardAudio.wav.annotations.eaf",
        "ETR009_StandardAudio.wav.annotations.psfx",
        "ETR009_StandardAudio.wav.oralAnnotations.wav",
      ]) {
        expect(a.isAllowed(p)).toBe(true);
      }
    });

    it("allows the _StandardAudio.wav conversion itself but NOT the selected file", () => {
      expect(a.isAllowed("ETR009_StandardAudio.wav")).toBe(true);
      expect(a.isAllowed("ETR009.mp3")).toBe(false); // the media is not a companion
    });

    it("allows one-level .wav files inside either _Annotations folder", () => {
      expect(a.isAllowed("ETR009.mp3_Annotations/0.5_to_1.25_Careful.wav")).toBe(true);
      expect(a.isAllowed("ETR009_StandardAudio.wav_Annotations/0.5_to_1.25_Translation.wav")).toBe(
        true,
      );
      expect(a.annotationDirs).toContain("ETR009.mp3_Annotations");
    });

    it("rejects deeper nesting, non-wav companions, and traversal", () => {
      expect(a.isAllowed("ETR009.mp3_Annotations/sub/x.wav")).toBe(false);
      expect(a.isAllowed("ETR009.mp3_Annotations/notes.txt")).toBe(false);
      expect(a.isAllowed("../secret.eaf")).toBe(false);
      expect(a.isAllowed("/etc/passwd")).toBe(false);
      expect(a.isAllowed("C:/Windows/system.ini")).toBe(false);
      expect(a.isAllowed("OtherFile.annotations.eaf")).toBe(false);
    });
  });

  describe("selected file is a WAV", () => {
    const a = computeCompanionAllowlist("recording.wav");

    it("allows its own eaf and its (derived) StandardAudio sibling family", () => {
      // The host derives S = <F without ext>_StandardAudio.wav regardless of F's
      // type, so both families' _Annotations dirs are allowed; we mirror that
      // rather than being stricter than the host.
      expect(a.annotationDirs).toEqual([
        "recording.wav_Annotations",
        "recording_StandardAudio.wav_Annotations",
      ]);
      expect(a.isAllowed("recording.wav.annotations.eaf")).toBe(true);
      expect(a.isAllowed("recording_StandardAudio.wav.annotations.eaf")).toBe(true);
    });
  });

  describe("selected file already is the _StandardAudio.wav conversion", () => {
    const a = computeCompanionAllowlist("clip_StandardAudio.wav");

    it("allows its own family (matching the host's literal S derivation)", () => {
      expect(a.isAllowed("clip_StandardAudio.wav.annotations.eaf")).toBe(true);
      expect(a.isAllowed("clip_StandardAudio.wav_Annotations/0_to_1_Careful.wav")).toBe(true);
      expect(a.isAllowed("SomethingElse.wav.annotations.eaf")).toBe(false);
    });
  });

  it("matches case-insensitively and tolerates backslashes", () => {
    const a = computeCompanionAllowlist("Rec.WAV");
    expect(a.isAllowed("rec.wav.ANNOTATIONS.eaf")).toBe(true);
    expect(a.isAllowed("Rec.WAV_Annotations\\0_to_1_Careful.wav")).toBe(true);
  });
});
