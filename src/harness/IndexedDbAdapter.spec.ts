// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { IndexedDbAdapter } from "./IndexedDbAdapter";
import { idbAvailable } from "./idb";

/**
 * Persistence round-trip: bytes written through one adapter instance are visible
 * from a fresh instance (the "survives a page refresh" contract). Runs only
 * where IndexedDB exists; the full refresh behavior is also verified live in the
 * browser. (happy-dom currently ships no IndexedDB, so this self-skips there.)
 */
const maybe = idbAvailable() ? it : it.skip;

describe("IndexedDbAdapter", () => {
  maybe("persists writes across adapter instances", async () => {
    const a = new IndexedDbAdapter();
    await a.clearAll();
    await a.writeText("s.annotations.eaf", "<hello/>");
    await a.writeBytes("m.wav", new Uint8Array([1, 2, 3]));

    const b = new IndexedDbAdapter();
    expect(await b.exists("s.annotations.eaf")).toBe(true);
    expect(await b.readText("s.annotations.eaf")).toBe("<hello/>");
    expect(Array.from(await b.readBytes("m.wav"))).toEqual([1, 2, 3]);
    expect((await b.list()).sort()).toEqual(["m.wav", "s.annotations.eaf"]);

    await b.clearAll();
    expect(await b.list()).toEqual([]);
  });
});
