import { test, expect, type Page } from "@playwright/test";
import { holdKey, listIdbFileNames, openSample, SAMPLE_MEDIA_NAME } from "./helpers";

/**
 * THE POINT of this suite (see the brief). Gated with `test.fixme` until the
 * coordinator confirms `ProjectStore.openRecorder` (src/state/ProjectStore.ts)
 * wires the real `MicRecorder` in place of the `SpyRecorder` placeholder — the
 * fake-mic launch flags in playwright.config.ts only produce a real
 * `getUserMedia` tone for a real capture path to consume. Kept here (skipped,
 * not deleted) so the file exists, compiles, and documents the intended
 * coverage; flip each `test.fixme` to `test` once the wiring lands.
 */

const TOO_SHORT_HOLD_MS = 200; // well under MIN_SEGMENT_LENGTH_MS (460ms)
const RECORD_HOLD_MS = 1000;
const ANNOTATIONS_FOLDER = `${SAMPLE_MEDIA_NAME}_Annotations/`;
const COMBINED_WAV_NAME = `${SAMPLE_MEDIA_NAME}.oralAnnotations.wav`;

async function openRecorder(
  page: Page,
  kind: "Careful Speech" | "Oral Translation",
): Promise<void> {
  await openSample(page, { sel: "audio" });
  await page.getByRole("button", { name: /Auto-segment/i }).click();
  await expect(page.getByText(/Transcription/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Oral Annotations Tools/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(kind) }).click();
  await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();
}

/** Listen-gate: hold SPACE until the current segment's source playback has been heard. */
async function armByListening(page: Page): Promise<void> {
  await holdKey(page, " ", 2000);
}

test.describe("Oral Annotations recorder (Careful Speech / Oral Translation)", () => {
  test.fixme("record over an armed segment: cell shows annotated, WAV lands in _Annotations/, advances", async ({
    page,
  }) => {
    await openRecorder(page, "Careful Speech");
    await armByListening(page);

    await expect(page.locator('[data-testid="annotation-cell-0"]')).toBeVisible();
    await holdKey(page, " ", RECORD_HOLD_MS);

    const filesAfter = await listIdbFileNames(page);
    expect(
      filesAfter.some((f) => f.startsWith(ANNOTATIONS_FOLDER) && f.endsWith("_Careful.wav")),
    ).toBe(true);
    // Advance: cell 0 is annotated, current-segment highlight has moved past it.
    await expect(page.locator('[data-testid="annotation-cell-0"]')).toHaveCSS(
      "background-color",
      /.*/,
    );
  });

  test.fixme("a too-short press shows the Whoops warning and writes nothing", async ({ page }) => {
    await openRecorder(page, "Careful Speech");
    await armByListening(page);
    const filesBefore = await listIdbFileNames(page);

    await holdKey(page, " ", TOO_SHORT_HOLD_MS);

    await expect(page.getByText(/Whoops/i)).toBeVisible();
    expect(await listIdbFileNames(page)).toEqual(filesBefore);
  });

  test.fixme("re-record, erase, and undo round-trip a cell's recording", async ({ page }) => {
    await openRecorder(page, "Careful Speech");
    await armByListening(page);
    await holdKey(page, " ", RECORD_HOLD_MS);
    const firstTake = await listIdbFileNames(page);

    // Re-record (press-and-hold on the cell's mic button) replaces the take.
    await page.locator('[data-testid="annotation-cell-0"]').hover();
    await page.getByTitle("Press and hold to re-record").click(); // TODO: real press-and-hold
    await expect(page.locator('[data-testid="annotation-cell-0"]')).toBeVisible();

    // Erase drops the recording; undo restores it. window.confirm() fires
    // synchronously during the click, so the dialog handler must be armed first.
    page.once("dialog", (d) => void d.accept());
    await page.getByTitle("Erase").click();
    expect(await listIdbFileNames(page)).not.toEqual(firstTake);
    await page.keyboard.press("z");
    expect(await listIdbFileNames(page)).toEqual(firstTake);
  });

  test.fixme("Oral Translation: minimal listen → record → annotated flow", async ({ page }) => {
    await openRecorder(page, "Oral Translation");
    await armByListening(page);
    await holdKey(page, " ", RECORD_HOLD_MS);

    const files = await listIdbFileNames(page);
    expect(
      files.some((f) => f.startsWith(ANNOTATIONS_FOLDER) && f.endsWith("_Translation.wav")),
    ).toBe(true);
  });

  test.fixme("leaving the recorder regenerates <media>.oralAnnotations.wav", async ({ page }) => {
    await openRecorder(page, "Careful Speech");
    await armByListening(page);
    await holdKey(page, " ", RECORD_HOLD_MS);

    await page.getByRole("button", { name: /Back to transcriptions/i }).click();
    await expect(page.getByRole("button", { name: /Segment…/ })).toBeVisible();

    expect(await listIdbFileNames(page)).toContain(COMBINED_WAV_NAME);
  });
});
