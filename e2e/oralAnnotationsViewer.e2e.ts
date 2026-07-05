import { test, expect, type Page } from "@playwright/test";
import {
  COMBINED_WAV_NAME,
  createTwoRealSegments,
  fileTreeRow,
  holdKey,
  listenThenRecord,
  listIdbFileNames,
  openRecorder,
  openSample,
  readIdbFileBytes,
  readIdbFileModifiedMs,
  RECORD_HOLD_MS,
  tabChip,
} from "./helpers";

/**
 * The Oral Annotations viewer (read-side of the combined
 * `<media>.oralAnnotations.wav`): plumbing (dedeb38, 18af508) + UI
 * (4e3e96f, f8967a0, 22a5ffc, 8bc123a) are both landed, `oralann-*` testids
 * all present.
 *
 * The Regenerate/staleness tests below are `test.fixme`-gated on a newly
 * found bug (not this file's): oral-annotation WAVs are named from the
 * segment's LIVE (unrounded) boundary float at record time (e.g.
 * `1.006053`), but the `.eaf` persists boundaries rounded to whole
 * milliseconds (`TIME_VALUE="1006"` → 1.006 on reload). `csFloatToString`
 * rounds to 7 significant figures, not ms, so `1.006053` and `1.006` produce
 * different tokens — `OralAnnotationIndex.getFilesForRange()` then fails to
 * match the segment to its own recording after any reload/reopen.
 * `regenerateCombinedOralWav` reads segment content via
 * `oralIndex.readSegmentWav()` (src/state/recorder/OralAnnotationsViewerModel.ts
 * `runRegenerate()`), so it silently finds no Careful/Translation content for
 * any segment and bails via "skipped-no-annotations" — no exception, no
 * console output, `isRegenerating` never even visibly flips. Verified by
 * dumping the eaf's `TIME_VALUE`s alongside the `_Annotations/` filename: they
 * don't match. Fix belongs to whoever owns segment→WAV naming
 * (src/state/recorder/RecorderViewModel.ts's `commitRecording`/
 * `commitNewSegmentRecording`, or `OralAnnotationFiles.ts`'s comparison) —
 * round the boundary to ms before naming, or compare by ms instead of
 * `csFloatToString`. Flip both tests to `test` once fixed.
 */

/**
 * Record segment 0 (Careful) — openRecorder's "Setup Oral Annotation" creates
 * the combined `<media>.oralAnnotations.wav` and selects it (the tree gains the
 * OralAnnotations row, the Careful Speech tab opens) — then switch to the
 * "Combined Audio" chip: the viewer's staleness check regenerates the file so
 * it includes the fresh recording. Ends with the viewer open and its three
 * rows rendered.
 */
