import type { FileSystemAdapter } from "./FileSystemAdapter";
import type { TimeRange } from "../model/TimeRange";
import { csFloatToString, parseCsFloat } from "./csFloat";
import {
  ANNOTATIONS_FOLDER_SUFFIX,
  CAREFUL_SUFFIX,
  TRANSLATION_SUFFIX
} from "../model/SayMoreConstants";

/**
 * Naming + indexing for the sibling `<media>_Annotations/` folder of per-segment
 * Careful Speech / Oral Translation WAVs. Boundary edits journal `FileOp`s
 * (rename/delete) that are coalesced and applied on save. Even when a session
 * has no such folder the mechanism exists (ops are simply empty) because the
 * grid and recorder tracks build on it.
 */

export type OralAnnotationKind = "Careful" | "Translation";

/** A deferred file operation, relative to the session folder (forward-slash). */
export type FileOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; name: string };

export function oralAnnotationsFolderName(mediaFileName: string): string {
  return `${mediaFileName}${ANNOTATIONS_FOLDER_SUFFIX}`;
}

function suffixFor(kind: OralAnnotationKind): string {
  return kind === "Careful" ? CAREFUL_SUFFIX : TRANSLATION_SUFFIX;
}

/** Relative path of a segment's WAV, e.g. `X.wav_Annotations/0.75_to_1.25_Careful.wav`. */
export function segmentWavName(
  mediaFileName: string,
  range: TimeRange,
  kind: OralAnnotationKind
): string {
  const folder = oralAnnotationsFolderName(mediaFileName);
  return `${folder}/${csFloatToString(range.start)}_to_${csFloatToString(range.end)}${suffixFor(kind)}`;
}

interface OralFileEntry {
  /** Full relative path within the session folder. */
  name: string;
  start: number;
  end: number;
  /** The literal decimal tokens as they appear on disk (reused on rename). */
  rawStartToken: string;
  rawEndToken: string;
  kind: OralAnnotationKind;
}

const FILE_RE = /^(.+)_to_(.+?)(_Careful|_Translation)\.wav$/i;

function parseEntry(mediaFileName: string, name: string): OralFileEntry | undefined {
  const prefix = `${oralAnnotationsFolderName(mediaFileName)}/`;
  if (!name.startsWith(prefix)) return undefined;
  const base = name.slice(prefix.length);
  const m = FILE_RE.exec(base);
  if (!m) return undefined;
  const [, startTok, endTok, kindTok] = m;
  const kind: OralAnnotationKind =
    kindTok.toLowerCase() === "_careful" ? "Careful" : "Translation";
  return {
    name,
    start: parseCsFloat(startTok),
    end: parseCsFloat(endTok),
    rawStartToken: startTok,
    rawEndToken: endTok,
    kind
  };
}

/**
 * Coalesce a journal of FileOps into the minimal net set: fold rename chains
 * (a→b, b→c ⇒ a→c), let a later delete supersede prior renames of the same file,
 * and drop no-ops (from === to).
 */
export function coalesceFileOps(ops: readonly FileOp[]): FileOp[] {
  const currentToOriginal = new Map<string, string>();
  const originalToCurrent = new Map<string, string>();
  const deleted = new Set<string>();

  const seed = (path: string): string => {
    const existing = currentToOriginal.get(path);
    if (existing !== undefined) return existing;
    currentToOriginal.set(path, path);
    originalToCurrent.set(path, path);
    return path;
  };

  for (const op of ops) {
    if (op.kind === "rename") {
      const origin = seed(op.from);
      currentToOriginal.delete(op.from);
      currentToOriginal.set(op.to, origin);
      originalToCurrent.set(origin, op.to);
    } else {
      const origin = seed(op.name);
      currentToOriginal.delete(op.name);
      originalToCurrent.delete(origin);
      deleted.add(origin);
    }
  }

  const out: FileOp[] = [];
  for (const name of deleted) out.push({ kind: "delete", name });
  for (const [origin, current] of originalToCurrent) {
    if (origin !== current) out.push({ kind: "rename", from: origin, to: current });
  }
  return out;
}

/**
 * A scanned index of the oral-annotation WAVs beside a media file, with the
 * permanence lookups and rename/delete op builders the segmenter needs.
 */
export class OralAnnotationIndex {
  private entries: OralFileEntry[] = [];

  private constructor(
    private readonly adapter: FileSystemAdapter,
    private readonly mediaFileName: string
  ) {}

  static async build(
    adapter: FileSystemAdapter,
    mediaFileName: string
  ): Promise<OralAnnotationIndex> {
    const index = new OralAnnotationIndex(adapter, mediaFileName);
    await index.refresh();
    return index;
  }

  async refresh(): Promise<void> {
    const names = await this.adapter.list();
    this.entries = names
      .map((n) => parseEntry(this.mediaFileName, n))
      .filter((e): e is OralFileEntry => e !== undefined);
  }

  get count(): number {
    return this.entries.length;
  }

  /** Entries whose [start,end] matches `range` (ms-granular via canonical tokens). */
  getFilesForRange(range: TimeRange): OralFileEntry[] {
    const startTok = csFloatToString(range.start);
    const endTok = csFloatToString(range.end);
    return this.entries.filter(
      (e) => csFloatToString(e.start) === startTok && csFloatToString(e.end) === endTok
    );
  }

  /** True if this segment already has a Careful/Translation recording (permanence). */
  hasAnyForRange(range: TimeRange): boolean {
    return this.getFilesForRange(range).length > 0;
  }

  /** Rename ops to follow a boundary move, reusing the unchanged endpoint's literal token. */
  computeRenameOps(oldRange: TimeRange, newRange: TimeRange): FileOp[] {
    const startUnchanged = csFloatToString(oldRange.start) === csFloatToString(newRange.start);
    const endUnchanged = csFloatToString(oldRange.end) === csFloatToString(newRange.end);
    const folder = oralAnnotationsFolderName(this.mediaFileName);
    return this.getFilesForRange(oldRange).flatMap((e) => {
      const newStartToken = startUnchanged ? e.rawStartToken : csFloatToString(newRange.start);
      const newEndToken = endUnchanged ? e.rawEndToken : csFloatToString(newRange.end);
      const to = `${folder}/${newStartToken}_to_${newEndToken}${suffixFor(e.kind)}`;
      if (to === e.name) return [];
      return [{ kind: "rename", from: e.name, to } as FileOp];
    });
  }

  /** Delete ops for a segment's recordings. */
  computeDeleteOps(range: TimeRange): FileOp[] {
    return this.getFilesForRange(range).map((e) => ({ kind: "delete", name: e.name }));
  }

  /** Read a segment's recording bytes, or undefined if absent. */
  async readSegmentWav(
    range: TimeRange,
    kind: OralAnnotationKind
  ): Promise<Uint8Array | undefined> {
    const entry = this.getFilesForRange(range).find((e) => e.kind === kind);
    if (!entry) return undefined;
    return this.adapter.readBytes(entry.name);
  }

  /** Coalesce and apply a journal of ops through the adapter, then re-scan. */
  async applyOps(ops: readonly FileOp[]): Promise<void> {
    const coalesced = coalesceFileOps(ops);
    for (const op of coalesced) {
      if (op.kind === "rename") {
        if (await this.adapter.exists(op.from)) await this.adapter.rename(op.from, op.to);
      } else if (await this.adapter.exists(op.name)) {
        await this.adapter.delete(op.name);
      }
    }
    await this.refresh();
  }
}
