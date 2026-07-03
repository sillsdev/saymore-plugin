import { describe, it, expect } from "vitest";
import { findMediaFile, annotationsEafName, SessionFolder } from "./SessionFolder";
import { InMemoryAdapter } from "./InMemoryAdapter";

describe("findMediaFile", () => {
  it("prefers *_StandardAudio.wav", () => {
    const names = ["recording.mp4", "recording_StandardAudio.wav", "recording.mp4.annotations.eaf"];
    expect(findMediaFile(names)).toBe("recording_StandardAudio.wav");
  });

  it("falls back to the lone audio file, ignoring eaf and nested annotations", () => {
    const names = [
      "longerSound.wav",
      "longerSound.wav.annotations.eaf",
      "longerSound.wav_Annotations/0.75_to_1.25_Careful.wav",
    ];
    expect(findMediaFile(names)).toBe("longerSound.wav");
  });

  it("prefers audio over video when no standard audio exists", () => {
    expect(findMediaFile(["clip.mp4", "clip.wav"])).toBe("clip.wav");
  });

  it("returns undefined when there is no media", () => {
    expect(findMediaFile(["notes.txt", "x.annotations.eaf"])).toBeUndefined();
  });
});

describe("SessionFolder", () => {
  it("derives eaf + annotations folder names and opens over an adapter", async () => {
    const a = new InMemoryAdapter({
      "longerSound.wav": new Uint8Array([1]),
      "longerSound.wav.annotations.eaf": "<xml/>",
    });
    const session = await SessionFolder.open(a);
    expect(session?.mediaFileName).toBe("longerSound.wav");
    expect(session?.eafName).toBe("longerSound.wav.annotations.eaf");
    expect(annotationsEafName("longerSound.wav")).toBe("longerSound.wav.annotations.eaf");
    expect(session?.oralAnnotationsFolder).toBe("longerSound.wav_Annotations");
    expect(await session?.hasEaf(a)).toBe(true);
    expect(await session?.loadEafText(a)).toBe("<xml/>");
  });
});