async function openViewerAfterOneRecording(page: Page): Promise<void> {
  await openSample(page, { sel: "audio" });
  expect(await listIdbFileNames(page)).not.toContain(COMBINED_WAV_NAME);

  await createTwoRealSegments(page);
  await openRecorder(page, "Careful Speech");
  await expect(fileTreeRow(page, COMBINED_WAV_NAME)).toBeVisible();
  await listenThenRecord(page);
  await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();

  await tabChip(page, "combined-audio").click();
  await expect(page.locator('[data-testid="oralann-row-careful"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** Parse the "pos / total" readout ("05.0 / 09.9") into seconds. */
function parseReadout(text: string): { pos: number; total: number } {
  const [pos, total] = text.split("/").map((s) => Number(s.trim()));
  return { pos, total };
}

test.describe("Oral Annotations viewer", () => {
  test("selecting the tree node opens the viewer: chips + 3 rows render, file exists on disk", async ({
    page,
  }) => {
    await openViewerAfterOneRecording(page);

    // All three of the selection's tab chips render; Combined Audio is active.
    await expect(tabChip(page, "careful-speech")).toBeVisible();
    await expect(tabChip(page, "oral-translation")).toBeVisible();
    await expect(tabChip(page, "combined-audio")).toBeVisible();
    await expect(page.locator('[data-testid="oralann-row-source"]')).toBeVisible();
    await expect(page.locator('[data-testid="oralann-row-careful"]')).toBeVisible();
    await expect(page.locator('[data-testid="oralann-row-translation"]')).toBeVisible();
    await expect(page.locator('[data-testid="oralann-play"]')).toBeEnabled();
    await expect(page.locator('[data-testid="oralann-stop"]')).toBeDisabled();

    expect(await listIdbFileNames(page)).toContain(COMBINED_WAV_NAME);
  });

  test("Play moves the cursor and the readout ticks; Stop halts both", async ({ page }) => {
    await openViewerAfterOneRecording(page);
    const cursor = page.locator('[data-testid="oralann-cursor"]');

    await page.locator('[data-testid="oralann-play"]').click();
    await expect(page.locator('[data-testid="oralann-stop"]')).toBeEnabled();
    const transformAtStart = await cursor.evaluate((el) => el.style.transform);
    await page.waitForTimeout(600);
    const transformAfterPlaying = await cursor.evaluate((el) => el.style.transform);
    expect(transformAfterPlaying).not.toBe(transformAtStart);

    const readoutWhilePlaying = parseReadout(
      (await page.locator('[data-testid="oralann-time-readout"]').textContent()) ?? "",
    );
    expect(readoutWhilePlaying.pos).toBeGreaterThan(0);

    await page.locator('[data-testid="oralann-stop"]').click();
    await expect(page.locator('[data-testid="oralann-play"]')).toBeEnabled();
    await expect(page.locator('[data-testid="oralann-stop"]')).toBeDisabled();

    const transformAtStop = await cursor.evaluate((el) => el.style.transform);
    await page.waitForTimeout(400);
    expect(await cursor.evaluate((el) => el.style.transform)).toBe(transformAtStop); // halted
  });

  test("click-to-seek while stopped moves the cursor; Play resumes from there", async ({
    page,
  }) => {
    await openViewerAfterOneRecording(page);

    const row = page.locator('[data-testid="oralann-row-source"]');
    const box = await row.boundingBox();
    if (!box) throw new Error("oralann-row-source has no bounding box");

    await row.click({ position: { x: box.width * 0.4, y: box.height / 2 } });

    const seeked = parseReadout(
      (await page.locator('[data-testid="oralann-time-readout"]').textContent()) ?? "",
    );
    expect(seeked.pos).toBeCloseTo(0.4 * seeked.total, 0); // ±0.5s pixel-rounding tolerance
    await expect(page.locator('[data-testid="oralann-cursor"]')).toBeVisible();

    await page.locator('[data-testid="oralann-play"]').click();
    await page.waitForTimeout(500);
    const resumed = parseReadout(
      (await page.locator('[data-testid="oralann-time-readout"]').textContent()) ?? "",
    );
    expect(resumed.pos).toBeGreaterThan(seeked.pos); // resumed from the seek point, not 0
  });

  test.fixme("Regenerate rewrites the combined file (mtime changes)", async ({ page }) => {
    await openViewerAfterOneRecording(page);

    const before = await readIdbFileModifiedMs(page, COMBINED_WAV_NAME);
    await page.locator('[data-testid="oralann-regenerate"]').click();
    await expect(page.locator('[data-testid="oralann-regenerate"]')).toBeEnabled({
      timeout: 10_000,
    }); // re-enabled once isRegenerating clears

    const after = await readIdbFileModifiedMs(page, COMBINED_WAV_NAME);
    expect(after).not.toBe(before);
  });

  test.fixme("staleness: a new recording after the combined file exists triggers auto-regen on reopen", async ({
    page,
  }) => {
    await openViewerAfterOneRecording(page);
    const v1Bytes = await readIdbFileBytes(page, COMBINED_WAV_NAME);

    // Back to the Careful Speech recorder tab (the combined file exists now,
    // so the entry point is the OralAnnotations row's own tabs) and record
    // Careful for segment 1 too (the recorder auto-advances past the
    // already-annotated segment 0).
    await tabChip(page, "careful-speech").click();
    await expect(page.getByRole("button", { name: "Speak" })).toBeVisible();
    await page.waitForTimeout(500); // MicRecorder.open() settle
    await holdKey(page, " ", 2200); // segment 1 is ~1.5s
    await holdKey(page, " ", RECORD_HOLD_MS);
    await expect(page.locator('[data-testid="cell-play-1"]')).toBeVisible();

    // Back to the Combined Audio chip: only the viewer's OWN
    // staleness-triggered regen can pick up the new recording (there is no
    // regenerate-on-recorder-exit anymore).
    await tabChip(page, "combined-audio").click();
    await expect(page.locator('[data-testid="oralann-row-careful"]')).toBeVisible({
      timeout: 10_000,
    });

    const v2Bytes = await readIdbFileBytes(page, COMBINED_WAV_NAME);
    expect(v2Bytes).not.toEqual(v1Bytes);
  });
});
