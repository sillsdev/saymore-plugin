import { makeAutoObservable } from "mobx";
import type { AnnotationSegment } from "../model/AnnotationSegment";
import { makeTimeRange, type TimeRange } from "../model/TimeRange";
import { BoundaryResult } from "../model/BoundaryRules";
import {
  MIN_ZOOM_PERCENT,
  NUDGE_MS,
  PIXELS_PER_SECOND_AT_100,
  REPLAY_DELAY_MS,
  REPLAY_WINDOW_MS,
  TOO_SHORT_WARNING_MS,
  ZOOM_STEP_PERCENT,
} from "../model/SayMoreConstants";
import { t } from "../l10n";
import type { PlaybackEngine } from "../audio/PlaybackEngine";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import {
  segmentWavName,
  type OralAnnotationIndex,
  type OralAnnotationKind,
  type FileOp,
} from "../fs/OralAnnotationFiles";
import { csFloatToString, parseCsFloat } from "../fs/csFloat";
import type { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { UndoStack } from "./UndoStack";
import { OralFileReconciler } from "./OralFileReconciler";

const ORAL_KINDS: readonly OralAnnotationKind[] = ["Careful", "Translation"];
const ORAL_BASE_RE = /^(.+)_to_(.+?)(_Careful|_Translation)\.wav$/i;

/** No segment/boundary currently selected. */
export const NONE = -1;

/** Debounce before an edit is auto-persisted to the eaf (coalesces drags/nudges). */
const AUTO_SAVE_DELAY_MS = 400;

export interface SegmenterDeps {
  document: AnnotationDocumentStore;
  playback: PlaybackEngine;
  adapter?: FileSystemAdapter;
  oralIndex?: OralAnnotationIndex;
}

/**
 * Drives the Manual Segmenter interaction model over the tier document. Owns UI
 * state (cursor, selected boundary, zoom, hover, transient warning), the undo
 * stack, and the deferred oral-file journal. Every boundary edit becomes a
 * reversible command carrying the FileOps to apply on save.
 */
export class SegmenterViewModel {
  readonly document: AnnotationDocumentStore;
  readonly playback: PlaybackEngine;
  readonly undoStack = new UndoStack();
  private readonly adapter?: FileSystemAdapter;
  private readonly oralIndex?: OralAnnotationIndex;
  /** Keeps `_Annotations/` WAVs consistent with the model on every flush. */
  private readonly reconciler?: OralFileReconciler;
  /**
   * Live map of `${csFloat(start)}|${csFloat(end)}|${kind}` → current WAV disk
   * name, seeded from the index and updated on every edit. Op computation reads
   * this instead of the oral index, which is only refreshed on flush — so rapid
   * edits within one debounce window (e.g. arrow-nudges) still chain correctly.
   */
  private oralNames = new Map<string, string>();

  cursorSec = 0;
  /** Index of the segment whose END boundary is selected, or NONE. */
  selectedBoundaryIndex = NONE;
  hoveredSegmentIndex = NONE;
  zoomPercent = 100;
  warning: string | undefined = undefined;

  private replayTimer: ReturnType<typeof setTimeout> | undefined;
  private warningTimer: ReturnType<typeof setTimeout> | undefined;
  private autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: SegmenterDeps) {
    this.document = deps.document;
    this.playback = deps.playback;
    this.adapter = deps.adapter;
    this.oralIndex = deps.oralIndex;
    this.reconciler = deps.adapter ? new OralFileReconciler(deps.adapter) : undefined;
    makeAutoObservable<
      SegmenterViewModel,
      | "adapter"
      | "oralIndex"
      | "reconciler"
      | "oralNames"
      | "replayTimer"
      | "warningTimer"
      | "autoSaveTimer"
    >(this, {
      document: false,
      playback: false,
      undoStack: false,
      adapter: false,
      oralIndex: false,
      reconciler: false,
      oralNames: false,
      replayTimer: false,
      warningTimer: false,
      autoSaveTimer: false,
    });
  }

  /**
   * Continuous save: after any edit, debounce a {@link flush} through the adapter
   * (there is no Save button). No-op in single-file mode (no adapter). Does NOT
   * run the end-of-file rules — those are finalization and belong to {@link save}
   * (segmenter exit).
   */
  private scheduleAutoSave(): void {
    if (!this.adapter) return;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, AUTO_SAVE_DELAY_MS);
  }

  /**
   * One persistence pass: reconcile the oral-annotation WAVs to the current model
   * AND write the eaf in the SAME flush, so a crash never leaves the eaf pointing
   * at un-renamed or orphaned recordings (the reason boundary edits must not
   * defer the oral-file journal to an explicit save that the app never calls).
   * The reconciler applies only the delta since the last flush, so undo/redo
   * self-correct (reverse rename; restore a deleted clip from backup).
   */
  private async flush(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    if (this.reconciler) {
      await this.reconciler.reconcile(this.undoStack.collectFileOps());
      await this.oralIndex?.refresh();
    }
    await this.document.save(adapter);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  get segments(): AnnotationSegment[] {
    return this.document.segments;
  }

  get segmentCount(): number {
    return this.segments.length;
  }

  get durationSec(): number {
    return this.document.durationSec;
  }

  get boundaries(): number[] {
    return this.document.tiers.endBoundaries;
  }

  get isPlaying(): boolean {
    return this.playback.isPlaying;
  }

  /**
   * The position an edit acts on: the live playhead while listening, otherwise
   * the placed cursor. Mirrors SayMore's `GetCursorTime()`, whose cursor tracks
   * playback — so pressing Enter while listening adds a boundary at the playhead.
   */
  get editPositionSec(): number {
    return this.playback.isPlaying ? this.playback.positionSec : this.cursorSec;
  }

  get isDirty(): boolean {
    return this.document.isDirty;
  }

  /** Pixels-per-second for the current zoom (SayMore: 80 px/s at 100%). */
  get minPxPerSec(): number {
    return (PIXELS_PER_SECOND_AT_100 * this.zoomPercent) / 100;
  }

  // ── Cursor / playback ───────────────────────────────────────────────────────
  setCursor(seconds: number): void {
    this.playback.stop();
    this.cursorSec = Math.max(0, Math.min(seconds, this.durationSec));
  }

  /** Space: toggle play (from cursor to end of media) / stop. */
  togglePlay(): void {
    if (this.playback.isPlaying) {
      this.playback.stop();
    } else {
      void this.playback.play(makeTimeRange(this.cursorSec, this.durationSec));
    }
  }

  /** Hover play button: play just this segment. */
  playSegment(index: number): void {
    const seg = this.segments[index];
    if (seg) void this.playback.play(seg.range);
  }

  // ── Selection ────────────────────────────────────────────────────────────
  selectBoundaryAt(seconds: number): void {
    const index = this.document.tiers.indexOfSegmentEndingAt(seconds);
    this.selectedBoundaryIndex = index;
  }

  clearSelection(): void {
    this.selectedBoundaryIndex = NONE;
  }

  /**
   * Keyboard boundary selection (Tab / Shift+Tab): cycle the selected boundary
   * through the segment-end boundaries, wrapping. Lets the segmenter be driven
   * entirely from the keyboard (accessibility + headless testing) without having
   * to pixel-target the boundary line. `delta` is +1 (next) or -1 (previous).
   */
  cycleSelectedBoundary(delta: number): void {
    const n = this.segments.length;
    if (n === 0) return;
    const cur = this.selectedBoundaryIndex;
    if (cur < 0) {
      this.selectedBoundaryIndex = delta < 0 ? n - 1 : 0;
    } else {
      this.selectedBoundaryIndex = (((cur + delta) % n) + n) % n;
    }
  }

  setHoveredSegment(index: number): void {
    this.hoveredSegmentIndex = index;
  }

  // ── Zoom (Ctrl+1 in / Ctrl+2 reset / Ctrl+3 out) ───────────────────────────
  setZoomPercent(percent: number): void {
    this.zoomPercent = Math.max(MIN_ZOOM_PERCENT, Math.round(percent));
  }
  zoomIn(): void {
    this.setZoomPercent(this.zoomPercent + ZOOM_STEP_PERCENT);
  }
  zoomOut(): void {
    this.setZoomPercent(this.zoomPercent - ZOOM_STEP_PERCENT);
  }
  zoomReset(): void {
    this.setZoomPercent(100);
  }

  // ── Edits ────────────────────────────────────────────────────────────────
  private runEdit(label: string, fileOps: FileOp[], mutate: () => BoundaryResult): BoundaryResult {
    const beforeTiers = this.document.tiers.snapshot();
    const beforeOral = this.snapshotOral();
    const result = mutate();
    if (result !== BoundaryResult.Success) return result;
    // Advance the live name map to match this edit's ops (only on success).
    this.applyOpsToTracker(fileOps);
    const afterTiers = this.document.tiers.snapshot();
    const afterOral = this.snapshotOral();
    this.undoStack.do({
      label,
      apply: () => {
        this.document.tiers.replaceAll(afterTiers);
        this.oralNames = new Map(afterOral);
      },
      revert: () => {
        this.document.tiers.replaceAll(beforeTiers);
        this.oralNames = new Map(beforeOral);
      },
      fileOps,
    });
    this.document.bumpVersion();
    this.scheduleAutoSave();
    return result;
  }

  /** Enter: add a boundary at the playhead (while listening) or cursor. */
  addBoundaryAtCursor(): BoundaryResult {
    const at = this.editPositionSec;
    // Splitting a segment that owns oral recordings invalidates them.
    const enclosing = this.document.tiers.indexOfSegmentAt(at);
    const fileOps = enclosing >= 0 ? this.deleteOralFor(this.segments[enclosing].range) : [];
    const result = this.runEdit(t("segmenter.cmd.addBoundary", "Add boundary"), fileOps, () =>
      this.document.tiers.insertBoundary(at),
    );
    if (result === BoundaryResult.Success) {
      this.selectBoundaryAt(at);
    } else {
      this.flashTooShort();
    }
    return result;
  }

  /** Delete: remove the selected boundary (joining segments). */
  deleteSelectedBoundary(): BoundaryResult {
    const k = this.selectedBoundaryIndex;
    if (k < 0 || k >= this.segments.length) return BoundaryResult.SegmentNotFound;
    const fileOps = this.computeDeleteFileOps(k);
    const result = this.runEdit(t("segmenter.cmd.deleteBoundary", "Delete boundary"), fileOps, () =>
      this.document.tiers.deleteSegment(k),
    );
    if (result === BoundaryResult.Success) this.clearSelection();
    return result;
  }

  /** Commit a drag of the selected boundary to `newEndSec` (already clamped). */
  moveSelectedBoundaryTo(newEndSec: number): BoundaryResult {
    const k = this.selectedBoundaryIndex;
    if (k < 0) return BoundaryResult.SegmentNotFound;
    return this.moveBoundary(k, newEndSec, true);
  }

  private moveBoundary(k: number, newEndSec: number, replay: boolean): BoundaryResult {
    this.clearReplayTimer();
    this.playback.stop();
    const fileOps = this.computeMoveFileOps(k, newEndSec);
    const result = this.runEdit(t("segmenter.cmd.moveBoundary", "Move boundary"), fileOps, () =>
      this.document.tiers.moveBoundary(k, newEndSec),
    );
    if (result === BoundaryResult.Success && replay) {
      this.scheduleReplay(this.segments[k].range.end, k);
    }
    return result;
  }

  /** ← / → : nudge the selected boundary by ±5ms, then debounce-replay. */
  nudgeSelected(deltaMs: number = NUDGE_MS): BoundaryResult {
    const k = this.selectedBoundaryIndex;
    if (k < 0) return BoundaryResult.SegmentNotFound;
    this.clearReplayTimer();
    this.playback.stop();
    const newEnd = this.segments[k].range.end + deltaMs / 1000;
    const fileOps = this.computeMoveFileOps(k, newEnd);
    const result = this.runEdit(t("segmenter.cmd.nudge", "Nudge boundary"), fileOps, () =>
      this.document.tiers.nudgeBoundary(k, deltaMs, this.durationSec),
    );
    if (result === BoundaryResult.Success) {
      this.scheduleReplay(this.segments[k].range.end, k);
    }
    return result;
  }

  toggleIgnore(index: number): void {
    if (index < 0 || index >= this.segments.length) return;
    const before = this.document.tiers.snapshot();
    const ignored = this.document.tiers.isSegmentIgnored(index);
    this.document.tiers.setIgnored(index, !ignored);
    const after = this.document.tiers.snapshot();
    this.undoStack.do({
      label: t("segmenter.cmd.ignore", "Toggle ignore"),
      apply: () => this.document.tiers.replaceAll(after),
      revert: () => this.document.tiers.replaceAll(before),
    });
    this.document.bumpVersion();
    this.scheduleAutoSave();
  }

  // ── Oral-file name tracker (op computation, index-staleness-proof) ───────────
  private oralKey(startSec: number, endSec: number, kind: OralAnnotationKind): string {
    return `${csFloatToString(startSec)}|${csFloatToString(endSec)}|${kind}`;
  }

  /**
   * Current disk name of a segment's WAV: the live map first (reflects
   * not-yet-flushed renames), else the index (accurate for a range untouched
   * since the last flush). Comma-decimal disk names are preserved for the first
   * hop because the index reports the real on-disk name.
   */
  private oralNameFor(range: TimeRange, kind: OralAnnotationKind): string | undefined {
    const cached = this.oralNames.get(this.oralKey(range.start, range.end, kind));
    if (cached !== undefined) return cached;
    return this.oralIndex?.getFilesForRange(range).find((e) => e.kind === kind)?.name;
  }

  private snapshotOral(): [string, string][] {
    return [...this.oralNames];
  }

  /**
   * Rename ops to follow a boundary from `oldRange` to `newRange`, read from the
   * live name map (not the possibly-stale index). The first hop uses the real
   * disk name; later hops within the same debounce chain via canonical names, so
   * coalescing yields the correct net rename even for rapid successive edits.
   */
  private renameOralFor(oldRange: TimeRange, newRange: TimeRange): FileOp[] {
    const ops: FileOp[] = [];
    for (const kind of ORAL_KINDS) {
      const from = this.oralNameFor(oldRange, kind);
      if (!from) continue;
      const to = segmentWavName(this.document.mediaFileName, newRange, kind);
      if (from !== to) ops.push({ kind: "rename", from, to });
    }
    return ops;
  }

  private deleteOralFor(range: TimeRange): FileOp[] {
    const ops: FileOp[] = [];
    for (const kind of ORAL_KINDS) {
      const name = this.oralNameFor(range, kind);
      if (name) ops.push({ kind: "delete", name });
    }
    return ops;
  }

  /** Fold a successful edit's ops into the live name map (rekey renames, drop deletes). */
  private applyOpsToTracker(ops: readonly FileOp[]): void {
    for (const op of ops) {
      const name = op.kind === "rename" ? op.from : op.name;
      for (const [key, value] of this.oralNames) {
        if (value === name) {
          this.oralNames.delete(key);
          break;
        }
      }
      if (op.kind === "rename") {
        const parsed = ORAL_BASE_RE.exec(op.to.slice(op.to.lastIndexOf("/") + 1));
        if (parsed) {
          const kind: OralAnnotationKind =
            parsed[3].toLowerCase() === "_careful" ? "Careful" : "Translation";
          this.oralNames.set(
            this.oralKey(parseCsFloat(parsed[1]), parseCsFloat(parsed[2]), kind),
            op.to,
          );
        }
      }
    }
  }

  undo(): void {
    this.undoStack.undo();
    this.clearSelection();
    this.document.bumpVersion();
    this.scheduleAutoSave();
  }
  redo(): void {
    this.undoStack.redo();
    this.clearSelection();
    this.document.bumpVersion();
    this.scheduleAutoSave();
  }
  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }
  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  /**
   * A boundary is "immovable" when its segment already has an oral-annotation
   * recording (SayMore draws these blue instead of the movable-orange). No oral
   * index (or no recording) → movable.
   */
  isBoundaryImmovable(index: number): boolean {
    const seg = this.segments[index];
    if (!seg || !this.oralIndex) return false;
    return this.oralIndex.hasAnyForRange(seg.range);
  }

  /** True if deleting segment `index` would touch an existing oral recording. */
  requiresPermanenceConfirm(index: number): boolean {
    if (!this.oralIndex) return false;
    const segs = this.segments;
    const touchesSelf = !!segs[index] && this.oralIndex.hasAnyForRange(segs[index].range);
    const next = segs[index + 1];
    return touchesSelf || (!!next && this.oralIndex.hasAnyForRange(next.range));
  }

  // ── Finalize (segmenter exit) ──────────────────────────────────────────────
  /**
   * Finalization on segmenter exit (SayMore's commit-on-OK): apply the end-of-file
   * rules, then do a final {@link flush} (WAV reconcile + eaf together), then clear
   * undo history and adopt the persisted folder as the reconciler's new baseline.
   *
   * Continuous persistence no longer depends on this — every edit's eaf write and
   * oral-file journal already land together via the debounced {@link flush}. What
   * remains unique to finalize is the end-of-file rules (extend/trailing-ignored),
   * which are a finalization step, not a per-edit transform, so they run only here.
   */
  async save(): Promise<void> {
    if (!this.adapter) throw new Error("SegmenterViewModel: no adapter (single-file mode)");
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
    this.document.tiers.applyEndOfFileRules(this.durationSec);
    this.document.tiers.trimToDuration(this.durationSec);
    this.document.bumpVersion();
    await this.flush();
    this.undoStack.clear();
    this.reconciler?.commitBaseline();
  }

  /** Serialize without writing — used by single-file (download) mode. */
  serialize(): string {
    this.document.tiers.applyEndOfFileRules(this.durationSec);
    this.document.tiers.trimToDuration(this.durationSec);
    return this.document.serialize();
  }

  dispose(): void {
    this.clearReplayTimer();
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.playback.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private computeMoveFileOps(k: number, newEnd: number): FileOp[] {
    const segs = this.segments;
    const cur = segs[k];
    const ops = this.renameOralFor(cur.range, makeTimeRange(cur.range.start, newEnd));
    const next = segs[k + 1];
    if (next) {
      ops.push(...this.renameOralFor(next.range, makeTimeRange(newEnd, next.range.end)));
    }
    return ops;
  }

  private computeDeleteFileOps(k: number): FileOp[] {
    const segs = this.segments;
    const removed = segs[k];
    const ops = this.deleteOralFor(removed.range);
    const next = segs[k + 1];
    if (next) {
      ops.push(
        ...this.renameOralFor(next.range, makeTimeRange(removed.range.start, next.range.end)),
      );
    }
    return ops;
  }

  private scheduleReplay(boundarySec: number, segmentIndex: number): void {
    this.clearReplayTimer();
    const prevBoundary = segmentIndex > 0 ? this.segments[segmentIndex - 1].range.end : 0;
    const start = Math.max(0, prevBoundary, boundarySec - REPLAY_WINDOW_MS / 1000);
    this.replayTimer = setTimeout(() => {
      void this.playback.play(makeTimeRange(start, boundarySec));
    }, REPLAY_DELAY_MS);
  }

  private clearReplayTimer(): void {
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = undefined;
    }
  }

  private flashTooShort(): void {
    this.warning = t("segmenter.warning.tooShort", "Whoops! The segment will be too short.");
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.warningTimer = setTimeout(() => {
      this.warning = undefined;
    }, TOO_SHORT_WARNING_MS);
  }
}
