import { describe, it, expect, vi } from "vitest";
import { computeTabs, resolveSaymoreTabs } from "./tabProvider";
import type { TabProviderQuery } from "./PluginApiTypes";

function query(over: Partial<TabProviderQuery["file"]>): TabProviderQuery {
  return {
    file: {
      name: "new.wav",
      extension: "wav",
      mimeType: "audio/x-wav",
      lametaType: "Audio",
      path: "/s/new.wav",
      uri: "file:///s/new.wav",
      ...over,
    },
    folder: { type: "session", directory: "/s" },
  };
}

describe("computeTabs (pure policy)", () => {
  it("a .eaf → a single Transcription & Translation tab (the segmenter is in-pane)", () => {
    expect(
      computeTabs({
        extension: "eaf",
        lametaType: "Unknown",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([
      {
        id: "transcription-translation",
        label: "Transcription & Translation",
        claimDefault: true,
      },
    ]);
  });

  it("a .oralAnnotations.wav → the two recorders + Combined Audio (before the audio rules)", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: false,
        isOralAnnotations: true,
      }),
    ).toEqual([
      { id: "careful-speech", label: "Careful Speech", claimDefault: true },
      { id: "oral-translation", label: "Oral Translation" },
      { id: "combined-audio", label: "Combined Audio" },
    ]);
  });

  it("audio with no .eaf → one Start Annotating tab (not default)", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("video with no .eaf → one Start Annotating tab (conversion happens inside)", () => {
    expect(
      computeTabs({
        extension: "mp4",
        lametaType: "Video",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("audio that already has an .eaf → NO tab", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: true,
        isOralAnnotations: false,
      }),
    ).toEqual([]);
  });

  it("a non-audio, non-eaf file → no tabs", () => {
    expect(
      computeTabs({
        extension: "png",
        lametaType: "Image",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([]);
  });
});

describe("resolveSaymoreTabs (live companion checks)", () => {
  const noCompanions = {
    exists: vi.fn(async () => false),
  };

  it("audio: checks <media>.annotations.eaf and returns the button when absent", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), { exists });
    expect(exists).toHaveBeenCalledWith("new.wav.annotations.eaf");
    expect(tabs).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("video: checks <media>.annotations.eaf and returns the Start Annotating tab when absent", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(
      query({ name: "clip.mp4", extension: "mp4", lametaType: "Video" }),
      { exists },
    );
    expect(exists).toHaveBeenCalledWith("clip.mp4.annotations.eaf");
    expect(tabs).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("audio: returns no tab when the .eaf already exists", async () => {
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), {
      exists: async () => true,
    });
    expect(tabs).toEqual([]);
  });

  it("a .oralAnnotations.wav → recorder + viewer tabs, without touching companions", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.oralAnnotations.wav", extension: "wav", lametaType: "Audio" }),
      { exists },
    );
    expect(exists).not.toHaveBeenCalled();
    expect(tabs.map((t) => t.id)).toEqual(["careful-speech", "oral-translation", "combined-audio"]);
  });

  it("a .eaf → a single grid tab, without touching companions", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.annotations.eaf", extension: "eaf", lametaType: "Unknown" }),
      { exists },
    );
    expect(exists).not.toHaveBeenCalled();
    expect(tabs.map((t) => t.id)).toEqual(["transcription-translation"]);
    expect(tabs.find((t) => t.claimDefault)?.id).toBe("transcription-translation");
  });

  it("a companions.exists failure is treated as absent (returns the button)", async () => {
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), {
      ...noCompanions,
      exists: async () => {
        throw new Error("host down");
      },
    });
    expect(tabs).toEqual([{ id: "start", label: "Start Annotating" }]);
  });
});
