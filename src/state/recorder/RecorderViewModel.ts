import { makeAutoObservable } from "mobx";
import type { PlaybackEngine } from "../../audio/PlaybackEngine";
import type { RecorderService } from "../../audio/recording/Recorder";
import type { FileSystemAdapter } from "../../fs/FileSystemAdapter";
import type { OralAnnotationIndex } from "../../fs/OralAnnotationFiles";
import type { AnnotationDocumentStore } from "../AnnotationDocumentStore";
import { UndoStack } from "../UndoStack";
import type { RecorderKind, SegmentCellState, SpaceBarMode } from "./recorderTypes";

/** "new" = the virtual new-segment slot at the unsegmented remainder. */
export type CurrentIndex = number | "new";

export interface RecorderDeps {
  kind: RecorderKind;
  document: AnnotationDocumentStore;
  /** Playback of the source media (own MediaElementPlaybackEngine per plan). */
  playback: PlaybackEngine;
  /** Capture device (SpyRecorder in specs; MicRecorder at the merge step). */
  recorder: RecorderService;
  oralIndex?: OralAnnotationIndex;
  adapter?: FileSystemAdapter;
  mediaFileName: string;
}

/**
 * Drives the Careful Speech / Oral Translation recorder over the tier document,
 * mirroring SayMore's `OralAnnotationRecorderDlgViewModel` (zero DOM, so the
 * whole state machine is spec-testable via {@link SpyRecorder} +
 * `SpyPlaybackEngine`). Owns the space-bar mode, current-segment selection, the
 * listen-before-record gate, push-to-talk, per-cell playback/erase/re-record,
 * and the virtual new-segment boundary at the unsegmented remainder.
 *
 * Step 0 skeleton: the full public surface compiles with observables
 * initialized and methods as minimal no-ops; Track A fills in the real logic.
 */
export class RecorderViewModel {
  readonly kind: RecorderKind;
  readonly document: AnnotationDocumentStore;
  readonly playback: PlaybackEngine;
  readonly recorder: RecorderService;
  readonly undoStack = new UndoStack();
  private readonly oralIndex?: OralAnnotationIndex;
  private readonly disposeError: () => void;

  mode: SpaceBarMode = "Listen";
  /** The segment being worked on, or "new" for the unsegmented remainder. */
  currentIndex: CurrentIndex = 0;
  /** End of the virtual new segment (seconds); only meaningful when currentIndex === "new". */
  newSegmentEndSec = 0;
  hasListenedToCurrent = false;
  isListening = false;
  isRecording = false;
  micLevel = 0;
  deviceLabel: string | undefined = undefined;
  /** Transient message (too-short warning etc.). */
  warning: string | undefined = undefined;

  constructor(deps: RecorderDeps) {
    this.kind = deps.kind;
    this.document = deps.document;
    this.playback = deps.playback;
    this.recorder = deps.recorder;
    this.oralIndex = deps.oralIndex;
    this.deviceLabel = deps.recorder.deviceLabel;
    this.disposeError = deps.recorder.onError(() => {
      this.mode = "Error";
    });
    makeAutoObservable<RecorderViewModel, "oralIndex" | "disposeError">(this, {
      document: false,
      playback: false,
      recorder: false,
      undoStack: false,
      oralIndex: false,
      disposeError: false,
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  /** One cell per real segment, with annotated?/ignored?/current derivation. */
  get cells(): SegmentCellState[] {
    const segs = this.document.tiers.segments;
    return segs.map((s, i) => ({
      range: s.range,
      annotated:
        this.oralIndex?.getFilesForRange(s.range).some((e) => e.kind === this.kind) ?? false,
      ignored: this.document.tiers.isSegmentIgnored(i),
      isCurrent: this.currentIndex === i,
    }));
  }

  // ── Listen (source playback, press-and-hold) ────────────────────────────────
  listenDown(): void {
    /* Track A: play current source segment; extend new boundary while listening. */
  }
  listenUp(): void {
    /* Track A: stop source playback; arm record if playback completed. */
  }
  /** 'b' key: replay the current source segment. */
  replayCurrentSource(): void {
    /* Track A */
  }

  // ── Speak (push-to-talk) ────────────────────────────────────────────────────
  speakDown(): void {
    /* Track A: recorder.beginRecording when armed. */
  }
  async speakUp(): Promise<void> {
    /* Track A: stopRecording; too-short discard + warning, else encode/write/advance. */
  }

  // ── Per-cell actions ────────────────────────────────────────────────────────
  playAnnotation(_i: number): void {
    /* Track A: play the recorded clip (blob URL), cursor animates. */
  }
  playSourceOf(_i: number): void {
    /* Track A: play that segment's source range. */
  }
  eraseAnnotation(_i: number): void {
    /* Track A: delete the clip (undoable). */
  }
  reRecordDown(_i: number): void {
    /* Track A: back up existing bytes, begin recording. */
  }
  async reRecordUp(_i: number): Promise<void> {
    /* Track A: stop; restore backup on too-short/abort, else overwrite. */
  }

  // ── Selection / new-segment boundary ────────────────────────────────────────
  selectSegment(i: CurrentIndex): void {
    this.currentIndex = i;
    this.hasListenedToCurrent = false;
  }
  nudgeNewBoundary(_deltaMs: number): void {
    /* Track A: move the virtual new boundary (clamped ≥460ms, ≤ media end). */
  }
  dragNewBoundaryTo(_sec: number): void {
    /* Track A */
  }

  // ── Abort / undo ────────────────────────────────────────────────────────────
  /** Esc: abort an in-progress take. */
  abortRecording(): void {
    /* Track A */
  }
  undo(): void {
    this.undoStack.undo();
  }
  redo(): void {
    this.undoStack.redo();
  }
  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }
  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  dispose(): void {
    this.disposeError();
    this.playback.dispose();
    this.recorder.close();
  }
}
