// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginHostApiV1 } from "../plugin/PluginApiTypes";
import { deliverExportBytes, deliverExportFile, deliveryNotice } from "./deliverExportFile";
import {
  audioExportSave,
  AUDACITY_EXPORT_FOLDER_KEY,
  buildExport,
  CAREFUL_SPEECH_EXPORT_FOLDER_KEY,
  EXPORT_FORMATS,
  type ExportContext,
  type ExportFormatId,
  FLEX_EXPORT_FOLDER_KEY,
  GENERAL_EXPORT_FOLDER_KEY,
  ORAL_TRANSLATION_EXPORT_FOLDER_KEY,
  TOOLBOX_EXPORT_FOLDER_KEY,
} from "./exportFormats";

const ctx: ExportContext = {
  sessionId: "ETR009",
  mediaFileName: "ETR009.wav",
  mediaFilePath: "ETR009.wav",
};
const segments = [{ range: { start: 0, end: 1 }, transcription: "one", freeTranslation: "un" }];
const flex = { transcriptionWs: "etr", freeTranslationWs: "en" };

function fakeApi(result: { saved: boolean; fileName?: string }) {
  const saveFile = vi.fn(
    async (
      _name: string,
      _bytes: ArrayBuffer | ArrayBufferView,
      _options?: { filters?: { name: string; extensions: string[] }[]; rememberFolderKey?: string },
    ) => result,
  );
  return { api: { saveFile } as unknown as PluginHostApiV1, saveFile };
}

describe("deliverExportFile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves through lameta's Save dialog with SayMore's file name, the format's filters and folder key", async () => {
    const { api, saveFile } = fakeApi({ saved: true, fileName: "mine.srt" });
    const file = buildExport("srtTranscription", segments, ctx);
    const delivery = await deliverExportFile(file, api);
    expect(delivery).toEqual({ kind: "saved", fileName: "mine.srt" });
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [name, bytes, options] = saveFile.mock.calls[0];
    expect(name).toBe("ETR009_transcription_subtitle.srt");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(file.text);
    expect(options).toEqual({
      rememberFolderKey: GENERAL_EXPORT_FOLDER_KEY,
      filters: [{ name: "SRT Subtitle File", extensions: ["srt"] }],
    });
  });

  it("writes the UTF-8 byte order mark first when the format has one", async () => {
    const { api, saveFile } = fakeApi({ saved: true, fileName: "x.flextext" });
    const file = buildExport("flexInterlinear", segments, ctx, flex);
    expect(file.bom).toBe(true);
    await deliverExportFile(file, api);
    const bytes = saveFile.mock.calls[0][1] as Uint8Array;
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(file.text);
  });

  it("reports a cancelled Save dialog as cancelled, with no notice", async () => {
    const { api } = fakeApi({ saved: false });
    const delivery = await deliverExportFile(buildExport("csv", segments, ctx), api);
    expect(delivery).toEqual({ kind: "cancelled" });
    expect(deliveryNotice(delivery)).toBeUndefined();
  });

  it("names the saved file in the notice", () => {
    expect(deliveryNotice({ kind: "saved", fileName: "a.csv" })).toBe("Saved a.csv.");
    expect(deliveryNotice({ kind: "downloaded", fileName: "a.csv" })).toBeUndefined();
  });

  it("falls back to a browser download without a host", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const delivery = await deliverExportFile(buildExport("plainText", segments, ctx), undefined);
    expect(delivery).toEqual({ kind: "downloaded", fileName: "ETR009_transcription.txt" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("propagates a host error so the menu can show it", async () => {
    const api = {
      saveFile: async () => {
        throw new Error("disk full");
      },
    } as unknown as PluginHostApiV1;
    await expect(
      deliverExportBytes(
        "a.wav",
        new Uint8Array(1),
        "audio/wav",
        audioExportSave("Careful", "wav"),
        api,
      ),
    ).rejects.toThrow("disk full");
  });
});

describe("the Save dialog per export kind follows SayMore's remembered folders", () => {
  const expected: Record<ExportFormatId, { key: string; extensions: string[][] }> = {
    audacityFreeTranslation: { key: AUDACITY_EXPORT_FOLDER_KEY, extensions: [["txt"]] },
    audacityTranscription: { key: AUDACITY_EXPORT_FOLDER_KEY, extensions: [["txt"]] },
    flexInterlinear: { key: FLEX_EXPORT_FOLDER_KEY, extensions: [["flextext"], ["*"]] },
    plainText: { key: GENERAL_EXPORT_FOLDER_KEY, extensions: [["txt"]] },
    srtFreeTranslation: { key: GENERAL_EXPORT_FOLDER_KEY, extensions: [["srt"]] },
    srtTranscription: { key: GENERAL_EXPORT_FOLDER_KEY, extensions: [["srt"]] },
    csv: { key: GENERAL_EXPORT_FOLDER_KEY, extensions: [["csv"]] },
    toolbox: { key: TOOLBOX_EXPORT_FOLDER_KEY, extensions: [["txt"]] },
  };

  for (const format of EXPORT_FORMATS) {
    it(format.id, () => {
      const file = buildExport(format.id, segments, ctx, flex);
      expect(file.save.rememberFolderKey).toBe(expected[format.id].key);
      expect(file.save.filters.map((f) => f.extensions)).toEqual(expected[format.id].extensions);
      // The suggested name carries the first filter's extension.
      const ext = file.fileName.slice(file.fileName.lastIndexOf(".") + 1);
      expect(file.save.filters[0].extensions).toContain(ext);
    });
  }

  it("the audio exports each remember their own folder, with the delivered extension", () => {
    expect(audioExportSave("Careful", "mp3")).toEqual({
      rememberFolderKey: CAREFUL_SPEECH_EXPORT_FOLDER_KEY,
      filters: [{ name: "Careful Speech File", extensions: ["mp3"] }],
    });
    expect(audioExportSave("Translation", "wav")).toEqual({
      rememberFolderKey: ORAL_TRANSLATION_EXPORT_FOLDER_KEY,
      filters: [{ name: "Oral Translation File", extensions: ["wav"] }],
    });
  });

  it("every key is one lameta accepts", () => {
    const keys = [
      GENERAL_EXPORT_FOLDER_KEY,
      AUDACITY_EXPORT_FOLDER_KEY,
      TOOLBOX_EXPORT_FOLDER_KEY,
      FLEX_EXPORT_FOLDER_KEY,
      CAREFUL_SPEECH_EXPORT_FOLDER_KEY,
      ORAL_TRANSLATION_EXPORT_FOLDER_KEY,
    ];
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
  });
});
