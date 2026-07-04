import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { coalesceFileOps, type FileOp } from "../fs/OralAnnotationFiles";

/** Where an original oral WAV currently lives: a relative path, or null if deleted. */
type Target = string | null;

function buildTargets(coalesced: readonly FileOp[]): Map<string, Target> {
  const targets = new Map<string, Target>();
  for (const op of coalesced) {
    if (op.kind === "rename") targets.set(op.from, op.to);
    else targets.set(op.name, null);
  }
  return targets;
}

/**
 * Keeps the `<media>_Annotations/` WAVs on disk consistent with the segmenter's
 * model at every debounced flush — the fix for the pre-existing bug where the
 * autosave wrote only the EAF, leaving boundary-moved recordings orphaned on a
 * crash.
 *
 * Rather than replay an op journal (which double-applies once disk has partially
 * moved), it computes the NET desired location of each original WAV from the
 * undo stack's coalesced ops and applies only the DELTA versus what it last
 * flushed. This makes undo/redo self-correcting: undoing a flushed rename yields
 * the reverse rename next flush, and undoing a flushed delete restores the file
 * from an in-memory backup (recordings are precious — a crash loses nothing).
 */
export class OralFileReconciler {
  /** original relPath → where it currently sits on disk (per what we last flushed). */
  private lastTargets = new Map<string, Target>();
  /** original relPath → bytes, captured before a delete so undo can restore it. */
  private readonly backups = new Map<string, Uint8Array>();

  constructor(private readonly adapter: FileSystemAdapter) {}

  /**
   * Reconcile disk to the net effect of `ops` (the undo stack's collected file
   * ops, relative to the originally-loaded folder). Idempotent: re-reconciling
   * the same net state is a no-op.
   */
  async reconcile(ops: readonly FileOp[]): Promise<void> {
    const current = buildTargets(coalesceFileOps(ops));
    const originals = new Set<string>([...this.lastTargets.keys(), ...current.keys()]);

    for (const original of originals) {
      const from = this.lastTargets.has(original) ? this.lastTargets.get(original)! : original;
      const to = current.has(original) ? current.get(original)! : original;
      if (from === to) continue;

      if (from !== null && to !== null) {
        // Moved (or reverted move): rename its current disk location to the new one.
        if (await this.adapter.exists(from)) await this.adapter.rename(from, to);
      } else if (from !== null && to === null) {
        // Newly deleted: back up its bytes first so an undo can restore it.
        if (await this.adapter.exists(from)) {
          this.backups.set(original, await this.adapter.readBytes(from));
          await this.adapter.delete(from);
        }
      } else if (from === null && to !== null) {
        // Undo of a delete: restore the backed-up bytes to the target name.
        const bytes = this.backups.get(original);
        if (bytes) await this.adapter.writeBytes(to, bytes);
      }
    }

    this.lastTargets = current;
  }

  /**
   * Adopt the current on-disk state as the new origin. Call after the undo stack
   * is cleared (a finalize/commit point): subsequent `collectFileOps()` are then
   * relative to the just-persisted folder, so the next reconcile starts fresh.
   */
  commitBaseline(): void {
    this.lastTargets = new Map();
    this.backups.clear();
  }
}
