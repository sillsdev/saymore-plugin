import { makeAutoObservable, runInAction } from "mobx";
import { MediaElementPlaybackEngine, type PlaybackEngine } from "../../audio/PlaybackEngine";
import type { RecorderService } from "../../audio/recording/Recorder";
import { encodeWavPcm16Mono } from "../../audio/wavWriter";
import { decodeWav } from "../../audio/wavCodec";
import type { FileSystemAdapter } from "../../fs/FileSystemAdapter";
import type { AnnotationSegment } from "../../model/AnnotationSegment";
import { BoundaryResult } from "../../model/BoundaryRules";
import {
  MIN_SEGMENT_LENGTH_MS,
  RECORDER_TOO_SHORT_WARNING_ID,
  RECORDER_TOO_SHORT_WARNING_MS,
  RECORDER_TOO_SHORT_WARNING_TEXT,
} from "../../model/SayMoreConstants";
import { makeTimeRange, rangeLengthMs, type TimeRange } from "../../model/TimeRange";
import { t } from "../../l10n";
import { UndoStack } from "../UndoStack";
import type { AnnotationDocumentStore } from "../AnnotationDocumentStore";
import type { RecordingFileStore } from "./RecordingFileStore";
import type { RecorderKind, SegmentCellState, SpaceBarMode } from "./recorderTypes";

/** "new" = the virtual new-segment slot at the unsegmented remainder. */
export type CurrentIndex = number | "new";

/** Encoder seam so specs can assert without depending on the WAV byte layout. */
export type WavEncoder = (samples: Float32Array, sampleRate: number) => Uint8Array;

export interface RecorderDeps {
  kind: RecorderKind;
  document: AnnotationDocumentStore;
  /** Source-media playback (its own MediaElementPlaybackEngine per plan). */
  playback: PlaybackEngine;
  /** Capture device (SpyRecorder in specs; MicRecorder at the merge step). */
  recorder: RecorderService;
  /** Persistence overlay + serialized disk queue. */
  store: RecordingFileStore;
  /** EAF autosave target; omit in single-file mode. */
  adapter?: FileSystemAdapter;
  /** WAV encoder (defaults to the Track B PCM16 mono encoder). */
  encodeWav?: WavEncoder;
  /** Playback engine for recorded clips (own blob-URL MediaElement per plan). */
  annotationPlayback?: PlaybackEngine;
  /** Blob-URL factory for a clip's bytes (spec seam; default uses URL.createObjectURL). */
  clipUrlFactory?: (bytes: Uint8Array) => string;
  /** Revoker paired with {@link clipUrlFactory}. */
  revokeClipUrl?: (url: string) => void;
}

/** Debounce before an edit is auto-persisted to the eaf (matches the segmenter). */
const AUTO_SAVE_DELAY_MS = 400;
/** Slop when deciding whether source playback reached the segment end. */
const PLAYBACK_END_EPS_SEC = 0.02;
/** Poll cadence while in Error mode, retrying the capture device (SayMore ~1.5s). */
const DEVICE_CHECK_INTERVAL_MS = 1500;
const MIN_SEC = MIN_SEGMENT_LENGTH_MS / 1000;

/**
 * Drives the Careful Speech / Oral Translation recorder over the tier document,
 * mirroring SayMore's `OralAnnotationRecorderDlgViewModel` + `…DlgBase` (zero
 * DOM, so the whole state machine is spec-testable via {@link SpyRecorder} +
 * `SpyPlaybackEngine`). Owns the space-bar mode, current-segment selection, the
 * listen-before-record gate, push-to-talk, and the virtual new-segment boundary
 * at the unsegmented remainder.
 */
export class RecorderViewModel {
  readonly kind: RecorderKind;
  readonly document: AnnotationDocumentStore;
  readonly playback: PlaybackEngine;
  readonly recorder: RecorderService;
  readonly store: RecordingFileStore;
  /** Playback engine for recorded clips (separate from the source `playback`). */
  readonly annotationPlayback: PlaybackEngine;
  readonly undoStack = new UndoStack();
  private readonly adapter?: FileSystemAdapter;
  private readonly encodeWav: WavEncoder;
  private readonly clipUrlFactory?: (bytes: Uint8Array) => string;
  private readonly revokeClipUrl?: (url: string) => void;
  private readonly disposeError: () => void;
  private currentClipUrl: string | undefined = undefined;

