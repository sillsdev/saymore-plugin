import { makeAutoObservable, reaction, runInAction } from "mobx";
import type { PlaybackEngine, PlaySource } from "../audio/PlaybackEngine";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import type { OralAnnotationIndex, OralAnnotationKind } from "../fs/OralAnnotationFiles";
import { t } from "../l10n";
import { makeTimeRange, type TimeRange } from "../model/TimeRange";
import type { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import type {
  GridPreferences,
  TranscriptionPlayback,
  TranslationPlayback,
} from "./GridPreferences";
import type { SegmenterViewModel } from "./SegmenterViewModel";

/** The grid's two text columns, in the order Tab visits them. */
export type GridColumn = "transcription" | "freeTranslation";

/** Delay before an entered row starts playing (SayMore `SchedulePlaybackForCell`). */
export const AUTOPLAY_DELAY_MS = 250;
/** How many times a row's playback runs before it stops (SayMore: first run + 4 repeats). */
export const AUTOPLAY_MAX_LOOPS = 5;

/** What the grid needs from the project; `ProjectStore` provides all of it. */
export interface GridHost {
  readonly document: AnnotationDocumentStore | undefined;
  readonly segmenter: SegmenterViewModel | undefined;
  readonly oralIndex: OralAnnotationIndex | undefined;
  readonly adapter: FileSystemAdapter | undefined;
}

/** One item of a row's playback: the source range, or one of its oral recordings. */
export type PlaybackPart = "source" | OralAnnotationKind;

/**
 * The parts a row plays for a column's option, following SayMore's
 * `AudioWaveFormColumn.GetAnnotationMediaInfo`: a missing recording drops out of
 * "both", and is replaced by the source when it was the only choice.
 */
export function playbackParts(
  option: TranscriptionPlayback | TranslationPlayback,
  available: { careful: boolean; translation: boolean },
  column: GridColumn,
): PlaybackPart[] {
  const kind: OralAnnotationKind = column === "transcription" ? "Careful" : "Translation";
  const has = kind === "Careful" ? available.careful : available.translation;
  switch (option) {
    case "source":
      return ["source"];
    case "both":
      return has ? ["source", kind] : ["source"];
    default:
      return [has ? kind : "source"];
  }
}

/**
 * The transcription grid's behaviour, after SayMore's `TextAnnotationEditorGrid`:
 * which cell is current, keyboard movement (Tab wraps across rows, Up/Down skip
 * ignored rows), autoplay of the entered row after {@link AUTOPLAY_DELAY_MS}
 * looping {@link AUTOPLAY_MAX_LOOPS} times, F2 play/pause/resume, the per-column playback
 * options, and the per-row Ignored toggle. The view only renders this and
 * forwards focus, keys and clicks.
 */
export class GridViewModel {
  currentRow = 0;
  currentColumn: GridColumn = "transcription";
  /** The cell the view must move keyboard focus to; `seq` changes on every request. */
  focusRequest: { row: number; column: GridColumn; seq: number } | undefined = undefined;

  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Bumped by every stop/play so an awaited play started earlier can tell it is stale. */
  private playToken = 0;
  /** Object URLs of oral recordings, keyed by range and kind, revoked on dispose. */
  private readonly clipUrls = new Map<string, string>();

  constructor(
    private readonly host: GridHost,
    readonly prefs: GridPreferences,
    private readonly makeObjectUrl: (bytes: Uint8Array) => string = defaultObjectUrl,
  ) {
    this.currentRow = this.firstRowFrom(0, 1) ?? 0;
    makeAutoObservable<
      GridViewModel,
      "host" | "timer" | "playToken" | "clipUrls" | "makeObjectUrl"
    >(this, {
      host: false,
      prefs: false,
      timer: false,
      playToken: false,
      clipUrls: false,
      makeObjectUrl: false,
      // Plain getters: the engine may not be observable (the spy is not), and a
      // cached computed over it would go stale.
      playback: false,
      isPlaying: false,
      isPaused: false,
    });
  }

  /**
   * Start following the speed preference while the grid is on screen; the
   * returned function stops playback and releases the recordings' object URLs.
   * The view calls this from an effect, so a remount (React StrictMode) attaches
   * the same model again.
   */
  attach(): () => void {
    // SayMore applies a speed change to playback that is already running.
    const disposeReaction = reaction(
      () => this.prefs.rate,
      (rate) => this.playback?.setPlaybackRate(rate),
    );
    return () => {
      disposeReaction();
      this.detach();
    };
  }

  get rowCount(): number {
    return this.host.document?.segments.length ?? 0;
  }

  get playback(): PlaybackEngine | undefined {
    return this.host.segmenter?.playback;
  }

  get isPlaying(): boolean {
    return this.playback?.isPlaying ?? false;
  }

  isIgnored(row: number): boolean {
    return this.host.document?.tiers.isSegmentIgnored(row) ?? false;
  }

  /**
   * Focus arrived in a cell (click, Tab, arrow key, or the view restoring focus).
   * SayMore stops whatever is playing whenever a cell begins editing and starts
   * the row again after a short delay, so a user hurrying from row to row hears
   * only the row they settle on. Ignored rows never begin editing, so they do
   * not play.
   */
  enterCell(row: number, column: GridColumn): void {
    this.currentRow = row;
    this.currentColumn = column;
    this.stop();
    if (!this.isIgnored(row)) this.schedulePlay();
  }

  /** A click on a row outside its text cells (row number, empty space). */
  selectRow(row: number): void {
    if (row === this.currentRow) return;
    this.stop();
    this.currentRow = row;
  }

  /** Keyboard focus left the grid: a pending autoplay is cancelled, playback continues. */
  leaveGrid(): void {
    this.clearTimer();
  }

  /**
   * Tab / Shift+Tab from a text cell. Returns the cell to move to, or undefined
   * at the grid's first or last text cell, where focus leaves the grid as it
   * does in SayMore.
   */
  tabTarget(
    row: number,
    column: GridColumn,
    shift: boolean,
  ): { row: number; column: GridColumn } | undefined {
    if (!shift) {
      if (column === "transcription") return { row, column: "freeTranslation" };
      if (row < this.rowCount - 1) return { row: row + 1, column: "transcription" };
      return undefined;
    }
    if (column === "freeTranslation") return { row, column: "transcription" };
    if (row > 0) return { row: row - 1, column: "freeTranslation" };
    return undefined;
  }

  /** Tab handling; returns false when the browser should move focus out of the grid. */
  tab(row: number, column: GridColumn, shift: boolean): boolean {
    const target = this.tabTarget(row, column, shift);
    if (!target) return false;
    this.requestFocus(target.row, target.column);
    return true;
  }

  /** Up (-1) / Down (+1): the nearest row in that direction that is not ignored, if any. */
  verticalTarget(row: number, direction: 1 | -1): number | undefined {
    return this.firstRowFrom(row + direction, direction);
  }

  moveVertical(row: number, column: GridColumn, direction: 1 | -1): void {
    const target = this.verticalTarget(row, direction);
    if (target !== undefined) this.requestFocus(target, column);
  }

  requestFocus(row: number, column: GridColumn): void {
    this.focusRequest = { row, column, seq: (this.focusRequest?.seq ?? 0) + 1 };
  }

  get isPaused(): boolean {
    return this.playback?.isPaused ?? false;
  }

  /**
   * F2, as SayMore's grid does: pause while playing, continue from the paused
   * position (with the remaining loops) while paused, else play the row from the
   * start. Pausing cancels a pending autoplay.
   */
  togglePlayback(): void {
    this.clearTimer();
    if (this.isPlaying) this.playback?.pause();
    else if (this.isPaused) this.playback?.resume();
    else void this.play();
  }

  /** The row's play button: stop it if it is the row playing or paused, else make it current and play it. */
  togglePlayRow(row: number): void {
    if (row === this.currentRow && (this.isPlaying || this.isPaused)) {
      this.stop();
      return;
    }
    this.currentRow = row;
    void this.play();
  }

  /** Stop playback and cancel a pending autoplay. */
  stop(): void {
    this.clearTimer();
    this.playToken++;
    this.playback?.stop();
  }

  /** Play the current row as the current column's option says, looping. */
  async play(): Promise<void> {
    this.clearTimer();
    const token = ++this.playToken;
    const playback = this.playback;
    const segment = this.host.document?.segments[this.currentRow];
    if (!playback || !segment) return;
    const sources = await this.sourcesFor(segment.range, this.currentColumn);
    if (token !== this.playToken) return;
    const opts = { rate: this.prefs.rate, maxLoops: AUTOPLAY_MAX_LOOPS };
    if (sources.length === 1 && !sources[0].url) void playback.play(sources[0].range, opts);
    else void playback.playSequence(sources, opts);
  }

  setTranscriptionPlayback(value: TranscriptionPlayback): void {
    this.prefs.setTranscriptionPlayback(value);
    this.replayAfterOptionChange();
  }

  setTranslationPlayback(value: TranslationPlayback): void {
    this.prefs.setTranslationPlayback(value);
    this.replayAfterOptionChange();
  }

  /**
   * Mark a row ignored or not, as SayMore's cell menu does: ignoring writes
   * `%ignore%` over the transcription and stops playback; un-ignoring clears it
   * and puts the cursor back in the row. When the segmenter is loaded the change
   * goes on its undo stack, restoring the row's earlier transcription on undo.
   */
  setIgnored(row: number, ignored: boolean): void {
    const doc = this.host.document;
    if (!doc || row < 0 || row >= doc.segments.length) return;
    if (this.isIgnored(row) === ignored) return;
    const before = doc.segments[row].transcription;
    const undoStack = this.host.segmenter?.undoStack;
    if (undoStack) {
      undoStack.do({
        label: t("segmenter.cmd.ignore", "Toggle ignore"),
        apply: () => doc.tiers.setIgnored(row, ignored),
        revert: () => doc.tiers.setTranscription(row, before),
        timeRange: doc.segments[row].range,
      });
    } else {
      doc.tiers.setIgnored(row, ignored);
    }
    doc.bumpVersion();
    const adapter = this.host.adapter;
    if (adapter) void doc.save(adapter).catch(() => {});
    if (ignored) {
      this.stop();
    } else {
      this.requestFocus(row, this.currentColumn);
    }
  }

  private detach(): void {
    if (this.timer !== undefined || this.isPlaying || this.isPaused) this.stop();
    for (const url of this.clipUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* no URL API */
      }
    }
    this.clipUrls.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private schedulePlay(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.play();
    }, AUTOPLAY_DELAY_MS);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** SayMore stops when the column header menu opens and plays again on a choice. */
  private replayAfterOptionChange(): void {
    if (this.rowCount === 0 || this.isIgnored(this.currentRow)) return;
    void this.play();
  }

  private firstRowFrom(start: number, direction: 1 | -1): number | undefined {
    for (let r = start; r >= 0 && r < this.rowCount; r += direction) {
      if (!this.isIgnored(r)) return r;
    }
    return undefined;
  }

  private async sourcesFor(range: TimeRange, column: GridColumn): Promise<PlaySource[]> {
    const option =
      column === "transcription"
        ? this.prefs.transcriptionPlayback
        : this.prefs.translationPlayback;
    if (option === "source") return [{ range }];
    const careful = column === "transcription" ? await this.clipUrl(range, "Careful") : undefined;
    const translation =
      column === "freeTranslation" ? await this.clipUrl(range, "Translation") : undefined;
    const available = { careful: !!careful, translation: !!translation };
    const parts = playbackParts(option, available, column);
    // An oral recording plays whole; its element reports `ended` at its own end.
    const wholeClip = makeTimeRange(0, Number.POSITIVE_INFINITY);
    return parts.map((part) =>
      part === "source"
        ? { range }
        : { range: wholeClip, url: part === "Careful" ? careful : translation },
    );
  }

  private async clipUrl(range: TimeRange, kind: OralAnnotationKind): Promise<string | undefined> {
    const index = this.host.oralIndex;
    if (!index) return undefined;
    const key = `${range.start}|${range.end}|${kind}`;
    const cached = this.clipUrls.get(key);
    if (cached) return cached;
    let bytes: Uint8Array | undefined;
    try {
      bytes = await index.readSegmentWav(range, kind);
    } catch {
      return undefined;
    }
    if (!bytes) return undefined;
    const url = this.makeObjectUrl(bytes);
    runInAction(() => this.clipUrls.set(key, url));
    return url;
  }
}

function defaultObjectUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }));
}
