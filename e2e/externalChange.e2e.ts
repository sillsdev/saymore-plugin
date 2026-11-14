import { test, expect } from "@playwright/test";
import { openSample, readIdbFileText, SAMPLE_EAF_NAME, writeIdbFileBytes } from "./helpers";

test.describe("External change to the annotation file", () => {
  test("the grid picks up an edit made to the .eaf behind the plugin's back", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    const transcriptionCell = page.locator('input[placeholder*="transcription"]').first();
    await expect(transcriptionCell).toHaveValue("");

    // Another program (ELAN) writes the eaf with a transcription filled in.
    const xml = await readIdbFileText(page, SAMPLE_EAF_NAME);
    const edited = xml.replace(
      /<ANNOTATION_VALUE\s*\/>|<ANNOTATION_VALUE>\s*<\/ANNOTATION_VALUE>/,
      "<ANNOTATION_VALUE>edited in ELAN</ANNOTATION_VALUE>",
    );
    expect(edited).not.toBe(xml);
    await writeIdbFileBytes(page, SAMPLE_EAF_NAME, new TextEncoder().encode(edited), {
      modifiedMs: Date.now() + 60_000,
    });

    // The 2s poll reloads it silently: no banner, and the cell shows the new text.
    await expect(transcriptionCell).toHaveValue("edited in ELAN", { timeout: 10_000 });
    await expect(page.getByTestId("external-change-banner")).toHaveCount(0);
  });
});
