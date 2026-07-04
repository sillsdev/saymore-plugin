import { test, expect } from "@playwright/test";
import { openSample } from "./helpers";

test.describe("Transcription grid", () => {
  test("editing Transcription / Free Translation cells persists through a reload", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText(/Transcription/)).toBeVisible({ timeout: 15_000 });

    const transcriptionCell = page.locator('input[placeholder*="transcription"]').first();
    const freeTranslationCell = page.locator('input[placeholder*="free translation"]').first();

    await transcriptionCell.fill("hello world");
    await transcriptionCell.blur();
    await freeTranslationCell.fill("bonjour le monde");
    await freeTranslationCell.blur();

    // Committed on blur, straight to the eaf (no separate save step) — give the
    // write a moment before reloading.
    await page.waitForTimeout(300);
    await page.reload();

    await expect(page.getByText(/Transcription/)).toBeVisible();
    await expect(page.locator('input[placeholder*="transcription"]').first()).toHaveValue(
      "hello world",
    );
    await expect(page.locator('input[placeholder*="free translation"]').first()).toHaveValue(
      "bonjour le monde",
    );
  });

  test("the per-row play button does not throw", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (e) => errors.push(e));

    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText(/Transcription/)).toBeVisible({ timeout: 15_000 });

    const playButtons = page.getByTitle("Play this segment");
    const count = await playButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      await playButtons.nth(i).click();
    }

    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});
