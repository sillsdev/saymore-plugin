import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "./InMemoryAdapter";

// Node-environment spec: proves the vitest wiring and the fake adapter contract
// the FS/model tracks depend on. (No DOM needed.)
describe("InMemoryAdapter", () => {
  it("round-trips text and bytes", async () => {
    const fs = new InMemoryAdapter();
    await fs.writeText("a.eaf", "<xml/>");
    await fs.writeBytes("b.wav", new Uint8Array([1, 2, 3]));

    expect(await fs.exists("a.eaf")).toBe(true);
    expect(await fs.readText("a.eaf")).toBe("<xml/>");
    expect([...(await fs.readBytes("b.wav"))]).toEqual([1, 2, 3]);
    expect(await fs.list()).toEqual(["a.eaf", "b.wav"]);
  });

  it("renames within the folder (the copy+delete semantics adapters share)", async () => {
    const fs = new InMemoryAdapter({ "old.wav": new Uint8Array([9]) });
    await fs.rename("old.wav", "sub/new.wav");
    expect(await fs.exists("old.wav")).toBe(false);
    expect([...(await fs.readBytes("sub/new.wav"))]).toEqual([9]);
  });

  it("deletes files", async () => {
    const fs = new InMemoryAdapter({ "x.txt": "hi" });
    await fs.delete("x.txt");
    expect(await fs.exists("x.txt")).toBe(false);
    expect(await fs.getModifiedMs("x.txt")).toBeUndefined();
  });

  it("advances a monotonic clock on writes (for external-change polling)", async () => {
    const fs = new InMemoryAdapter();
    await fs.writeText("f", "1");
    const t1 = await fs.getModifiedMs("f");
    await fs.writeText("f", "2");
    const t2 = await fs.getModifiedMs("f");
    expect(t1).toBeDefined();
    expect(t2!).toBeGreaterThan(t1!);
  });

  it("notifies watchers", async () => {
    const fs = new InMemoryAdapter();
    const seen: string[] = [];
    const unwatch = fs.watch((name) => seen.push(name));
    await fs.writeText("f", "1");
    unwatch();
    await fs.writeText("g", "2");
    expect(seen).toEqual(["f"]);
  });
});
