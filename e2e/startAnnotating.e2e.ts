import { test, expect } from "@playwright/test";
import { fileTreeRow, openSample, resetSample, SAMPLE_EAF_NAME, tabChip } from "./helpers";

test.describe("Start Annotating", () => {
  test("audio with no eaf shows the SayMore tab with both segmentation methods", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await expect(tabChip(page, "start")).toBeVisible();
    await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manually segment/i })).toBeVisible();
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
  });

  test("Manually segment creates an empty eaf, opens the segmenter, and resets cleanly", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Manually segment/i }).click();

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible();
    // "Manually segment" opens the segmenter directly (0 boundaries yet).
    await expect(page.getByText(/Segments: 0/)).toBeVisible();

    await resetSample(page);
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Manually segment/i })).toBeVisible();
  });

  test("auto-segment writes a segmented eaf and shows the grid (ETR009_Tiny has pauses)", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Free Translation")).toBeVisible();
    // ETR009_Tiny.mp3 has pauses the auto-segmenter should split on.
    const segmentCount = await page.getByTitle("Play this segment").count();
    expect(segmentCount).toBeGreaterThanOrEqual(2);
  });
});
