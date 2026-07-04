import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { FILES_STORE, idbClear, idbDelete, idbGet, idbGetAllKeys, idbPut } from "./idb";

interface FileRecord {
  data: Uint8Array;
  modifiedMs: number;
}

/**
 * A {@link FileSystemAdapter} backed by IndexedDB (the `files` store). It gives
 * the host simulator a session whose writes — a created `.annotations.eaf`,
 * edited transcription cells — **survive a page refresh**, without a real disk
 * folder or any native picker (so it's fully drivable headlessly via CDP).
 *
 * File bytes round-trip through IndexedDB's structured clone as `Uint8Array`;
 * names are the same forward-slash-relative names the rest of the app uses.
 */
export class IndexedDbAdapter implements FileSystemAdapter {
  private now(): number {
    // Wall clock is fine in the browser harness (unlike the pure model layer).
    return Date.now();
  }

  async list(): Promise<string[]> {
    return (await idbGetAllKeys(FILES_STORE)).sort();
  }

  async exists(name: string): Promise<boolean> {
    return (await idbGet<FileRecord>(FILES_STORE, name)) !== undefined;
  }

  async readBytes(name: string): Promise<Uint8Array> {
    const rec = await idbGet<FileRecord>(FILES_STORE, name);
    if (!rec) throw new Error(`IndexedDbAdapter: no such file "${name}"`);
    return rec.data;
  }

  async readText(name: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(name));
  }

  async writeBytes(name: string, data: Uint8Array): Promise<void> {
    // Copy into a standalone Uint8Array so we never persist a view over a larger
    // (or transferable) buffer.
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    await idbPut(FILES_STORE, name, { data: copy, modifiedMs: this.now() } satisfies FileRecord);
  }

  async writeText(name: string, text: string): Promise<void> {
    await this.writeBytes(name, new TextEncoder().encode(text));
  }

  async rename(from: string, to: string): Promise<void> {
    const data = await this.readBytes(from);
    await this.writeBytes(to, data);
    await this.delete(from);
  }

  async delete(name: string): Promise<void> {
    await idbDelete(FILES_STORE, name);
  }

  async getModifiedMs(name: string): Promise<number | undefined> {
    return (await idbGet<FileRecord>(FILES_STORE, name))?.modifiedMs;
  }

  /** Wipe every file (used by the harness Reset before reseeding the sample). */
  async clearAll(): Promise<void> {
    await idbClear(FILES_STORE);
  }
}
