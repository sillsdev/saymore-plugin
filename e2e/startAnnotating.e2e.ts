import { test, expect } from "@playwright/test";
import { fileTreeRow, openSample, resetSample, SAMPLE_EAF_NAME } from "./helpers";

test.describe("Start Annotating", () => {
  test("audio with no eaf offers both segmentation methods", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Use manual segmentation tool/i })).toBeVisible();
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
  });

  test("manual creates an empty eaf, jumps to the grid, and resets cleanly", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible();
    await expect(page.getByText(/Transcription/)).toBeVisible();
    await expect(page.getByText(/No segments yet/i)).toBeVisible();

    await resetSample(page);
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Use manual segmentation tool/i })).toBeVisible();
  });

  test("auto-segment writes a segmented eaf and shows the grid (ETR009_Tiny has pauses)", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Transcription/)).toBeVisible();
    // ETR009_Tiny.mp3 has pauses the auto-segmenter should split on.
    const segmentCount = await page.getByTitle("Play this segment").count();
    expect(segmentCount).toBeGreaterThanOrEqual(2);
  });
});
