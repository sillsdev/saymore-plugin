import { describe, expect, it, vi } from "vitest";
import type { PluginHostApiV1 } from "./PluginApiTypes";
import { convertToStandardAudio } from "./standardAudio";
import { computeTabs, START_TAB_ID } from "./tabProvider";

function fakeApi(selectResult: boolean) {
  const selectFile = vi.fn(async (_relPath: string, _options?: { tabId?: string }) => selectResult);
  const run = vi.fn(async (spec: { onProgress?: (fraction: number) => void }) => {
    spec.onProgress?.(1);
  });
  const api = { selectFile, ffmpeg: { run, probe: vi.fn() } } as unknown as PluginHostApiV1;
  return { api, selectFile, run };
}

describe("standard audio conversion", () => {
  it("converts, then selects the new WAV on its Start Annotating tab", async () => {
    const { api, selectFile, run } = fakeApi(true);
    const progress: number[] = [];
    const wav = await convertToStandardAudio(api, "ETR009.mp3", (f) => progress.push(f));
    expect(wav).toBe("ETR009_StandardAudio.wav");
    expect(run.mock.calls[0][0]).toMatchObject({ outputRelPath: "ETR009_StandardAudio.wav" });
    expect(progress).toEqual([1]);
    expect(selectFile).toHaveBeenCalledWith("ETR009_StandardAudio.wav", { tabId: START_TAB_ID });
  });

  it("the tab id is the one the provider returns for a WAV with no annotations", () => {
    const tabs = computeTabs({
      extension: "wav",
      lametaType: "Audio",
      hasAnnotationsEaf: false,
      isOralAnnotations: false,
    });
    expect(tabs.map((tab) => tab.id)).toEqual([START_TAB_ID]);
  });

  it("throws when lameta cannot select the WAV", async () => {
    const { api } = fakeApi(false);
    await expect(convertToStandardAudio(api, "a.mp4", () => {})).rejects.toThrow(
      "a_StandardAudio.wav",
    );
  });
});
