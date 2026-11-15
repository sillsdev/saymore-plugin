import { expect } from "vitest";
import type { SettingsStorage } from "./GridFonts";

/** Project settings kept in memory, for specs: the storage, every value written, and the latest. */
export function memoryStorage(initial: unknown = null) {
  let value: unknown = initial;
  const writes: unknown[] = [];
  const storage: SettingsStorage = {
    read: async () => value,
    write: async (v) => {
      // lameta refuses `undefined` anywhere in the value, so a JSON round trip must not change it.
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      value = v;
      writes.push(v);
    },
  };
  return { storage, writes, current: () => value };
}
