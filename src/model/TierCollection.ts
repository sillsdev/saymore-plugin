import { makeAutoObservable } from "mobx";
import type { AnnotationSegment } from "./AnnotationSegment";
import { IGNORE_MARKER, isSegmentIgnored } from "./IgnoreMarkers";
import { isTranscriptionComplete, isTranslationComplete } from "./Completeness";
import {
  BoundaryResult,
  addFinalSegmentIfAlmostComplete,
  clampBoundaryPosition,
  deleteSegment,
  indexOfSegmentEndingAt,
  insertBoundary,
  moveBoundary,
  nudgeBoundary,
  trimSegmentsToDuration
} from "./BoundaryRules";

/**
 * The observable positional model of the three SayMore tiers (the "Source" time
 * tier plus the Transcription and Phrase Free Translation text tiers), bundled
 * per-row into `AnnotationSegment`. All boundary mutations delegate to the pure
 * `BoundaryRules` functions and swap in the resulting array so MobX observers
 * (the segmenter, the future grid) update. Snapshot/replaceAll back the UndoStack.
 */
export class TierCollection {
  segments: AnnotationSegment[] = [];

  constructor(segments: AnnotationSegment[] = []) {
    this.segments = segments;
    makeAutoObservable(this);
  }

  get count(): number {
    return this.segments.length;
  }

  /** Movable boundaries = each segment's end time, in order. */
  get endBoundaries(): number[] {
    return this.segments.map((s) => s.range.end);
  }

  indexOfSegmentEndingAt(boundarySec: number): number {
    return indexOfSegmentEndingAt(this.segments, boundarySec);
  }

  /** Index of the segment enclosing `seconds` ([start, end)), or -1. */
  indexOfSegmentAt(seconds: number): number {
    return this.segments.findIndex(
      (s) => seconds >= s.range.start && seconds < s.range.end
    );
  }

  // ── Undo support ────────────────────────────────────────────────────────
  snapshot(): AnnotationSegment[] {
    return this.segments.map((s) => ({
      range: s.range,
      transcription: s.transcription,
      freeTranslation: s.freeTranslation
    }));
  }

  replaceAll(segments: readonly AnnotationSegment[]): void {
    this.segments = segments.map((s) => ({
      range: s.range,
      transcription: s.transcription,
      freeTranslation: s.freeTranslation
    }));
  }

  // ── Boundary edits (return the SayMore result code) ─────────────────────
  insertBoundary(boundarySec: number): BoundaryResult {
    const { result, segments } = insertBoundary(this.segments, boundarySec);
    if (result === BoundaryResult.Success) this.segments = segments.slice();
    return result;
  }

  moveBoundary(index: number, newEndSec: number): BoundaryResult {
    const { result, segments } = moveBoundary(this.segments, index, newEndSec);
    if (result === BoundaryResult.Success) this.segments = segments.slice();
    return result;
  }

  clampBoundaryPosition(index: number, desiredSec: number, durationSec: number): number {
    return clampBoundaryPosition(this.segments, index, desiredSec, durationSec);
  }

  nudgeBoundary(index: number, deltaMs: number, durationSec: number): BoundaryResult {
    const { result, segments } = nudgeBoundary(this.segments, index, deltaMs, durationSec);
    if (result === BoundaryResult.Success) this.segments = segments.slice();
    return result;
  }

  deleteSegment(index: number): BoundaryResult {
    const { result, segments } = deleteSegment(this.segments, index);
    if (result === BoundaryResult.Success) this.segments = segments.slice();
    return result;
  }

  // ── Text / ignore edits ─────────────────────────────────────────────────
  setTranscription(index: number, text: string): void {
    if (index < 0 || index >= this.segments.length) return;
    this.segments[index].transcription = text;
  }

  setFreeTranslation(index: number, text: string): void {
    if (index < 0 || index >= this.segments.length) return;
    this.segments[index].freeTranslation = text;
  }

  isSegmentIgnored(index: number): boolean {
    const s = this.segments[index];
    return s ? isSegmentIgnored(s) : false;
  }

  setIgnored(index: number, ignored: boolean): void {
    if (index < 0 || index >= this.segments.length) return;
    // SayMore writes "%ignore%" to ignore and clears the text to un-ignore.
    this.segments[index].transcription = ignored ? IGNORE_MARKER : "";
  }

  // ── End-of-file rules (on save/OK) ───────────────────────────────────────
  applyEndOfFileRules(durationSec: number): void {
    this.segments = addFinalSegmentIfAlmostComplete(this.segments, durationSec).slice();
  }

  trimToDuration(durationSec: number): void {
    this.segments = trimSegmentsToDuration(this.segments, durationSec).slice();
  }

  // ── Completeness ─────────────────────────────────────────────────────────
  get isTranscriptionComplete(): boolean {
    return isTranscriptionComplete(this.segments);
  }

  get isTranslationComplete(): boolean {
    return isTranslationComplete(this.segments);
  }
}
