import { makeAutoObservable, runInAction } from "mobx";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { annotationsEafName } from "../fs/SessionFolder";
import type { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import type { SegmenterViewModel } from "./SegmenterViewModel";

/** How often the `.eaf` modification time is checked while the page is visible. */
export const EXTERNAL_POLL_MS = 2000;

export interface ExternalChangeWatcherDeps {
  adapter: FileSystemAdapter;
  document: AnnotationDocumentStore;
  segmenter?: SegmenterViewModel;
  /** Called after a reload so the owner can refresh state derived from other files. */
  onReloaded?: () => Promise<void>;
  /** Subscribe through `adapter.watch` when it exists (default true); false forces polling. */
  useAdapterWatch?: boolean;
}

/**
 * Notices when the session's `.eaf` is changed by another program (ELAN, SayMore) and
 * brings the document in line with it. A clean document reloads silently. A document
 * with unsaved edits holds its writes and raises {@link conflict} until the user picks
 * {@link reload} or {@link keepMine}.
 *
 * The plugin's own writes carry the modification time recorded by
 * `AnnotationDocumentStore.save`, so they never count as external.
 */
export class ExternalChangeWatcher {
  /** True while an external change waits for the user's decision. */
  conflict = false;

  private readonly eafName: string;
  private baselineMs: number | undefined;
  private ready: Promise<void>;
  private busy = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unwatch: (() => void) | undefined;
  private readonly onFocus = () => void this.check();
  private readonly onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible")
      void this.check();
  };

  constructor(private readonly deps: ExternalChangeWatcherDeps) {
    this.eafName = annotationsEafName(deps.document.mediaFileName);
    makeAutoObservable<
      ExternalChangeWatcher,
      | "baselineMs"
      | "ready"
      | "busy"
      | "disposed"
      | "timer"
      | "unwatch"
      | "onFocus"
      | "onVisibility"
    >(
      this,
      {
        baselineMs: false,
        ready: false,
        busy: false,
        disposed: false,
        timer: false,
        unwatch: false,
        onFocus: false,
        onVisibility: false,
      },
      { autoBind: true },
    );
    this.ready = deps.adapter.getModifiedMs(this.eafName).then((ms) => {
      this.baselineMs = ms;
    });
    if (deps.useAdapterWatch !== false && deps.adapter.watch) {
      this.unwatch = deps.adapter.watch((name) => {
        if (name === this.eafName) void this.check();
      });
    } else {
      this.timer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          void this.check();
        }
      }, EXTERNAL_POLL_MS);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.onFocus);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.unwatch?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.onFocus);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.deps.document.holdWrites = false;
  }

  /** Compare the file's modification time with what this plugin last saw, and react to a difference. */
  async check(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      await this.ready;
      const { adapter, document } = this.deps;
      if (document.savesInFlight > 0) return;
      const ms = await adapter.getModifiedMs(this.eafName);
      if (this.disposed || ms === undefined || document.savesInFlight > 0) return;
      if (ms === this.baselineMs) return;
      if (ms === document.lastOwnWriteMs) {
        this.baselineMs = ms;
        return;
      }
      if (document.isDirty || this.conflict) {
        this.baselineMs = ms;
        runInAction(() => {
          this.conflict = true;
          document.holdWrites = true;
        });
        return;
      }
      await this.loadFromDisk(ms, false);
    } catch {
      // The file may be mid-write or briefly locked; the next check tries again.
    } finally {
      this.busy = false;
    }
  }

  /** Conflict choice: discard the unsaved edits and take the file as it is on disk. */
  async reload(): Promise<void> {
    await this.ready;
    const ms = await this.deps.adapter.getModifiedMs(this.eafName);
    await this.loadFromDisk(ms, true);
  }

  /** Conflict choice: keep the unsaved edits and write them over the file. */
  async keepMine(): Promise<void> {
    const { adapter, document, segmenter } = this.deps;
    runInAction(() => {
      this.conflict = false;
      document.holdWrites = false;
    });
    if (segmenter) await segmenter.flushPending();
    else await document.save(adapter);
  }

  private async loadFromDisk(ms: number | undefined, discardEdits: boolean): Promise<void> {
    const { adapter, document, segmenter, onReloaded } = this.deps;
    const text = await adapter.readText(this.eafName);
    if (this.disposed) return;
    if (!discardEdits && document.isDirty) {
      // An edit landed while the file was being read.
      this.baselineMs = ms;
      runInAction(() => {
        this.conflict = true;
        document.holdWrites = true;
      });
      return;
    }
    if (segmenter) await segmenter.reloadFromDisk(text);
    else runInAction(() => document.reloadFrom(text));
    this.baselineMs = ms;
    runInAction(() => {
      this.conflict = false;
    });
    await onReloaded?.();
  }
}
