import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Absolute path to the `test-data/` fixture corpus (see test-data/README.md).
 * Node/vitest only — used by specs to load real SayMore EAFs, WAVs, the
 * annotation template, and the C#-float parity table.
 */
export const testDataDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../test-data"
);

export function testDataPath(...segments: string[]): string {
  return resolve(testDataDir, ...segments);
}
