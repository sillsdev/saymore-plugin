import { describe, expect, it, vi } from "vitest";
import { PluginHostAdapter } from "./PluginHostAdapter";
import type { PluginHostApiV1 } from "./PluginApiTypes";

/**
 * A fake host API backed by an in-memory companion store, mirroring the host's
 * allowlist-relative paths. `getFileBytes` is tracked separately so tests can
 * assert that reads of the selected media route there (not through companions).
 */
function makeFakeHost(opts: {
  selectedBytes: Uint8Array;
  companions?: Record<string, Uint8Array | string>;
}) {
  const store = new Map<string, Uint8Array>();
  let clock = 1000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  for (const [name, value] of Object.entries(opts.companions ?? {})) {
    store.set(name, typeof value === "string" ? enc.encode(value) : value);
  }
  const getFileBytes = vi.fn(async () => toBuffer(opts.selectedBytes));

  const api: PluginHostApiV1 = {
    getFileBytes,
    readFileRange: async () => new ArrayBuffer(0),
    readSidecar: async () => null,
    writeSidecar: async () => {},
    listSidecars: async () => [],
    selectFile: async () => {},
    companions: {
      list: async (subdir?: string) => {
        const entries: { name: string; size: number; mtimeMs: number }[] = [];
        for (const [name, bytes] of store) {
          if (subdir === undefined) {
            if (!name.includes("/")) entries.push({ name, size: bytes.byteLength, mtimeMs: clock });
          } else if (name.startsWith(`${subdir}/`)) {
            const base = name.slice(subdir.length + 1);
            if (!base.includes("/"))
              entries.push({ name: base, size: bytes.byteLength, mtimeMs: clock });
          }
        }
        return entries;
      },
      exists: async (p) => store.has(p),
      readText: async (p) => {
        const b = store.get(p);
        if (!b) throw new Error(`not found: ${p}`);
        return dec.decode(b);
      },
      readBytes: async (p) => {
        const b = store.get(p);
        if (!b) throw new Error(`not found: ${p}`);
        return toBuffer(b);
      },
      writeText: async (p, contents) => {
        store.set(p, enc.encode(contents));
        clock++;
      },
      writeBytes: async (p, data) => {
        store.set(p, new Uint8Array(data));
        clock++;
      },
      rename: async (from, to) => {
        const b = store.get(from);
        if (!b) throw new Error(`not found: ${from}`);
        store.delete(from);
        store.set(to, b);
        clock++;
      },
      delete: async (p) => {
        store.delete(p);
        clock++;
      },
      stat: async (p) => {
        const b = store.get(p);
        return b ? { size: b.byteLength, mtimeMs: clock } : null;
      },
    },
  };
  return { api, store, getFileBytes };
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("PluginHostAdapter", () => {
  const MEDIA = "ETR009.mp3";

  it("lists the selected file plus existing companions and _Annotations WAVs", async () => {
    const { api } = makeFakeHost({
      selectedBytes: new Uint8Array([1, 2, 3]),
      companions: {
        "ETR009.mp3.annotations.eaf": "<eaf/>",
        "ETR009.mp3_Annotations/0.5_to_1.25_Careful.wav": new Uint8Array([9]),
      },
    });
    const fs = new PluginHostAdapter(api, MEDIA);
    expect(await fs.list()).toEqual([
      "ETR009.mp3",
      "ETR009.mp3.annotations.eaf",
      "ETR009.mp3_Annotations/0.5_to_1.25_Careful.wav",
    ]);
  });

  it("reads the selected media via getFileBytes, not companions", async () => {
    const { api, getFileBytes } = makeFakeHost({ selectedBytes: new Uint8Array([7, 8, 9]) });
    const fs = new PluginHostAdapter(api, MEDIA);
    expect([...(await fs.readBytes(MEDIA))]).toEqual([7, 8, 9]);
    expect(getFileBytes).toHaveBeenCalledOnce();
    expect(await fs.exists(MEDIA)).toBe(true);
  });

  it("round-trips a companion eaf through companions.*", async () => {
    const { api, store } = makeFakeHost({ selectedBytes: new Uint8Array() });
    const fs = new PluginHostAdapter(api, MEDIA);
    await fs.writeText("ETR009.mp3.annotations.eaf", "<eaf>hi</eaf>");
    expect(await fs.readText("ETR009.mp3.annotations.eaf")).toBe("<eaf>hi</eaf>");
    expect(store.has("ETR009.mp3.annotations.eaf")).toBe(true);
  });

  // State B: lameta selected the `.eaf` itself. The adapter is anchored on the media it
  // annotates, decodes the selected `.eaf` via getFileBytes, and reaches the media and its
  // `_Annotations/` through the host's eaf-scoped companions.
  it("eaf-selected: reads the eaf via getFileBytes and media/_Annotations via companions", async () => {
    const EAF = "ETR009.mp3.annotations.eaf";
    const enc = new TextEncoder();
    const { api, getFileBytes } = makeFakeHost({
      selectedBytes: enc.encode("<eaf>hi</eaf>"), // the SELECTED file is the eaf
      companions: {
        "ETR009.mp3": new Uint8Array([1, 2, 3]), // media, readable under eaf-scoped companions
        "ETR009.mp3_Annotations/0.75_to_1.25_Careful.wav": new Uint8Array([9]),
      },
    });
    const fs = new PluginHostAdapter(api, MEDIA, EAF);

    expect(await fs.readText(EAF)).toBe("<eaf>hi</eaf>");
    expect(getFileBytes).toHaveBeenCalled();
    expect([...(await fs.readBytes(MEDIA))]).toEqual([1, 2, 3]);
    const listed = await fs.list();
    expect(listed).toContain("ETR009.mp3");
    expect(listed).toContain("ETR009.mp3_Annotations/0.75_to_1.25_Careful.wav");
    await expect(fs.readText(MEDIA)).rejects.toThrow(/refusing/);
  });

  it("renames and deletes segment WAVs (real host rename)", async () => {
    const { api } = makeFakeHost({
      selectedBytes: new Uint8Array(),
      companions: { "ETR009.mp3_Annotations/0.5_to_1_Careful.wav": new Uint8Array([1]) },
    });
    const fs = new PluginHostAdapter(api, MEDIA);
    await fs.rename(
      "ETR009.mp3_Annotations/0.5_to_1_Careful.wav",
      "ETR009.mp3_Annotations/0.5_to_2_Careful.wav",
    );
    expect(await fs.exists("ETR009.mp3_Annotations/0.5_to_1_Careful.wav")).toBe(false);
    expect(await fs.exists("ETR009.mp3_Annotations/0.5_to_2_Careful.wav")).toBe(true);
    await fs.delete("ETR009.mp3_Annotations/0.5_to_2_Careful.wav");
    expect(await fs.exists("ETR009.mp3_Annotations/0.5_to_2_Careful.wav")).toBe(false);
  });

  it("maps getModifiedMs to companions.stat (and undefined for the media)", async () => {
    const { api } = makeFakeHost({
      selectedBytes: new Uint8Array(),
      companions: { "ETR009.mp3.annotations.eaf": "<eaf/>" },
    });
    const fs = new PluginHostAdapter(api, MEDIA);
    expect(await fs.getModifiedMs("ETR009.mp3.annotations.eaf")).toBeGreaterThan(0);
    // Allowed but absent → undefined (not an error).
    expect(await fs.getModifiedMs("ETR009.mp3.oralAnnotations.wav")).toBeUndefined();
    expect(await fs.getModifiedMs(MEDIA)).toBeUndefined();
  });

  // Scoping/validation is the host's responsibility (single source of truth); the adapter
  // is a thin passthrough, so out-of-scope paths surface the host's rejection rather than a
  // client-side early throw. Hence no client-allowlist test here.
});
