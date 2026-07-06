import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { annotationsEafName } from "../src/fs/SessionFolder";
import { FILES_STORE } from "../src/harness/idb";

/** Must match `DB_NAME` in src/harness/idb.ts (private there, so duplicated here). */
const DB_NAME = "saymore-harness";

export const SAMPLE_MEDIA_NAME = "ETR009_Tiny.mp3";
export const SAMPLE_EAF_NAME = annotationsEafName(SAMPLE_MEDIA_NAME);

export type Selection = "audio" | "eaf" | "oral";
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

/**
 * A harness tab chip (see src/harness/TabChip.tsx) by the TabDescriptor id the
 * plugin claims for the selection: "transcription-translation" on a `.eaf`;
 * "careful-speech" / "oral-translation" / "combined-audio" on the
 * OralAnnotations node.
 */
export function tabChip(page: Page, id: string) {
  return page.getByTestId(`tab-chip-${id}`);
}

/**
 * Assert the transcription grid is showing. "Free Translation" is the grid's
 * second column header and appears nowhere else — unlike /Transcription/,
 * which the "Transcription & Translation" tab chip also matches.
 */
export async function expectGridVisible(page: Page): Promise<void> {
  await expect(page.getByText("Free Translation")).toBeVisible();
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

/**
 * Write a file straight into the app's IndexedDB store, bypassing the UI —
 * for pre-seeding fixture state (e.g. an oral-annotation WAV "already
 * recorded" by a prior session) that the app has no in-browser flow to
 * produce yet. Matches the `FileRecord` shape `IndexedDbAdapter` itself
 * writes, so the app reads it back exactly as if it had written it.
 */
export async function writeIdbFileBytes(
  page: Page,
  name: string,
  bytes: Uint8Array,
  opts?: { modifiedMs?: number },
): Promise<void> {
  await page.evaluate(
    ({ dbName, store, fileName, data, modifiedMs }) => {
      return new Promise<void>((resolve, reject) => {
        const openReq = indexedDB.open(dbName);
        openReq.onerror = () => reject(openReq.error);
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put({ data: new Uint8Array(data), modifiedMs }, fileName);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      dbName: DB_NAME,
      store: FILES_STORE,
      fileName: name,
      data: Array.from(bytes),
      modifiedMs: opts?.modifiedMs ?? 0,
    },
  );
}

/** The `modifiedMs` `IndexedDbAdapter.writeBytes` stamped on a file (staleness checks). */
export async function readIdbFileModifiedMs(page: Page, name: string): Promise<number | undefined> {
  return page.evaluate(
    ({ dbName, store, fileName }) => {
      return new Promise<number | undefined>((resolve, reject) => {
        const openReq = indexedDB.open(dbName);
        openReq.onerror = () => reject(openReq.error);
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction(store, "readonly");
          const getReq = tx.objectStore(store).get(fileName);
          getReq.onsuccess = () => {
            const rec = getReq.result as { modifiedMs?: number } | undefined;
            resolve(rec?.modifiedMs);
          };
          getReq.onerror = () => reject(getReq.error);
        };
      });
    },
    { dbName: DB_NAME, store: FILES_STORE, fileName: name },
  );
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

/** Poll `listIdbFileNames` until `predicate` is satisfied, or fail after `timeoutMs`. */
export async function waitForFiles(
  page: Page,
  predicate: (files: string[]) => boolean,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = await listIdbFileNames(page);
    if (predicate(files)) return files;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for files: ${JSON.stringify(files)}`);
    await page.waitForTimeout(150);
  }
}

export const ANNOTATIONS_FOLDER = `${SAMPLE_MEDIA_NAME}_Annotations/`;
export const COMBINED_WAV_NAME = `${SAMPLE_MEDIA_NAME}.oralAnnotations.wav`;
export const RECORD_HOLD_MS = 1000;
// MediaElementPlaybackEngine auto-stops a range once currentTime reaches its
// end, so holding well past a segment's real length is safe — release just
// needs to land after that auto-stop, not at any precise instant.
export const LISTEN_SEGMENT0_HOLD_MS = 1800; // segment 0 is ~1s

/**
 * Two real segments ([0, 1s], [1s, 2.5s]). "Manually segment" lands directly
 * in the segmenter (an explicit choice to segment); boundaries are placed via
 * the segmenter's DEV debug hook (`window.__seg`, exposed by
 * ManualSegmenterView) — the earlier real-time listen+Enter technique missed
 * boundaries under parallel-worker CPU load. Ends back on the grid (via the
 * segmenter's "Back" button). Assumes the audio row is already selected with no
 * eaf yet (see `openSample(page, { sel: "audio" })`).
 */
export async function createTwoRealSegments(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Manually segment/i }).click();
  await expect(page.getByText(/Segments: 0/)).toBeVisible();

  await page.evaluate(() => {
    const vm = (
      window as unknown as {
        __seg: { setCursor(sec: number): void; addBoundaryAtCursor(): unknown };
      }
    ).__seg;
    vm.setCursor(1);
    vm.addBoundaryAtCursor();
    vm.setCursor(2.5);
    vm.addBoundaryAtCursor();
  });

  await expect(page.getByText(/Segments: 2/)).toBeVisible();
  await page.waitForTimeout(700); // let the debounced eaf auto-save flush

  await page.getByRole("button", { name: /Back/i }).click();
  await expectGridVisible(page);
}

/**
 * Open the Careful Speech / Oral Translation recorder from the grid: "Setup
 * Oral Annotation" creates the combined `<media>.oralAnnotations.wav` and
 * selects it, opening its default Careful Speech tab; Oral Translation is the
 * sibling chip. Assumes the grid is showing and no combined file exists yet.
 */
export async function openRecorder(
  page: Page,
  kind: "Careful Speech" | "Oral Translation",
): Promise<void> {
  await page.getByRole("button", { name: /Setup Oral Annotation/ }).click();
  // Setup decodes the media and writes the combined file before selecting it.
  await expect(tabChip(page, "careful-speech")).toBeVisible({ timeout: 15_000 });
  if (kind === "Oral Translation") await tabChip(page, "oral-translation").click();
  await expect(page.getByRole("button", { name: "Speak" })).toBeVisible();
  // MicRecorder.open() (getUserMedia + AudioContext + AudioWorklet.addModule)
  // is async; give it a moment before the first push-to-talk hold.
  await page.waitForTimeout(500);
}

/** Listen-hold then record-hold on the current segment — the minimal armed-record flow. */
export async function listenThenRecord(page: Page, recordHoldMs = RECORD_HOLD_MS): Promise<void> {
  await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS);
  await holdKey(page, " ", recordHoldMs);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
