/**
 * THE seam between the annotation tools and wherever the files live. All names
 * are **relative to a single session folder** (the media file's directory);
 * nested paths (e.g. inside `<media>_Annotations/`) use forward slashes.
 *
 * This interface deliberately mirrors the `companions.*` file methods proposed
 * to the lameta plugin-design effort, so plugin integration becomes one
 * postMessage-backed adapter with no other code changes. The dev harness uses
 * BrowserDirectoryAdapter (File System Access API); tests use InMemoryAdapter.
 */
export interface FileSystemAdapter {
  /** All file names in the session folder (recursive, forward-slash relative). */
  list(): Promise<string[]>;

  exists(name: string): Promise<boolean>;

  readBytes(name: string): Promise<Uint8Array>;
  readText(name: string): Promise<string>;

  writeBytes(name: string, data: Uint8Array): Promise<void>;
  writeText(name: string, text: string): Promise<void>;

  /**
   * Rename within the session folder. The File System Access API has no native
   * rename, so BrowserDirectoryAdapter implements this as copy+delete.
   */
  rename(from: string, to: string): Promise<void>;

  delete(name: string): Promise<void>;

  /** Last-modified time in epoch ms, or undefined if the file is absent. */
  getModifiedMs(name: string): Promise<number | undefined>;

  /**
   * Optional change subscription (used when the Electron bridge provides one).
   * When absent, callers fall back to polling getModifiedMs. Returns an
   * unsubscribe function.
   */
  watch?(onChange: (name: string) => void): () => void;
}
