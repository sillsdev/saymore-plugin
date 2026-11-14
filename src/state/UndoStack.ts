import { makeAutoObservable } from "mobx";
import type { FileOp } from "../fs/OralAnnotationFiles";
import type { TimeRange } from "../model/TimeRange";

/**
 * `FileOp` (rename/delete of an oral-annotation WAV) is journaled by boundary
 * edits and applied only on save — see `fs/OralAnnotationFiles`.
 */
export type { FileOp };

/**
 * One reversible edit. `apply`/`revert` mutate the model (typically via
 * `TierCollection.replaceAll(snapshot)`); `fileOps` are the deferred disk ops
 * this edit implies, applied only on save.
 */
export interface Command {
  label: string;
  apply(): void;
  revert(): void;
  fileOps?: FileOp[];
  /** The media time range this change acted on (recorder: C# TimeRangeForUndo). */
  timeRange?: TimeRange;
}

/** A command on one of the stacks, with the state key it leaves the model in. */
interface Entry {
  command: Command;
  /** `stateKey()` right after this entry's last apply (undo stack) or revert (redo stack). */
  key: string | undefined;
}

/**
 * Command-pattern undo/redo with a coalesced deferred-FileOp journal (plan:
 * "recorder-ready undo"). `collectFileOps()` returns the net ops implied by the
 * currently-applied (not-undone) commands, in order, for the save step to
 * coalesce and apply through the FileSystemAdapter.
 *
 * Commands restore whole snapshots, so undoing one after the model changed by a
 * route outside this stack would overwrite that change. Given `stateKey` (a string
 * that changes whenever the model does), the stack undoes or redoes a command only
 * while the model is in the state that the stack's last step left it in; otherwise
 * it drops its history. The file ops of dropped commands that are applied stay in
 * `collectFileOps()`, because their disk changes stand.
 */
export class UndoStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  /** File ops of applied commands whose history was dropped. */
  private keptFileOps: FileOp[] = [];

  constructor(private readonly stateKey?: () => string) {
    makeAutoObservable<UndoStack, "undoStack" | "redoStack" | "keptFileOps" | "stateKey">(this, {
      undoStack: true,
      redoStack: true,
      keptFileOps: false,
      stateKey: false,
    });
  }

  get canUndo(): boolean {
    return this.isUsable(this.undoStack);
  }

  get canRedo(): boolean {
    return this.isUsable(this.redoStack);
  }

  get undoLabel(): string | undefined {
    return this.canUndo ? this.top(this.undoStack).command.label : undefined;
  }

  /** The time range of the next command to be undone, if it carries one. */
  get undoTimeRange(): TimeRange | undefined {
    return this.canUndo ? this.top(this.undoStack).command.timeRange : undefined;
  }

  /** Run and record a command. Clears the redo stack. */
  do(command: Command): void {
    command.apply();
    this.undoStack.push({ command, key: this.stateKey?.() });
    this.redoStack = [];
  }

  /** Revert the last command; drops the history instead when the model changed outside it. */
  undo(): void {
    if (this.undoStack.length === 0) return;
    if (!this.canUndo) {
      this.dropHistory();
      return;
    }
    const { command } = this.undoStack.pop()!;
    command.revert();
    this.redoStack.push({ command, key: this.stateKey?.() });
  }

  /** Re-apply the last undone command; drops the history instead when the model changed outside it. */
  redo(): void {
    if (this.redoStack.length === 0) return;
    if (!this.canRedo) {
      this.dropHistory();
      return;
    }
    const { command } = this.redoStack.pop()!;
    command.apply();
    this.undoStack.push({ command, key: this.stateKey?.() });
  }

  /** All deferred file ops from applied commands, in application order. */
  collectFileOps(): FileOp[] {
    return [...this.keptFileOps, ...this.undoStack.flatMap((e) => e.command.fileOps ?? [])];
  }

  /**
   * Forget every command without changing the model; the file ops of applied
   * commands stay in {@link collectFileOps}.
   */
  dropHistory(): void {
    this.keptFileOps = this.collectFileOps();
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Forget every command and its file ops (the folder on disk is the new origin). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.keptFileOps = [];
  }

  private top(stack: Entry[]): Entry {
    return stack[stack.length - 1];
  }

  private isUsable(stack: Entry[]): boolean {
    if (stack.length === 0) return false;
    return !this.stateKey || this.top(stack).key === this.stateKey();
  }
}
