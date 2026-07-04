import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { annotationsEafName } from "../src/fs/SessionFolder";
import { FILES_STORE } from "../src/harness/idb";

/** Must match `DB_NAME` in src/harness/idb.ts (private there, so duplicated here). */
const DB_NAME = "saymore-harness";

export const SAMPLE_MEDIA_NAME = "ETR009_Tiny.mp3";
export const SAMPLE_EAF_NAME = annotationsEafName(SAMPLE_MEDIA_NAME);

export type Selection = "audio" | "eaf";
export type EafView = "grid" | "segmenter" | "recorder-careful" | "recorder-translation";

/**
 * Navigate to the host simulator on the bundled IndexedDB sample session.
 * Every test gets a fresh, isolated Playwright browser context (Playwright's
 * default `page` fixture), so this always starts from an empty IndexedDB — no
 * explicit reset needed between *tests*; use {@link resetSample} only to get
 * back to a pristine state *within* a single test after creating an eaf.
 */
export async function openSample(
  page: Page,
  opts?: { sel?: Selection; view?: EafView },
): Promise<void> {
  const params = new URLSearchParams({ src: "sample" });
  if (opts?.sel) params.set("sel", opts.sel);
  if (opts?.sel === "eaf" && opts.view) params.set("view", opts.view);
  await page.goto(`/?${params.toString()}`);
  await expect(fileTreeRow(page, SAMPLE_MEDIA_NAME)).toBeVisible();
}

/**
 * The clickable file-tree row for a given file name (Audio or Annotations
 * row). Anchored + requires a trailing space (the accessible name is
 * "<name> <typeLabel>") so the audio row's name doesn't also match the eaf
 * row, whose name is the audio name plus a `.annotations.eaf` suffix.
 */
export function fileTreeRow(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)} `) });
}

/** Click "Reset sample": drops any created eaf / edits, reseeds the pristine sample. */
export async function resetSample(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Reset sample/i }).click();
  await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeVisible();
}

/**
 * Read a file's raw bytes out of the app's IndexedDB store (the same one
 * `IndexedDbAdapter` reads/writes) — used to assert on real persisted state
 * (the `.eaf` XML, a recorded WAV) instead of pixel-hunting the rendered UI.
 */
export async function readIdbFileBytes(page: Page, name: string): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    ({ dbName, store, fileName }) => {
      return new Promise<number[]>((resolve, reject) => {
        const openReq = indexedDB.open(dbName);
        openReq.onerror = () => reject(openReq.error);
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction(store, "readonly");
          const getReq = tx.objectStore(store).get(fileName);
          getReq.onsuccess = () => {
            const rec = getReq.result as { data: Uint8Array } | undefined;
            if (!rec) {
              reject(new Error(`IndexedDB: no such file "${fileName}"`));
              return;
            }
            resolve(Array.from(rec.data));
          };
          getReq.onerror = () => reject(getReq.error);
        };
      });
    },
    { dbName: DB_NAME, store: FILES_STORE, fileName: name },
  );
  return new Uint8Array(bytes);
}

export async function readIdbFileText(page: Page, name: string): Promise<string> {
  return new TextDecoder().decode(await readIdbFileBytes(page, name));
}

/** All file names currently in the app's IndexedDB session store. */
export async function listIdbFileNames(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ dbName, store }) => {
      return new Promise<string[]>((resolve, reject) => {
        const openReq = indexedDB.open(dbName);
        openReq.onerror = () => reject(openReq.error);
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction(store, "readonly");
          const getReq = tx.objectStore(store).getAllKeys();
          getReq.onsuccess = () => resolve((getReq.result as IDBValidKey[]).map(String));
          getReq.onerror = () => reject(getReq.error);
        };
      });
    },
    { dbName: DB_NAME, store: FILES_STORE },
  );
}

export async function idbFileExists(page: Page, name: string): Promise<boolean> {
  return (await listIdbFileNames(page)).includes(name);
}

/** Hold a key down for `holdMs`, then release it — the push-to-talk gesture. */
export async function holdKey(page: Page, key: string, holdMs: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
