import { makeAutoObservable, runInAction } from "mobx";
import type { TimeRange } from "../../model/TimeRange";
import { makeTimeRange } from "../../model/TimeRange";
import type { FileSystemAdapter } from "../../fs/FileSystemAdapter";
import {
  oralAnnotationsFolderName,
  segmentWavName,
  type OralAnnotationIndex,
  type OralAnnotationKind,
} from "../../fs/OralAnnotationFiles";
import { parseCsFloat } from "../../fs/csFloat";

/**
 * A reversible overlay mutation for the {@link UndoStack}. `apply`/`revert` run
 * **synchronously** against the in-memory overlay (so `annotated?`, cell
 * mini-waveforms and playback update immediately and undo is instant); the
 * matching disk write/delete is enqueued on the serialized queue and each disk
 * op is followed by `oralIndex.refresh()`.
 */
export interface RecordingMutation {
  apply(): void;
  revert(): void;
}

/** Basename of an annotation WAV within the `<media>_Annotations/` folder. */
const ANNOTATION_BASE_RE = /^(.+)_to_(.+?)(_Careful|_Translation)\.wav$/i;

/**
 * The recorder's persistence core: a synchronous in-memory overlay
 * (`Map<relPath, bytes>`, pre-warmed from disk) that is the source of truth for
 * "does this segment have a recording of this kind?", the cell mini-waveforms
 * and per-clip playback — plus a serialized async adapter queue so a
 * record→undo→re-record burst can never race on disk. Every disk op is followed
 * by {@link OralAnnotationIndex.refresh} so the segmenter's permanence view
 * stays correct. Filenames are ALWAYS produced by {@link segmentWavName}
 * (csFloat parity — never `toString()` a number into a path).
 */
export class RecordingFileStore {
  /** relPath → bytes. Keys are canonical {@link segmentWavName} paths. */
  private overlay = new Map<string, Uint8Array>();
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly adapter: FileSystemAdapter | undefined,
    private readonly oralIndex: OralAnnotationIndex | undefined,
    private readonly mediaFileName: string,
  ) {
    makeAutoObservable<
      RecordingFileStore,
      "overlay" | "queue" | "adapter" | "oralIndex" | "mediaFileName"
    >(this, {
      overlay: true,
      queue: false,
      adapter: false,
      oralIndex: false,
      mediaFileName: false,
    });
  }

  /** Build a store and pre-warm the overlay from the existing annotation WAVs. */
  static async build(
    adapter: FileSystemAdapter | undefined,
    oralIndex: OralAnnotationIndex | undefined,
    mediaFileName: string,
  ): Promise<RecordingFileStore> {
    const store = new RecordingFileStore(adapter, oralIndex, mediaFileName);
    await store.prewarm();
    return store;
  }

  private async prewarm(): Promise<void> {
    if (!this.adapter) return;
    const names = await this.adapter.list();
    const loaded: Array<[string, Uint8Array]> = [];
    for (const name of names) {
      const key = this.canonicalKey(name);
      if (!key) continue;
      loaded.push([key, await this.adapter.readBytes(name)]);
    }
    runInAction(() => {
      for (const [key, bytes] of loaded) this.overlay.set(key, bytes);
    });
  }

  /** Canonical overlay key for a disk path, or undefined if it isn't an annotation WAV. */
  private canonicalKey(name: string): string | undefined {
    const prefix = `${oralAnnotationsFolderName(this.mediaFileName)}/`;
    if (!name.startsWith(prefix)) return undefined;
    const m = ANNOTATION_BASE_RE.exec(name.slice(prefix.length));
    if (!m) return undefined;
    const [, startTok, endTok, kindTok] = m;
    const kind: OralAnnotationKind =
      kindTok.toLowerCase() === "_careful" ? "Careful" : "Translation";
    return segmentWavName(
      this.mediaFileName,
      makeTimeRange(parseCsFloat(startTok), parseCsFloat(endTok)),
      kind,
    );
  }

  private keyFor(range: TimeRange, kind: OralAnnotationKind): string {
    return segmentWavName(this.mediaFileName, range, kind);
  }

  // ── Synchronous reads (overlay is the source of truth) ──────────────────────
  has(range: TimeRange, kind: OralAnnotationKind): boolean {
    return this.overlay.has(this.keyFor(range, kind));
  }

  hasAny(range: TimeRange): boolean {
    return this.has(range, "Careful") || this.has(range, "Translation");
  }

  get(range: TimeRange, kind: OralAnnotationKind): Uint8Array | undefined {
    return this.overlay.get(this.keyFor(range, kind));
  }

  // ── Reversible mutations ────────────────────────────────────────────────────
  /**
   * Write (or overwrite) a segment's recording. `apply` sets the overlay and
   * enqueues the disk write; `revert` restores the previous bytes (re-record) or
   * removes the file (fresh recording). Re-runnable for redo.
   */
  writeRecording(range: TimeRange, kind: OralAnnotationKind, bytes: Uint8Array): RecordingMutation {
    const key = this.keyFor(range, kind);
    const prev = this.overlay.get(key);
    return {
      apply: () => {
        this.overlay.set(key, bytes);
        this.enqueueWrite(key, bytes);
      },
      revert: () => {
        if (prev !== undefined) {
          this.overlay.set(key, prev);
          this.enqueueWrite(key, prev);
        } else {
          this.overlay.delete(key);
          this.enqueueDelete(key);
        }
      },
    };
  }

  /** Erase a segment's recording (undoable — revert restores the prior bytes). */
  eraseRecording(range: TimeRange, kind: OralAnnotationKind): RecordingMutation {
    const key = this.keyFor(range, kind);
    const prev = this.overlay.get(key);
    return {
      apply: () => {
        this.overlay.delete(key);
        this.enqueueDelete(key);
      },
      revert: () => {
        if (prev !== undefined) {
          this.overlay.set(key, prev);
          this.enqueueWrite(key, prev);
        }
      },
    };
  }

  /** Resolves once every queued disk op (and its index refresh) has settled. */
  whenSettled(): Promise<void> {
    return this.queue;
  }

  // ── Serialized disk queue (each op then refreshes the oral index) ────────────
  private enqueueWrite(key: string, bytes: Uint8Array): void {
    this.enqueueDisk(async (adapter) => {
      await adapter.writeBytes(key, bytes);
    });
  }

  private enqueueDelete(key: string): void {
    this.enqueueDisk(async (adapter) => {
      if (await adapter.exists(key)) await adapter.delete(key);
    });
  }

  private enqueueDisk(op: (adapter: FileSystemAdapter) => Promise<void>): void {
    const adapter = this.adapter;
    if (!adapter) return; // single-file mode: overlay only, nothing to persist
    this.queue = this.queue
      .then(() => op(adapter))
      .then(() => this.oralIndex?.refresh())
      .catch(() => {
        // Best-effort persistence (mirrors the segmenter's autosave); the overlay
        // remains the authoritative in-memory truth if a disk op fails.
      });
  }
}
