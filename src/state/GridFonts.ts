import { makeAutoObservable, runInAction } from "mobx";
import type { PluginHostApiV1 } from "../plugin/PluginApiTypes";
import { browserStorage, type PreferenceStorage } from "./GridPreferences";
import type { GridColumn } from "./GridViewModel";

/**
 * A grid column's font, as SayMore's Fonts dialog sets it and its project file keeps
 * it (`FontHelper.FontToString`: family, size in points, style).
 */
export interface GridFont {
  family: string;
  sizePt: number;
  bold?: boolean;
  italic?: boolean;
}

/** The version of the project settings this build reads and writes. */
export const PROJECT_SETTINGS_VERSION = 1;

/** The plugin's settings for the whole project, as lameta stores them in the project folder. */
export interface ProjectSettingsV1 {
  version: 1;
  transcriptionFont?: GridFont;
  freeTranslationFont?: GridFont;
}

/** Where the project settings live: lameta's project folder, or `localStorage` in the harness. */
export interface SettingsStorage {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

export const SIZE_RANGE_PT = { min: 4, max: 72 } as const;

/** A stored font, or undefined when the value is not one. */
export function parseGridFont(value: unknown): GridFont | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.family !== "string" || v.family.trim() === "") return undefined;
  if (typeof v.sizePt !== "number" || !Number.isFinite(v.sizePt)) return undefined;
  if (v.sizePt < SIZE_RANGE_PT.min || v.sizePt > SIZE_RANGE_PT.max) return undefined;
  const font: GridFont = { family: v.family.trim(), sizePt: v.sizePt };
  if (v.bold === true) font.bold = true;
  if (v.italic === true) font.italic = true;
  return font;
}

const FONT_KEY: Record<GridColumn, "transcriptionFont" | "freeTranslationFont"> = {
  transcription: "transcriptionFont",
  freeTranslation: "freeTranslationFont",
};

/** lameta's project settings for this plugin. */
export function hostSettingsStorage(
  api: Pick<PluginHostApiV1, "getProjectSettings" | "setProjectSettings">,
): SettingsStorage {
  return {
    read: () => api.getProjectSettings(),
    write: (value) => api.setProjectSettings(value),
  };
}

/** The harness keeps the project settings in `localStorage` under this key. */
export const LOCAL_SETTINGS_KEY = "projectSettings";

export function localSettingsStorage(storage: PreferenceStorage | undefined): SettingsStorage {
  return {
    read: async () => {
      const text = storage?.getItem(LOCAL_SETTINGS_KEY);
      return text ? (JSON.parse(text) as unknown) : null;
    },
    write: async (value) => {
      storage?.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(value));
    },
  };
}

/**
 * The Transcription and Free Translation columns' fonts, shared by everyone who
 * opens the project, as SayMore keeps them in its project file. Each content tab
 * reads them when it connects; there is no change event, so a tab that is already
 * open keeps the fonts it read until it reloads. Settings written by a newer
 * version of the plugin are read where they parse, and never overwritten.
 */
export class GridFonts {
  transcription: GridFont | undefined = undefined;
  freeTranslation: GridFont | undefined = undefined;

  private storage: SettingsStorage;
  /** Everything in the stored value, so a write keeps keys this build does not know. */
  private stored: Record<string, unknown> = {};
  /** Bumped by each `useStorage`, so a slower earlier read cannot win. */
  private generation = 0;

  constructor(storage: SettingsStorage) {
    this.storage = storage;
    makeAutoObservable<GridFonts, "storage" | "stored" | "generation">(this, {
      storage: false,
      stored: false,
      generation: false,
    });
  }

  font(column: GridColumn): GridFont | undefined {
    return column === "transcription" ? this.transcription : this.freeTranslation;
  }

  /** Read the fonts from `storage` and keep it for later writes. */
  async useStorage(storage: SettingsStorage): Promise<void> {
    this.storage = storage;
    const generation = ++this.generation;
    let value: unknown = null;
    try {
      value = await storage.read();
    } catch {
      value = null;
    }
    if (generation !== this.generation) return;
    const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    runInAction(() => {
      this.stored = { ...(stored as Record<string, unknown>) };
      this.transcription = parseGridFont(this.stored.transcriptionFont);
      this.freeTranslation = parseGridFont(this.stored.freeTranslationFont);
    });
  }

  /** Set a column's font (undefined for the default) and store it with the project. */
  async setFont(column: GridColumn, font: GridFont | undefined): Promise<void> {
    const parsed = font ? parseGridFont(font) : undefined;
    if (column === "transcription") this.transcription = parsed;
    else this.freeTranslation = parsed;
    const storedVersion = this.stored.version;
    if (typeof storedVersion === "number" && storedVersion > PROJECT_SETTINGS_VERSION) return;
    const next: Record<string, unknown> = { ...this.stored, version: PROJECT_SETTINGS_VERSION };
    if (parsed) next[FONT_KEY[column]] = parsed;
    else delete next[FONT_KEY[column]];
    this.stored = next;
    await this.storage.write(next);
  }
}

/** The fonts the running app's grid uses; App switches them to lameta's storage when embedded. */
export const gridFonts = new GridFonts(localSettingsStorage(browserStorage()));
void gridFonts.useStorage(localSettingsStorage(browserStorage()));
