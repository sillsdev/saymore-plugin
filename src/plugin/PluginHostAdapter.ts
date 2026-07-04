import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import type { PluginHostApiV1 } from "./PluginApiTypes";
import { ANNOTATIONS_FOLDER_SUFFIX, STANDARD_AUDIO_SUFFIX } from "../model/SayMoreConstants";

function normalize(name: string): string {
  return name.replace(/\\/g, "/").toLowerCase();
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return dot > slash ? name.slice(0, dot) : name;
}

/**
 * The plugin-mode {@link FileSystemAdapter}: a thin passthrough over lameta's postMessage
 * host API — `getFileBytes()` for the file lameta selected, `companions.*` for everything
 * beside it.
 *
 * The **host is the single source of truth** for which companion paths are in scope (its
 * generic stem-based allowlist). This adapter does no client-side allowlist validation; an
 * out-of-scope path simply surfaces the host's rejection. It only needs the selected file's
 * name (to route reads to `getFileBytes()`) and the media name (the session anchor, and to
 * name the `_Annotations` folders it enumerates).
 *
 * Two selection states (see connectPlugin):
 *  - State A — the media is selected: reads of the media go to `getFileBytes()`; the eaf and
 *    the `_Annotations/` WAVs go through `companions.*`.
 *  - State B — a `.eaf` is selected: `getFileBytes()` returns the eaf (decoded as text for
 *    `readText`); the media and its `_Annotations/` are read through `companions.*`.
 */
export class PluginHostAdapter implements FileSystemAdapter {
  private readonly mediaLower: string;
  private readonly selectedLower: string;

  /**
   * @param mediaFileName        the session's media file — the anchor {@link SessionFolder}
   *                             treats as the media and the base of the `_Annotations` folders.
   * @param hostSelectedFileName the file lameta actually selected (what `getFileBytes()`
   *                             returns). Defaults to the media (State A); a `.eaf` in State B.
   */
  constructor(
    private readonly api: PluginHostApiV1,
    private readonly mediaFileName: string,
    hostSelectedFileName: string = mediaFileName,
  ) {
    this.mediaLower = normalize(mediaFileName);
    this.selectedLower = normalize(hostSelectedFileName);
  }

  private isSelected(name: string): boolean {
    return normalize(name) === this.selectedLower;
  }

  private isMediaFile(name: string): boolean {
    return normalize(name) === this.mediaLower;
  }

  /** The oral-annotation folders to enumerate: the media's, and its `_StandardAudio` sibling's. */
  private annotationDirs(): string[] {
    const dirs = [`${this.mediaFileName}${ANNOTATIONS_FOLDER_SUFFIX}`];
    const standard = `${stripExtension(this.mediaFileName)}${STANDARD_AUDIO_SUFFIX}`;
    if (normalize(standard) !== this.mediaLower) {
      dirs.push(`${standard}${ANNOTATIONS_FOLDER_SUFFIX}`);
    }
    return dirs;
  }

  async list(): Promise<string[]> {
    const names = new Set<string>();
    // Surface the media so SessionFolder.findMediaFile picks it up in either state.
    names.add(this.mediaFileName);
    for (const entry of await this.api.companions.list()) names.add(entry.name);
    for (const dir of this.annotationDirs()) {
      try {
        for (const entry of await this.api.companions.list(dir)) names.add(`${dir}/${entry.name}`);
      } catch {
        // Folder absent or out of scope — skip.
      }
    }
    return [...names].sort();
  }

  async exists(name: string): Promise<boolean> {
    if (this.isSelected(name)) return true;
    return this.api.companions.exists(name);
  }

  async readBytes(name: string): Promise<Uint8Array> {
    if (this.isSelected(name)) return new Uint8Array(await this.api.getFileBytes());
    return new Uint8Array(await this.api.companions.readBytes(name));
  }

  async readText(name: string): Promise<string> {
    // The media file is binary; never decode it as text.
    if (this.isMediaFile(name)) {
      throw new Error("PluginHostAdapter: refusing to read the media file as text.");
    }
    // State B: the selected file is the `.eaf` itself — decode the bytes lameta handed us.
    if (this.isSelected(name)) return new TextDecoder().decode(await this.api.getFileBytes());
    return this.api.companions.readText(name);
  }

  async writeBytes(name: string, data: Uint8Array): Promise<void> {
    await this.api.companions.writeBytes(name, toArrayBuffer(data));
  }

  async writeText(name: string, text: string): Promise<void> {
    await this.api.companions.writeText(name, text);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.api.companions.rename(from, to);
  }

  async delete(name: string): Promise<void> {
    await this.api.companions.delete(name);
  }

  async getModifiedMs(name: string): Promise<number | undefined> {
    // The selected media file (State A) isn't a companion and can't be stat'd; everything
    // else (notably the .eaf the external-change poll watches) goes through companions.stat.
    if (this.isMediaFile(name) && this.isSelected(name)) return undefined;
    try {
      const stat = await this.api.companions.stat(name);
      return stat ? stat.mtimeMs : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Copy into a fresh, standalone ArrayBuffer suitable for zero-copy transfer. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
