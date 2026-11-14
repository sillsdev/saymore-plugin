import { makeAutoObservable } from "mobx";

/**
 * What the Transcription column plays when its row is entered (SayMore
 * `TranscriptionAnnotationColumn`): the source segment, the Careful Speech
 * recording, or the source followed by the Careful Speech recording.
 */
export type TranscriptionPlayback = "source" | "careful" | "both";
/**
 * What the Free Translation column plays (SayMore `TranslationAnnotationColumn`):
 * the source segment, the Oral Translation recording, or both in that order.
 */
export type TranslationPlayback = "source" | "translation" | "both";

/** The speeds the grid offers, fastest first, as SayMore's combo lists them. */
export const PLAYBACK_SPEED_CHOICES: readonly number[] = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

/** The subset of `Storage` the preferences need, so specs can pass a fake. */
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const SPEED_KEY = "grid.playbackSpeedPercent";
const TRANSCRIPTION_KEY = "grid.transcriptionPlayback";
const TRANSLATION_KEY = "grid.translationPlayback";

/**
 * The grid's per-user, per-machine playback choices, kept in `localStorage`
 * (lameta namespaces it per plugin). Every storage access is wrapped because
 * `localStorage` can be missing or throw (privacy settings, sandboxed frames);
 * the grid then runs on the defaults, which are SayMore's: 100% speed, the
 * Transcription column plays the source, the Free Translation column plays the
 * Oral Translation recording.
 */
export class GridPreferences {
  speedPercent = 100;
  transcriptionPlayback: TranscriptionPlayback = "source";
  translationPlayback: TranslationPlayback = "translation";

  constructor(private readonly storage: PreferenceStorage | undefined) {
    const speed = Number(this.read(SPEED_KEY));
    if (PLAYBACK_SPEED_CHOICES.includes(speed)) this.speedPercent = speed;
    const tr = this.read(TRANSCRIPTION_KEY);
    if (tr === "source" || tr === "careful" || tr === "both") this.transcriptionPlayback = tr;
    const ft = this.read(TRANSLATION_KEY);
    if (ft === "source" || ft === "translation" || ft === "both") this.translationPlayback = ft;
    makeAutoObservable<GridPreferences, "storage">(this, { storage: false });
  }

  /** Playback rate for the media element, 0.1–1.0. */
  get rate(): number {
    return this.speedPercent / 100;
  }

  setSpeedPercent(percent: number): void {
    if (!PLAYBACK_SPEED_CHOICES.includes(percent)) return;
    this.speedPercent = percent;
    this.write(SPEED_KEY, String(percent));
  }

  setTranscriptionPlayback(value: TranscriptionPlayback): void {
    this.transcriptionPlayback = value;
    this.write(TRANSCRIPTION_KEY, value);
  }

  setTranslationPlayback(value: TranslationPlayback): void {
    this.translationPlayback = value;
    this.write(TRANSLATION_KEY, value);
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }
}

/** The window's `localStorage`, or undefined where there is none or it throws. */
export function browserStorage(): PreferenceStorage | undefined {
  try {
    // Node's own `localStorage` global warns on access, so only a window's is used.
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The preferences the running app shares between the toolbar and the grid. */
export const gridPreferences = new GridPreferences(browserStorage());
