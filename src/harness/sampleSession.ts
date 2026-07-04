import type { IndexedDbAdapter } from "./IndexedDbAdapter";
import sampleAudioUrl from "../../test-data/media/longerSound.wav?url";

/**
 * The bundled sample session the host simulator defaults to: just the real
 * `test-data` audio file — **no `.annotations.eaf`** — so the simulator opens on
 * a pristine session (only the Audio row) and the manual / auto segment buttons
 * actually do their create work (mirroring lameta). Once an eaf is created the
 * tree grows its nested Annotations row.
 *
 * The media file name doubles as the session identity; keep it in sync with the
 * asset above.
 */
export const SAMPLE_MEDIA_NAME = "longerSound.wav";

const SAMPLE_FILES: ReadonlyArray<{ name: string; url: string }> = [
  { name: SAMPLE_MEDIA_NAME, url: sampleAudioUrl },
];

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load sample asset ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Seed the sample files into `adapter` (overwrites whatever is there). */
export async function seedSampleSession(adapter: IndexedDbAdapter): Promise<void> {
  for (const file of SAMPLE_FILES) {
    await adapter.writeBytes(file.name, await fetchBytes(file.url));
  }
}

/** Reset to a pristine sample: drop everything, then reseed. */
export async function resetSampleSession(adapter: IndexedDbAdapter): Promise<void> {
  await adapter.clearAll();
  await seedSampleSession(adapter);
}

/** Seed only if the store is empty (first ever load); otherwise keep prior edits. */
export async function ensureSampleSeeded(adapter: IndexedDbAdapter): Promise<void> {
  const existing = await adapter.list();
  if (existing.length === 0) await seedSampleSession(adapter);
}
