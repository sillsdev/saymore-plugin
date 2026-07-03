import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import type { PluginHostApiV1 } from "./PluginApiTypes";
import { computeCompanionAllowlist, type CompanionAllowlist } from "./companionAllowlist";

/**
 * The plugin-mode {@link FileSystemAdapter}: the seam between the annotation tools
 * and lameta's host, backed by the postMessage `api.companions.*` methods plus
 * `getFileBytes()` for the selected media file itself.
 *
 * The tools were written against a "session folder" model (`list()` returns every
 * file, {@link SessionFolder} then picks the media). We reproduce that shape here
 * without any change to the tools:
 *
 *  - `list()` returns the selected file, every existing top-level companion, and
 *    the `.wav`s inside the `_Annotations` folders — so `findMediaFile` still
 *    prefers a `_StandardAudio.wav` when present, matching SayMore.
 *  - Reads of the selected file route to `getFileBytes()`; the media is not a
 *    companion. Everything else routes to `companions.*` after a client-side
 *    allowlist check that throws early on an out-of-scope path.
 *
 * There is no `watch`; callers fall back to polling `getModifiedMs` (which maps to
 * `companions.stat`).
 */
export class PluginHostAdapter implements FileSystemAdapter {
  private readonly allowlist: CompanionAllowlist;
  private readonly selectedLower: string;

  constructor(
    private readonly api: PluginHostApiV1,
    private readonly selectedFileName: string,
  ) {
    this.allowlist = computeCompanionAllowlist(selectedFileName);
    this.selectedLower = selectedFileName.replace(/\\/g, "/").toLowerCase();
  }

  private isSelected(name: string): boolean {
    return name.replace(/\\/g, "/").toLowerCase() === this.selectedLower;
  }

  private assertAllowed(name: string): void {
    if (!this.allowlist.isAllowed(name)) {
      throw new Error(
        `PluginHostAdapter: "${name}" is not an allowed companion of "${this.selectedFileName}".`,
      );
    }
  }

  async list(): Promise<string[]> {
    const names = new Set<string>();
    names.add(this.selectedFileName);
    for (const entry of await this.api.companions.list()) names.add(entry.name);
    for (const dir of this.allowlist.annotationDirs) {
      for (const entry of await this.api.companions.list(dir)) {
        names.add(`${dir}/${entry.name}`);
      }
    }
    return [...names].sort();
  }

  async exists(name: string): Promise<boolean> {
    if (this.isSelected(name)) return true;
    this.assertAllowed(name);
    return this.api.companions.exists(name);
  }

  async readBytes(name: string): Promise<Uint8Array> {
    if (this.isSelected(name)) return new Uint8Array(await this.api.getFileBytes());
    this.assertAllowed(name);
    return new Uint8Array(await this.api.companions.readBytes(name));
  }

  async readText(name: string): Promise<string> {
    if (this.isSelected(name)) {
      throw new Error("PluginHostAdapter: refusing to read the media file as text.");
    }
    this.assertAllowed(name);
    return this.api.companions.readText(name);
  }

  async writeBytes(name: string, data: Uint8Array): Promise<void> {
    this.assertAllowed(name);
    await this.api.companions.writeBytes(name, toArrayBuffer(data));
  }

  async writeText(name: string, text: string): Promise<void> {
    this.assertAllowed(name);
    await this.api.companions.writeText(name, text);
  }

  async rename(from: string, to: string): Promise<void> {
    this.assertAllowed(from);
    this.assertAllowed(to);
    await this.api.companions.rename(from, to);
  }

  async delete(name: string): Promise<void> {
    this.assertAllowed(name);
    await this.api.companions.delete(name);
  }

  async getModifiedMs(name: string): Promise<number | undefined> {
    // The selected file isn't a companion, so it can't be stat'd here; the
    // external-change poll only watches the .eaf (a companion) anyway.
    if (this.isSelected(name)) return undefined;
    this.assertAllowed(name);
    const stat = await this.api.companions.stat(name);
    return stat ? stat.mtimeMs : undefined;
  }
}

/** Copy into a fresh, standalone ArrayBuffer suitable for zero-copy transfer. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