  mode: SpaceBarMode = "Listen";
  /** The segment being worked on, or "new" for the unsegmented remainder. */
  currentIndex: CurrentIndex = "new";
  /** End of the virtual new segment (seconds); meaningful when currentIndex === "new". */
  newSegmentEndSec = 0;
  hasListenedToCurrent = false;
  isListening = false;
  isRecording = false;
  /** Transient message (too-short warning etc.). */
  warning: string | undefined = undefined;

  private segmentBeingRecorded: TimeRange | undefined = undefined;
  private reRecording = false;
  private warningTimer: ReturnType<typeof setTimeout> | undefined;
  private autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  private deviceCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: RecorderDeps) {
    this.kind = deps.kind;
    this.document = deps.document;
    this.playback = deps.playback;
    this.recorder = deps.recorder;
    this.store = deps.store;
    this.annotationPlayback = deps.annotationPlayback ?? new MediaElementPlaybackEngine("");
    this.adapter = deps.adapter;
    this.encodeWav = deps.encodeWav ?? encodeWavPcm16Mono;
    this.clipUrlFactory = deps.clipUrlFactory;
    this.revokeClipUrl = deps.revokeClipUrl;
    this.disposeError = deps.recorder.onError(() => {
      runInAction(() => this.enterErrorMode());
    });
    makeAutoObservable<
      RecorderViewModel,
      | "adapter"
      | "encodeWav"
      | "clipUrlFactory"
      | "revokeClipUrl"
      | "disposeError"
      | "currentClipUrl"
      | "segmentBeingRecorded"
      | "reRecording"
      | "warningTimer"
      | "autoSaveTimer"
      | "deviceCheckTimer"
    >(this, {
      document: false,
      playback: false,
      recorder: false,
      store: false,
      annotationPlayback: false,
      undoStack: false,
      adapter: false,
      encodeWav: false,
      clipUrlFactory: false,
      revokeClipUrl: false,
      disposeError: false,
      currentClipUrl: false,
      segmentBeingRecorded: false,
      reRecording: false,
      warningTimer: false,
      autoSaveTimer: false,
      deviceCheckTimer: false,
    });
    this.initSelection();
  }

  /** Position the recorder on the first segment needing work (SayMore OnShown). */
  private initSelection(): void {
    this.newSegmentEndSec = this.endOfLastSegment;
    this.setNextCurrent();
    this.mode = this.isFullyAnnotated ? "Done" : "Listen";
  }

  // ── Derived model ───────────────────────────────────────────────────────────
  get micLevel(): number {
    return this.recorder.level;
  }
  get deviceLabel(): string | undefined {
    return this.recorder.deviceLabel;
  }

  private get segments(): AnnotationSegment[] {
    return this.document.tiers.segments;
  }

  get endOfLastSegment(): number {
    const segs = this.segments;
    return segs.length ? segs[segs.length - 1].range.end : 0;
  }

  get isFullySegmented(): boolean {
    return this.endOfLastSegment >= this.document.durationSec - PLAYBACK_END_EPS_SEC;
  }

  /** There is unsegmented audio past the last segment that we've reached into. */
  get hasNewSegment(): boolean {
    return this.newSegmentEndSec > this.endOfLastSegment + 1e-6;
  }

  /** SayMore GetIsFullyAnnotated: fully segmented AND every segment ignored-or-annotated. */
  get isFullyAnnotated(): boolean {
    const segs = this.segments;
    if (segs.length === 0) return false;
    if (!this.isFullySegmented) return false;
    return segs.every((s, i) => this.isIgnored(i) || this.store.has(s.range, this.kind));
  }

  /** The time range the current selection acts on (real segment or new-segment slot). */
  get currentRange(): TimeRange {
    if (typeof this.currentIndex === "number") {
      const seg = this.segments[this.currentIndex];
      if (seg) return seg.range;
    }
    return makeTimeRange(this.endOfLastSegment, this.newSegmentEndSec);
  }

  get selectedSegmentIsLongEnough(): boolean {
    return rangeLengthMs(this.currentRange) >= MIN_SEGMENT_LENGTH_MS;
  }

  /** Listen (ear/SPACE) is enabled unless recording, or already fully annotated with no slot. */
  get listenEnabled(): boolean {
    if (this.isRecording) return false;
    return this.currentIndex !== "new" || !this.isFullyAnnotated;
  }

  /** Record (SPACE) is armed only after the source has been heard to completion. */
  get recordEnabled(): boolean {
    return (
      this.selectedSegmentIsLongEnough &&
      this.hasListenedToCurrent &&
      this.recorder.state !== "error" &&
      !this.isListening &&
      !this.isRecording
    );
  }

  get cells(): SegmentCellState[] {
    return this.segments.map((s, i) => ({
      range: s.range,
      annotated: this.store.has(s.range, this.kind),
      ignored: this.isIgnored(i),
      isCurrent: this.currentIndex === i,
    }));
  }

  private isIgnored(index: number): boolean {
    return this.document.tiers.isSegmentIgnored(index);
  }

  /** SayMore SetNextUnannotatedSegment: next non-ignored segment lacking this kind, wrapping. */
  private setNextCurrent(): void {
    const segs = this.segments;
    const needs = (i: number): boolean =>
      !this.store.has(segs[i].range, this.kind) && !this.isIgnored(i);
    const curEnd =
      typeof this.currentIndex === "number" ? segs[this.currentIndex]?.range.end : undefined;
    let next = -1;
    if (curEnd !== undefined) next = segs.findIndex((s, i) => s.range.end > curEnd && needs(i));
    if (next < 0) next = segs.findIndex((_s, i) => needs(i));
    if (next >= 0) {
      this.currentIndex = next;
    } else {
      this.currentIndex = "new";
      this.newSegmentEndSec = this.endOfLastSegment;
    }
  }

  // ── Listen (source playback, press-and-hold) ────────────────────────────────
  listenDown(): void {
    if (this.isRecording || this.recorder.state === "error" || !this.listenEnabled) return;
    this.isListening = true;
    this.clearWarning();
    void this.playback.play(this.currentRange);
  }

  listenUp(): void {
    if (!this.isListening) return;
    const range = this.currentRange;
    const reachedEnd = this.playback.positionSec >= range.end - PLAYBACK_END_EPS_SEC;
    const heardTo = this.playback.positionSec;
    this.playback.stop();
    this.isListening = false;

    if (this.currentIndex === "new") {
      if (heardTo > this.endOfLastSegment) this.setNewSegmentEnd(heardTo, false);
    } else if (reachedEnd) {
      this.hasListenedToCurrent = true;
    }

    // FinishListeningUsingEarOrSpace: arm record once heard + long enough (new slot needs no prior listen).
    if (
      this.selectedSegmentIsLongEnough &&
      (this.hasListenedToCurrent || this.currentIndex === "new")
    ) {
      this.hasListenedToCurrent = true;
      this.mode = this.recorder.state === "error" ? "Error" : "Record";
    }
  }

  /** 'b' key: replay the current source segment (does not change the listen gate). */
  replayCurrentSource(): void {
    if (this.isRecording) return;
    void this.playback.play(this.currentRange);
  }

  // ── Speak (push-to-talk) ────────────────────────────────────────────────────
  speakDown(): void {
    if (this.mode !== "Record" || this.isRecording || !this.recordEnabled) return;
    if (this.recorder.state !== "open") return;
    this.playback.stop();
    this.recorder.beginRecording();
    this.isRecording = true;
    this.segmentBeingRecorded = this.currentRange;
    this.clearWarning();
  }

  async speakUp(): Promise<void> {
    if (!this.isRecording) return;
    const range = this.segmentBeingRecorded;
    const result = this.stopRecorderSafely();
    this.isRecording = false;
    this.segmentBeingRecorded = undefined;
    if (!result || !range) return; // aborted / error

    if (result.durationMs < MIN_SEGMENT_LENGTH_MS) {
      this.flashTooShort(); // discard, no advance (SayMore AnnotationTooShort)
      return;
    }

    const bytes = this.encodeWav(result.samples, result.sampleRate);
    if (this.currentIndex === "new") {
      this.commitNewSegmentRecording(bytes);
    } else {
      this.commitRecording(range, bytes);
    }
    this.advanceAfterRecording();
  }

  /** Esc: abort an in-progress take (no write, no advance; re-record leaves the old clip). */
  abortRecording(): void {
    if (!this.isRecording) return;
    this.recorder.abortRecording();
    this.isRecording = false;
    this.reRecording = false;
    this.segmentBeingRecorded = undefined;
  }

  // ── Per-cell actions (re-record / erase / playback) ─────────────────────────
  /** Play a recorded clip (its own blob-URL playback engine). */
  playAnnotation(i: number): void {
    const seg = this.segments[i];
    if (!seg) return;
    const bytes = this.store.get(seg.range, this.kind);
    if (!bytes) return;
    this.playback.stop();
    this.annotationPlayback.stop();
    this.revokeCurrentClip();
    this.currentClipUrl = this.makeClipUrl(bytes);
    const dur = this.clipDurationSec(bytes, seg.range.end - seg.range.start);
    void this.annotationPlayback.playSequence([
      { range: makeTimeRange(0, dur), url: this.currentClipUrl },
    ]);
  }

  /** Play a segment's SOURCE range on the main media. */
  playSourceOf(i: number): void {
    const seg = this.segments[i];
    if (!seg) return;
    this.annotationPlayback.stop();
    void this.playback.play(seg.range);
  }

  /** Erase a segment's recording (undoable); that segment becomes current again. */
  eraseAnnotation(i: number): void {
    const seg = this.segments[i];
    if (!seg || !this.store.has(seg.range, this.kind)) return;
    this.annotationPlayback.stop();
    const mutation = this.store.eraseRecording(seg.range, this.kind);
    this.undoStack.do({
      label: t("recorder.cmd.erase", "Erase annotation"),
      timeRange: seg.range,
      apply: () => mutation.apply(),
      revert: () => mutation.revert(),
    });
    this.reselectFromStart();
  }

  /**
   * Toggle a segment's `%ignore%` state (undoable). Ignored segments are skipped
   * by the recorder. Mirrors SayMore SegmenterDlgBase.HandleIgnoreButtonClick /
   * the recorder's HandleSegmentIgnored (re-derives the current segment after).
   */
  toggleIgnore(i: number): void {
    const seg = this.segments[i];
    if (!seg) return;
    const range = seg.range;
    const before = this.document.tiers.snapshot();
    this.document.tiers.setIgnored(i, !this.document.tiers.isSegmentIgnored(i));
    const after = this.document.tiers.snapshot();
    this.undoStack.do({
      label: t("recorder.cmd.ignore", "Toggle ignore"),
      timeRange: range,
      apply: () => this.document.tiers.replaceAll(after),
      revert: () => this.document.tiers.replaceAll(before),
    });
    this.document.bumpVersion();
    this.reselectFromStart();
    this.scheduleAutoSave();
  }

  /** Press-and-hold re-record on a specific cell. The old clip is the backup. */
  reRecordDown(i: number): void {
    const seg = this.segments[i];
    if (!seg || this.isRecording || this.recorder.state !== "open") return;
    this.playback.stop();
    this.annotationPlayback.stop();
    this.currentIndex = i;
    this.reRecording = true;
    this.recorder.beginRecording();
    this.isRecording = true;
    this.segmentBeingRecorded = seg.range;
    this.clearWarning();
  }

  /** Release re-record: overwrite on success; too-short/abort leaves the backup intact. */
  async reRecordUp(_i: number): Promise<void> {
    if (!this.isRecording || !this.reRecording) return;
    const range = this.segmentBeingRecorded;
    const result = this.stopRecorderSafely();
    this.isRecording = false;
    this.reRecording = false;
    this.segmentBeingRecorded = undefined;
    if (!result || !range) return;
    if (result.durationMs < MIN_SEGMENT_LENGTH_MS) {
      this.flashTooShort(); // old clip stays (never overwritten)
      return;
    }
    const bytes = this.encodeWav(result.samples, result.sampleRate);
    this.commitRecording(range, bytes); // overwrite; undo restores the backup. No advance.
  }

  // ── Selection / new-segment boundary ────────────────────────────────────────
  selectSegment(i: CurrentIndex): void {
    this.playback.stop();
    this.currentIndex = i;
    this.hasListenedToCurrent = false;
    if (i === "new") this.newSegmentEndSec = Math.max(this.newSegmentEndSec, this.endOfLastSegment);
    this.mode = this.isFullyAnnotated && i === "new" ? "Done" : "Listen";
  }

  nudgeNewBoundary(deltaMs: number): void {
    if (this.currentIndex !== "new") return;
    this.setNewSegmentEnd(this.newSegmentEndSec + deltaMs / 1000, true);
  }

  dragNewBoundaryTo(sec: number): void {
    if (this.currentIndex !== "new") return;
    this.setNewSegmentEnd(sec, true);
  }

  /** Clamp+set the virtual boundary: >= end-of-last (+min when enforced), <= media end. */
  private setNewSegmentEnd(sec: number, enforceMin: boolean): void {
    const dur = this.document.durationSec;
    const lo = this.endOfLastSegment + (enforceMin ? MIN_SEC : 0);
    let v = Math.min(sec, dur);
    if (v < lo) v = Math.min(lo, dur);
    this.newSegmentEndSec = v;
  }

  // ── Undo / redo ──────────────────────────────────────────────────────────────
  undo(): void {
    this.undoStack.undo();
    this.afterUndoRedo();
  }
  redo(): void {
    this.undoStack.redo();
    this.afterUndoRedo();
  }
  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }
  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  /** Label of the next undoable change (SayMore DescriptionForUndo); UI tooltip. */
  get undoDescription(): string | undefined {
    return this.undoStack.undoLabel;
  }

  /** Time range of the next undoable change (SayMore TimeRangeForUndo). */
  get timeRangeForUndo(): TimeRange | undefined {
    return this.undoStack.undoTimeRange;
  }

  private afterUndoRedo(): void {
    this.document.bumpVersion();
    this.reselectFromStart();
    this.scheduleAutoSave();
  }

  /**
   * Re-derive the current segment from the start. Used after undo/redo, erase and
   * ignore-toggle: restoring/removing an earlier clip or (un)ignoring a segment
   * makes the earliest still-needed segment current again (not the next one).
   */
  private reselectFromStart(): void {
    this.hasListenedToCurrent = false;
    this.currentIndex = "new";
    this.setNextCurrent();
    this.mode = this.isFullyAnnotated ? "Done" : "Listen";
  }

  dispose(): void {
    this.disposeError();
    this.stopDeviceCheck();
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.revokeCurrentClip();
    this.annotationPlayback.dispose();
    this.playback.dispose();
    this.recorder.close();
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  private makeClipUrl(bytes: Uint8Array): string {
    if (this.clipUrlFactory) return this.clipUrlFactory(bytes);
    if (typeof URL !== "undefined" && URL.createObjectURL) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }));
    }
    return "";
  }

  private revokeCurrentClip(): void {
    const url = this.currentClipUrl;
    if (!url) return;
    this.currentClipUrl = undefined;
    if (this.revokeClipUrl) this.revokeClipUrl(url);
    else if (typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
  }

  /** Clip duration from the WAV header; falls back when bytes aren't a decodable WAV. */
  private clipDurationSec(bytes: Uint8Array, fallbackSec: number): number {
    try {
      const { channels, sampleRate } = decodeWav(bytes);
      const frames = channels[0]?.length ?? 0;
      if (frames > 0 && sampleRate > 0) return frames / sampleRate;
    } catch {
      /* not a decodable WAV (e.g. spec fixtures) */
    }
    return fallbackSec;
  }

  private stopRecorderSafely(): ReturnType<RecorderService["stopRecording"]> | undefined {
    try {
      return this.recorder.stopRecording();
    } catch {
      return undefined;
    }
  }

  /** Overwrite/record a real segment's clip as one undoable overlay mutation. */
  private commitRecording(range: TimeRange, bytes: Uint8Array): void {
    const mutation = this.store.writeRecording(range, this.kind, bytes);
    this.undoStack.do({
      label: t("recorder.cmd.record", "Record annotation"),
      timeRange: range,
      apply: () => mutation.apply(),
      revert: () => mutation.revert(),
    });
  }

  /**
   * Recording at the unsegmented remainder: insert the new boundary into the
   * document AND write the clip as ONE compound undo command (SayMore inserts the
   * boundary and records atomically). The eaf rides the debounced autosave.
   */
  private commitNewSegmentRecording(bytes: Uint8Array): void {
    const range = makeTimeRange(this.endOfLastSegment, this.newSegmentEndSec);
    const before = this.document.tiers.snapshot();
    const result = this.document.tiers.insertBoundary(this.newSegmentEndSec);
    if (result !== BoundaryResult.Success) {
      this.flashTooShort();
      return;
    }
    const after = this.document.tiers.snapshot();
    const mutation = this.store.writeRecording(range, this.kind, bytes);
    this.undoStack.do({
      label: t("recorder.cmd.recordNew", "Record new segment"),
      timeRange: range,
      apply: () => {
        this.document.tiers.replaceAll(after);
        mutation.apply();
      },
      revert: () => {
        mutation.revert();
        this.document.tiers.replaceAll(before);
      },
    });
    this.document.bumpVersion();
    this.newSegmentEndSec = this.endOfLastSegment;
    this.scheduleAutoSave();
  }

  private advanceAfterRecording(): void {
    this.hasListenedToCurrent = false;
    this.setNextCurrent();
    this.mode = this.isFullyAnnotated ? "Done" : "Listen";
  }

  private enterErrorMode(): void {
    this.mode = "Error";
    this.isListening = false;
    this.isRecording = false;
    this.startDeviceCheck();
  }

  /**
   * Retry the capture device (SayMore CheckForRecordingDevice). When it comes
   * back, leave Error mode for Record (if the current segment was already heard)
   * or Listen/Done. Safe to call repeatedly; a no-op unless in Error mode.
   */
  async retryDevice(): Promise<void> {
    if (this.mode !== "Error") return;
    try {
      await this.recorder.open();
    } catch {
      return; // still unavailable; keep polling
    }
    if (this.recorder.state === "error") return;
    runInAction(() => {
      this.stopDeviceCheck();
      this.mode = this.isFullyAnnotated
        ? "Done"
        : this.hasListenedToCurrent && this.selectedSegmentIsLongEnough
          ? "Record"
          : "Listen";
    });
  }

  private startDeviceCheck(): void {
    if (this.deviceCheckTimer || typeof setInterval === "undefined") return;
    this.deviceCheckTimer = setInterval(() => {
      void this.retryDevice();
    }, DEVICE_CHECK_INTERVAL_MS);
  }

  private stopDeviceCheck(): void {
    if (this.deviceCheckTimer) {
      clearInterval(this.deviceCheckTimer);
      this.deviceCheckTimer = undefined;
    }
  }

  private flashTooShort(): void {
    this.warning = t(RECORDER_TOO_SHORT_WARNING_ID, RECORDER_TOO_SHORT_WARNING_TEXT);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.warningTimer = setTimeout(() => {
      runInAction(() => {
        this.warning = undefined;
      });
    }, RECORDER_TOO_SHORT_WARNING_MS);
  }

  private clearWarning(): void {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.warning = undefined;
  }

  private scheduleAutoSave(): void {
    if (!this.adapter) return;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      void this.document.save(this.adapter!).catch(() => {});
    }, AUTO_SAVE_DELAY_MS);
  }
}
