import type { FileSystemAdapter } from "./FileSystemAdapter";

/**
 * FileSystemAdapter over the File System Access API (Chromium-only; accepted for
 * the dev harness — the plugin phase swaps in a postMessage-backed adapter). The
 * API has no native rename, so `rename` is copy+delete. All names are relative
 * to the picked session directory, using forward slashes for nested paths.
 */
export class BrowserDirectoryAdapter implements FileSystemAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** Prompt the user for a directory (must be called from a user gesture). */
  static async pick(): Promise<BrowserDirectoryAdapter> {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    return new BrowserDirectoryAdapter(handle);
  }

  private async resolveDir(
    parts: string[],
    create: boolean
  ): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private split(name: string): { dirs: string[]; base: string } {
    const parts = name.split("/").filter(Boolean);
    const base = parts.pop() ?? "";
    return { dirs: parts, base };
  }

  private async getFileHandle(name: string, create: boolean): Promise<FileSystemFileHandle> {
    const { dirs, base } = this.split(name);
    const dir = await this.resolveDir(dirs, create);
    return dir.getFileHandle(base, { create });
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [entryName, handle] of (dir as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>;
      }).entries()) {
        const rel = prefix ? `${prefix}/${entryName}` : entryName;
        if (handle.kind === "file") out.push(rel);
        else await walk(handle as FileSystemDirectoryHandle, rel);
      }
    };
    await walk(this.root, "");
    return out.sort();
  }

  async exists(name: string): Promise<boolean> {
    try {
      await this.getFileHandle(name, false);
      return true;
    } catch {
      return false;
    }
  }

  async readBytes(name: string): Promise<Uint8Array> {
    const file = await (await this.getFileHandle(name, false)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readText(name: string): Promise<string> {
    const file = await (await this.getFileHandle(name, false)).getFile();
    return file.text();
  }

  async writeBytes(name: string, data: Uint8Array): Promise<void> {
    const handle = await this.getFileHandle(name, true);
    const writable = await handle.createWritable();
    // Copy into a fresh ArrayBuffer-backed view so the type matches the
    // File System Access write signature regardless of the source buffer.
    const buffer = new Uint8Array(data.byteLength);
    buffer.set(data);
    await writable.write(buffer);
    await writable.close();
  }

  async writeText(name: string, text: string): Promise<void> {
    const handle = await this.getFileHandle(name, true);
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async rename(from: string, to: string): Promise<void> {
    const data = await this.readBytes(from);
    await this.writeBytes(to, data);
    await this.delete(from);
  }

  async delete(name: string): Promise<void> {
    const { dirs, base } = this.split(name);
    const dir = await this.resolveDir(dirs, false);
    await dir.removeEntry(base);
  }

  async getModifiedMs(name: string): Promise<number | undefined> {
    try {
      const file = await (await this.getFileHandle(name, false)).getFile();
      return file.lastModified;
    } catch {
      return undefined;
    }
  }
}
