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
  it("a selected .eaf → one default Annotations tab", () => {
    expect(
      computeTabs({
        extension: "eaf",
        lametaType: "Unknown",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([{ id: "annotations", label: "Annotations", claimDefault: true }]);
  });

  it("a .oralAnnotations.wav → one default Oral Annotations tab (before the audio rules)", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: false,
        isOralAnnotations: true,
      }),
    ).toEqual([{ id: "oral-annotations", label: "Oral Annotations", claimDefault: true }]);
  });

  it("audio with no .eaf → one Start Annotating tab (not default)", () => {
    expect(
      computeTabs({
        extension: "wav",
        lametaType: "Audio",
        hasAnnotationsEaf: false,
        isOralAnnotations: false,
      }),
    ).toEqual([{ id: "start", label: "SayMore: Start Annotating" }]);
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

describe("resolveSaymoreTabs (live companion check)", () => {
  it("audio: checks <media>.annotations.eaf and returns the button when absent", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), { exists });
    expect(exists).toHaveBeenCalledWith("new.wav.annotations.eaf");
    expect(tabs).toEqual([{ id: "start", label: "SayMore: Start Annotating" }]);
  });

  it("audio: returns no tab when the .eaf already exists", async () => {
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), { exists: async () => true });
    expect(tabs).toEqual([]);
  });

  it("a .oralAnnotations.wav → Oral Annotations tab, without touching companions", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.oralAnnotations.wav", extension: "wav", lametaType: "Audio" }),
      { exists },
    );
    expect(exists).not.toHaveBeenCalled();
    expect(tabs).toEqual([
      { id: "oral-annotations", label: "Oral Annotations", claimDefault: true },
    ]);
  });

  it("a selected .eaf → Annotations tab, without touching companions", async () => {
    const exists = vi.fn(async () => false);
    const tabs = await resolveSaymoreTabs(
      query({ name: "new.wav.annotations.eaf", extension: "eaf", lametaType: "Unknown" }),
      { exists },
    );
    expect(exists).not.toHaveBeenCalled();
    expect(tabs).toEqual([{ id: "annotations", label: "Annotations", claimDefault: true }]);
  });

  it("a companions.exists failure is treated as absent (returns the button)", async () => {
    const tabs = await resolveSaymoreTabs(query({ name: "new.wav" }), {
      exists: async () => {
        throw new Error("host down");
      },
    });
    expect(tabs).toEqual([{ id: "start", label: "SayMore: Start Annotating" }]);
  });
});
