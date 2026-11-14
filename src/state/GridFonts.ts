import { makeAutoObservable, runInAction } from "mobx";
import type { PluginHostApiV1 } from "../plugin/PluginApiTypes";
import type { PreferenceStorage } from "./GridPreferences";
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

/** Where the project settings live: lameta's project folder, or `localStorage` in the harness. */
export interface SettingsStorage {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

/** The sizes Windows' font dialog lists, which SayMore's Fonts dialog is. */
export const FONT_SIZES_PT: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
];

const SIZE_RANGE_PT = { min: 4, max: FONT_SIZES_PT[FONT_SIZES_PT.length - 1] } as const;

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
const GRID_COLUMNS = Object.keys(FONT_KEY) as GridColumn[];

const NO_STORAGE: SettingsStorage = {
  read: async () => null,
  write: async () => {},
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
  private fonts: Record<GridColumn, GridFont | undefined> = {
    transcription: undefined,
    freeTranslation: undefined,
  };

  /** Writes go nowhere until `useStorage` names where the settings live. */
  private storage: SettingsStorage = NO_STORAGE;
  /** Everything in the stored value, so a write keeps keys this build does not know. */
  private stored: Record<string, unknown> = {};
  /** Bumped by each `useStorage`, so a slower earlier read cannot win. */
  private generation = 0;
  /** The latest read that `useStorage` started. A font change waits for it, so the change merges
   * into the settings as read and the read cannot then put back the font it replaced. */
  private reading: Promise<void> = Promise.resolve();

  constructor() {
    makeAutoObservable<GridFonts, "storage" | "stored" | "generation" | "reading" | "read">(this, {
      storage: false,
      stored: false,
      generation: false,
      reading: false,
      read: false,
    });
  }

  get transcription(): GridFont | undefined {
    return this.fonts.transcription;
  }

  get freeTranslation(): GridFont | undefined {
    return this.fonts.freeTranslation;
  }

  font(column: GridColumn): GridFont | undefined {
    return this.fonts[column];
  }

  /** Read the fonts from `storage` and keep it for later writes. */
  useStorage(storage: SettingsStorage): Promise<void> {
    this.storage = storage;
    this.reading = this.read(storage, ++this.generation);
    return this.reading;
  }

  private async read(storage: SettingsStorage, generation: number): Promise<void> {
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
      for (const column of GRID_COLUMNS) {
        this.fonts[column] = parseGridFont(this.stored[FONT_KEY[column]]);
      }
    });
  }

  /** Set a column's font (undefined for the default) and store it with the project. */
  async setFont(column: GridColumn, font: GridFont | undefined): Promise<void> {
    await this.reading;
    const parsed = font ? parseGridFont(font) : undefined;
    runInAction(() => {
      this.fonts[column] = parsed;
    });
    const storedVersion = this.stored.version;
    if (typeof storedVersion === "number" && storedVersion > PROJECT_SETTINGS_VERSION) return;
    const next: Record<string, unknown> = { ...this.stored, version: PROJECT_SETTINGS_VERSION };
    if (parsed) next[FONT_KEY[column]] = parsed;
    else delete next[FONT_KEY[column]];
    this.stored = next;
    await this.storage.write(next);
  }
}

/**
 * The fonts the running app's grid uses. App points them at lameta's project settings when
 * embedded, and at `localStorage` in the harness.
 */
export const gridFonts = new GridFonts();
