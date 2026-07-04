import { test, expect } from "@playwright/test";
import { SAMPLE_EAF_NAME, SAMPLE_MEDIA_NAME, fileTreeRow, openSample } from "./helpers";

test.describe("harness smoke", () => {
  test("bundled sample session loads and the file tree shows the audio row", async ({ page }) => {
    await openSample(page);
    await expect(fileTreeRow(page, SAMPLE_MEDIA_NAME)).toBeVisible();
    // No eaf yet on a pristine sample: only the Audio row exists.
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
  });

  test("selecting the audio row navigates to Start Annotating", async ({ page }) => {
    await openSample(page);
    await fileTreeRow(page, SAMPLE_MEDIA_NAME).click();
    await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Use manual segmentation tool/i })).toBeVisible();
  });

  test("selecting the eaf row navigates to the Annotations pane", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();
    // Creating the eaf jumps straight to it (mirrors lameta's rescan + selectFile).
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible();
    await expect(page.getByText(/Transcription/)).toBeVisible();

    // Selecting the audio row again shows the "already annotated" note, not the
    // Start Annotating screen (an eaf now exists).
    await fileTreeRow(page, SAMPLE_MEDIA_NAME).click();
    await expect(page.getByText(/already has annotations/i)).toBeVisible();

    // And back to the eaf row returns to the Annotations pane.
    await fileTreeRow(page, SAMPLE_EAF_NAME).click();
    await expect(page.getByText(/Transcription/)).toBeVisible();
  });

  test("deep link ?sel=eaf&view=segmenter restores the segmenter view", async ({ page }) => {
    // A deep link into the segmenter needs an eaf to already exist.
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();
    await expect(page.getByText(/Transcription/)).toBeVisible();

    // Re-navigate with the URL a bookmark/share would carry (same session
    // storage — this is not a click-through, it's the deep-link restore path).
    await openSample(page, { sel: "eaf", view: "segmenter" });
    await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();
    // A freshly manually-created eaf has no segments yet (0), unlike auto-segment.
    await expect(page.getByText(/Segments: 0/)).toBeVisible();
  });
});
