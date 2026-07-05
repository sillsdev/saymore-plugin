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

const EAF_WITH_SEGMENT =
  '<ANNOTATION_DOCUMENT><ALIGNABLE_ANNOTATION ANNOTATION_ID="a1"/></ANNOTATION_DOCUMENT>';
const EAF_EMPTY = "<ANNOTATION_DOCUMENT></ANNOTATION_DOCUMENT>";

describe("computeTabs (pure policy)", () => {
  it("a segmented .eaf → Transcription & Translation (default) + Segments", () => {
    expect(
      computeTabs({
        extension: "eaf",
        lametaType: "Unknown",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
        eafHasSegments: true,
      }),
    ).toEqual([
      {
        id: "transcription-translation",
        label: "Transcription & Translation",
        claimDefault: true,
      },
      { id: "segments", label: "Segments", claimDefault: false },
    ]);
  });

  it("an EMPTY .eaf → the Segments tab claims default (nothing to transcribe yet)", () => {
    const tabs = computeTabs({
      extension: "eaf",
      lametaType: "Unknown",
      hasAnnotationsEaf: false,
      isOralAnnotations: false,
      eafHasSegments: false,
    });
    expect(tabs.map((t) => [t.id, t.claimDefault])).toEqual([
      ["transcription-translation", false],
      ["segments", true],
    ]);
  });

  it("a .oralAnnotations.wav → the two recorders + Combined Audio (before the audio rules)", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: false,
        isOralAnnotations: true,
        eafHasSegments: true,
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
        eafHasSegments: true,
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
        eafHasSegments: true,
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
        eafHasSegments: true,
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
        eafHasSegments: true,
      }),
    ).toEqual([]);
  });
});

describe("resolveSaymoreTabs (live companion checks)", () => {
  const noCompanions = {
    exists: vi.fn(async () => false),
    readText: vi.fn(async () => ""),
  };

  it("audio: checks <media>.annotations.eaf and returns the button when absent", async () => {
    const exists = vi.fn(async () => false);
    const readText = vi.fn(async () => "");
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), { exists, readText });
    expect(exists).toHaveBeenCalledWith("new.wav.annotations.eaf");
    expect(readText).not.toHaveBeenCalled();
    expect(tabs).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("video: checks <media>.annotations.eaf and returns the Start Annotating tab when absent", async () => {
    const exists = vi.fn(async () => false);
    const readText = vi.fn(async () => "");
    const tabs = await resolveSaymoreTabs(
      query({ name: "clip.mp4", extension: "mp4", lametaType: "Video" }),
      { exists, readText },
    );
    expect(exists).toHaveBeenCalledWith("clip.mp4.annotations.eaf");
    expect(tabs).toEqual([{ id: "start", label: "Start Annotating" }]);
  });

  it("audio: returns no tab when the .eaf already exists", async () => {
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), {
      ...noCompanions,
      exists: async () => true,
    });
    expect(tabs).toEqual([]);
  });

  it("a .oralAnnotations.wav → recorder + viewer tabs, without touching companions", async () => {
    const exists = vi.fn(async () => false);
    const readText = vi.fn(async () => "");
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.oralAnnotations.wav", extension: "wav", lametaType: "Audio" }),
      { exists, readText },
    );
    expect(exists).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(tabs.map((t) => t.id)).toEqual(["careful-speech", "oral-translation", "combined-audio"]);
  });

  it("a segmented .eaf → grid tab claims default (reads the eaf live)", async () => {
    const readText = vi.fn(async () => EAF_WITH_SEGMENT);
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.annotations.eaf", extension: "eaf", lametaType: "Unknown" }),
      { ...noCompanions, readText },
    );
    expect(readText).toHaveBeenCalledWith("new.wav.annotations.eaf");
    expect(tabs.find((t) => t.claimDefault)?.id).toBe("transcription-translation");
  });

  it("an empty .eaf → Segments tab claims default", async () => {
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.annotations.eaf", extension: "eaf", lametaType: "Unknown" }),
      { ...noCompanions, readText: async () => EAF_EMPTY },
    );
    expect(tabs.find((t) => t.claimDefault)?.id).toBe("segments");
  });

  it("an eaf readText failure falls back to the grid default", async () => {
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.annotations.eaf", extension: "eaf", lametaType: "Unknown" }),
      {
        ...noCompanions,
        readText: async () => {
          throw new Error("host down");
        },
      },
    );
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
