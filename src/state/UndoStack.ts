import { makeAutoObservable } from "mobx";
import type { FileOp } from "../fs/OralAnnotationFiles";

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
}

/**
 * Command-pattern undo/redo with a coalesced deferred-FileOp journal (plan:
 * "recorder-ready undo"). `collectFileOps()` returns the net ops implied by the
 * currently-applied (not-undone) commands, in order, for the save step to
 * coalesce and apply through the FileSystemAdapter.
 */
export class UndoStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor() {
    makeAutoObservable<UndoStack, "undoStack" | "redoStack">(this, {
      undoStack: true,
      redoStack: true,
    });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  /** Run and record a command. Clears the redo stack. */
  do(command: Command): void {
    command.apply();
    this.undoStack.push(command);
    this.redoStack = [];
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.revert();
    this.redoStack.push(command);
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.apply();
    this.undoStack.push(command);
  }

  /** All deferred file ops from applied commands, in application order. */
  collectFileOps(): FileOp[] {
    return this.undoStack.flatMap((c) => c.fileOps ?? []);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
