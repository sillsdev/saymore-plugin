import { test, expect } from "@playwright/test";
import {
  SAMPLE_EAF_NAME,
  SAMPLE_MEDIA_NAME,
  expectGridVisible,
  fileTreeRow,
  openSample,
  tabChip,
} from "./helpers";

test.describe("harness smoke", () => {
  test("bundled sample session loads and the file tree shows the audio row", async ({ page }) => {
    await openSample(page);
    await expect(fileTreeRow(page, SAMPLE_MEDIA_NAME)).toBeVisible();
    // No eaf yet on a pristine sample: only the Audio row exists.
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
  });

  test("selecting the audio row navigates to the SayMore tab", async ({ page }) => {
    await openSample(page);
    await fileTreeRow(page, SAMPLE_MEDIA_NAME).click();
    await expect(tabChip(page, "start")).toBeVisible();
    await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manually segment/i })).toBeVisible();
  });

  test("selecting the eaf row navigates to the Annotations pane", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Manually segment/i }).click();
    // Creating the eaf jumps straight to it (mirrors lameta's rescan +
    // selectFile); "Manually segment" opens the segmenter directly.
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible();
    await expect(page.getByText(/Segments: 0/)).toBeVisible();
    // The eaf selection shows its single tab chip (the segmenter is in-pane now).
    await expect(tabChip(page, "transcription-translation")).toBeVisible();
    await expect(tabChip(page, "segments")).toHaveCount(0);

    // Selecting the audio row again shows the "already annotated" note, not the
    // Start Annotating screen (an eaf now exists).
    await fileTreeRow(page, SAMPLE_MEDIA_NAME).click();
    await expect(page.getByText(/already has annotations/i)).toBeVisible();

    // Back on the eaf row the grid opens by default (its single tab).
    await fileTreeRow(page, SAMPLE_EAF_NAME).click();
    await expectGridVisible(page);
  });

  test("deep link ?sel=eaf&view=segmenter restores the segmenter view", async ({ page }) => {
    // A deep link into the segmenter needs an eaf to already exist.
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Manually segment/i }).click();
    await expect(page.getByText(/Segments: 0/)).toBeVisible();

    // Re-navigate with the URL a bookmark/share would carry (same session
    // storage — this is not a click-through, it's the deep-link restore path).
    await openSample(page, { sel: "eaf", view: "segmenter" });
    // A freshly manually-created eaf has no segments yet (0), unlike auto-segment.
    await expect(page.getByText(/Segments: 0/)).toBeVisible();
  });
});
