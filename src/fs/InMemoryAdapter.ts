import type { FileSystemAdapter } from "./FileSystemAdapter";

interface Entry {
  data: Uint8Array;
  modifiedMs: number;
}

/**
 * In-memory FileSystemAdapter for tests and the single-dropped-file mode.
 *
 * `getModifiedMs` uses a **monotonic logical clock** (incremented on every
 * mutation) rather than wall-clock time, so external-change-poll logic can be
 * tested deterministically. Seed initial files with the constructor or `seed()`.
 */
export class InMemoryAdapter implements FileSystemAdapter {
  private files = new Map<string, Entry>();
  private clock = 0;
  private watchers = new Set<(name: string) => void>();

  constructor(initial?: Record<string, Uint8Array | string>) {
    if (initial) {
      for (const [name, value] of Object.entries(initial)) this.seed(name, value);
    }
  }

  /** Test helper: insert/replace a file without bumping the observable clock spuriously. */
  seed(name: string, value: Uint8Array | string): void {
    const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.files.set(name, { data, modifiedMs: ++this.clock });
  }

  private touch(name: string, data: Uint8Array): void {
    this.files.set(name, { data, modifiedMs: ++this.clock });
    for (const w of this.watchers) w(name);
  }

  private require(name: string): Entry {
    const e = this.files.get(name);
    if (!e) throw new Error(`InMemoryAdapter: no such file "${name}"`);
    return e;
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async exists(name: string): Promise<boolean> {
    return this.files.has(name);
  }

  async readBytes(name: string): Promise<Uint8Array> {
    return this.require(name).data;
  }

  async readText(name: string): Promise<string> {
    return new TextDecoder().decode(this.require(name).data);
  }

  async writeBytes(name: string, data: Uint8Array): Promise<void> {
    this.touch(name, data);
  }

  async writeText(name: string, text: string): Promise<void> {
    this.touch(name, new TextEncoder().encode(text));
  }

  async rename(from: string, to: string): Promise<void> {
    const e = this.require(from);
    this.files.delete(from);
    this.touch(to, e.data);
    for (const w of this.watchers) w(from);
  }

  async delete(name: string): Promise<void> {
    this.require(name);
    this.files.delete(name);
    this.clock++;
    for (const w of this.watchers) w(name);
  }

  async getModifiedMs(name: string): Promise<number | undefined> {
    return this.files.get(name)?.modifiedMs;
  }

  watch(onChange: (name: string) => void): () => void {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }
}
