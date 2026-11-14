import { describe, expect, it, vi } from "vitest";
import type { PluginHostApiV1 } from "../plugin/PluginApiTypes";
import {
  GridFonts,
  hostSettingsStorage,
  LOCAL_SETTINGS_KEY,
  localSettingsStorage,
  parseGridFont,
  type SettingsStorage,
} from "./GridFonts";

function memoryStorage(initial: unknown = null) {
  let value: unknown = initial;
  const writes: unknown[] = [];
  const storage: SettingsStorage = {
    read: async () => value,
    write: async (v) => {
      // lameta refuses `undefined` anywhere in the value, so a JSON round trip must not change it.
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      value = v;
      writes.push(v);
    },
  };
  return { storage, writes, current: () => value };
}

describe("parseGridFont", () => {
  it("keeps family, size and the styles that are on", () => {
    expect(
      parseGridFont({ family: " Charis SIL ", sizePt: 14, bold: true, italic: false }),
    ).toEqual({ family: "Charis SIL", sizePt: 14, bold: true });
  });

  it("rejects values that are not fonts", () => {
    for (const bad of [null, "Arial", { family: "", sizePt: 10 }, { family: "A", sizePt: "10" }]) {
      expect(parseGridFont(bad)).toBeUndefined();
    }
    expect(parseGridFont({ family: "A", sizePt: 1000 })).toBeUndefined();
  });
});

describe("GridFonts", () => {
  it("reads both columns' fonts from the stored settings", async () => {
    const { storage } = memoryStorage({
      version: 1,
      transcriptionFont: { family: "Doulos SIL", sizePt: 12 },
      freeTranslationFont: { family: "Andika", sizePt: 11, italic: true },
    });
    const fonts = new GridFonts(storage);
    await fonts.useStorage(storage);
    expect(fonts.font("transcription")).toEqual({ family: "Doulos SIL", sizePt: 12 });
    expect(fonts.font("freeTranslation")).toEqual({ family: "Andika", sizePt: 11, italic: true });
  });

  it("a font chosen while the settings are still being read merges into them and stays", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { storage, current } = memoryStorage({
      version: 1,
      freeTranslationFont: { family: "Andika", sizePt: 11 },
    });
    const slow: SettingsStorage = {
      read: async () => {
        await gate;
        return storage.read();
      },
      write: storage.write,
    };
    const fonts = new GridFonts(memoryStorage().storage);
    const reading = fonts.useStorage(slow);
    const choosing = fonts.setFont("transcription", { family: "Charis SIL", sizePt: 14 });
    release();
    await reading;
    await choosing;
    expect(fonts.font("transcription")).toEqual({ family: "Charis SIL", sizePt: 14 });
    expect(fonts.font("freeTranslation")).toEqual({ family: "Andika", sizePt: 11 });
    expect(current()).toEqual({
      version: 1,
      transcriptionFont: { family: "Charis SIL", sizePt: 14 },
      freeTranslationFont: { family: "Andika", sizePt: 11 },
    });
  });

  it("writes a small versioned value and keeps keys it does not know", async () => {
    const { storage, current } = memoryStorage({ version: 1, other: { x: 1 } });
    const fonts = new GridFonts(storage);
    await fonts.useStorage(storage);
    await fonts.setFont("transcription", { family: "Charis SIL", sizePt: 16 });
    await fonts.setFont("freeTranslation", { family: "Gentium Plus", sizePt: 10, bold: true });
    expect(current()).toEqual({
      version: 1,
      other: { x: 1 },
      transcriptionFont: { family: "Charis SIL", sizePt: 16 },
      freeTranslationFont: { family: "Gentium Plus", sizePt: 10, bold: true },
    });
    await fonts.setFont("transcription", undefined);
    expect(current()).toEqual({
      version: 1,
      other: { x: 1 },
      freeTranslationFont: { family: "Gentium Plus", sizePt: 10, bold: true },
    });
    expect(fonts.transcription).toBeUndefined();
  });

  it("starts from nothing when there are no settings, or they are not an object", async () => {
    for (const stored of [null, [1, 2], "x"]) {
      const { storage, current } = memoryStorage(stored);
      const fonts = new GridFonts(storage);
      await fonts.useStorage(storage);
      expect(fonts.transcription).toBeUndefined();
      await fonts.setFont("freeTranslation", { family: "Andika", sizePt: 12 });
      expect(current()).toEqual({
        version: 1,
        freeTranslationFont: { family: "Andika", sizePt: 12 },
      });
    }
  });

  it("never overwrites settings from a newer version of the plugin", async () => {
    const newer = { version: 2, transcriptionFont: { family: "Andika", sizePt: 12 }, more: true };
    const { storage, writes } = memoryStorage(newer);
    const fonts = new GridFonts(storage);
    await fonts.useStorage(storage);
    expect(fonts.transcription).toEqual({ family: "Andika", sizePt: 12 });
    await fonts.setFont("transcription", { family: "Charis SIL", sizePt: 20 });
    expect(fonts.transcription).toEqual({ family: "Charis SIL", sizePt: 20 });
    expect(writes).toEqual([]);
  });

  it("a later storage wins over a slower earlier read", async () => {
    let release: (v: unknown) => void = () => {};
    const slow: SettingsStorage = {
      read: () => new Promise((resolve) => (release = resolve)),
      write: async () => {},
    };
    const { storage: fast } = memoryStorage({
      version: 1,
      transcriptionFont: { family: "Andika", sizePt: 12 },
    });
    const fonts = new GridFonts(slow);
    const first = fonts.useStorage(slow);
    await fonts.useStorage(fast);
    release({ version: 1, transcriptionFont: { family: "Old", sizePt: 9 } });
    await first;
    expect(fonts.transcription?.family).toBe("Andika");
  });

  it("an unreadable store leaves the default fonts", async () => {
    const failing: SettingsStorage = {
      read: async () => {
        throw new Error("no project open");
      },
      write: async () => {},
    };
    const fonts = new GridFonts(failing);
    await fonts.useStorage(failing);
    expect(fonts.transcription).toBeUndefined();
  });
});

describe("settings storage", () => {
  it("lameta's storage goes through getProjectSettings / setProjectSettings", async () => {
    const getProjectSettings = vi.fn(async () => ({ version: 1 }));
    const setProjectSettings = vi.fn(async () => {});
    const storage = hostSettingsStorage({
      getProjectSettings,
      setProjectSettings,
    } as unknown as PluginHostApiV1);
    expect(await storage.read()).toEqual({ version: 1 });
    await storage.write({ version: 1, transcriptionFont: { family: "A", sizePt: 9 } });
    expect(setProjectSettings).toHaveBeenCalledWith({
      version: 1,
      transcriptionFont: { family: "A", sizePt: 9 },
    });
  });

  it("the harness keeps the settings as JSON in localStorage", async () => {
    const map = new Map<string, string>();
    const storage = localSettingsStorage({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    });
    expect(await storage.read()).toBeNull();
    await storage.write({ version: 1 });
    expect(map.get(LOCAL_SETTINGS_KEY)).toBe('{"version":1}');
    expect(await storage.read()).toEqual({ version: 1 });
  });
});
