import { test, expect } from "@playwright/test";
import { openSample, readIdbFileText, SAMPLE_EAF_NAME } from "./helpers";

/** Debounced auto-save in SegmenterViewModel (AUTO_SAVE_DELAY_MS) + margin. */
const AUTOSAVE_SETTLE_MS = 700;

async function enterSegmenter(page: import("@playwright/test").Page): Promise<void> {
  await openSample(page, { sel: "audio" });
  // Manual (not auto-segment) so we start from zero boundaries — deterministic
  // positions for the edits below, with no risk of colliding with wherever the
  // real audio's silences happen to fall.
  await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();
  await expect(page.getByText(/Transcription/)).toBeVisible();
  await page.getByRole("button", { name: /Segment…/ }).click();
  await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();
}

/**
 * Add a boundary at the current playhead: hold-play from the (always-0)
 * cursor for `atSec` seconds, then Enter, then stop. Real-time wait — the
 * media element genuinely plays — but avoids any pixel math against the
 * waveform to position the cursor.
 */
async function addBoundaryByListening(
  page: import("@playwright/test").Page,
  atSec: number,
): Promise<void> {
  await page.keyboard.press(" "); // start playback from the cursor (always 0 — see below)
  await page.waitForTimeout(atSec * 1000);
  await page.keyboard.press("Enter");
  await page.keyboard.press(" "); // stop
}

test.describe("Manual Segmenter", () => {
  test("Enter-at-cursor adds a boundary that actually changes the persisted .eaf", async ({
    page,
  }) => {
    await enterSegmenter(page);
    await expect(page.locator('[data-testid="boundary-0"]')).toHaveCount(0);

    const before = await readIdbFileText(page, SAMPLE_EAF_NAME);
    await addBoundaryByListening(page, 1.5);

    await expect(page.locator('[data-testid="boundary-0"]')).toBeVisible();
    // Inserting the first boundary into a zero-segment document appends
    // [0, at] rather than splitting a segment (there's nothing to split yet).
    await expect(page.getByText(/Segments: 1/)).toBeVisible();

    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    const after = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(after).not.toBe(before);
  });

  test("Tab-select cycles boundaries, arrow nudges, undo reverts", async ({ page }) => {
    await enterSegmenter(page);

    // Two boundaries, well separated (playback always restarts from cursor 0,
    // so the second hold must run long enough to pass the first boundary).
    await addBoundaryByListening(page, 1.5);
    await expect(page.locator('[data-testid="boundary-0"]')).toBeVisible();
    await addBoundaryByListening(page, 5.5);
    await expect(page.locator('[data-testid="boundary-1"]')).toBeVisible();
    // [0, 1.5] then [1.5, 5.5] appended — both are append-case inserts (see
    // above), so two boundaries means two segments, not three.
    await expect(page.getByText(/Segments: 2/)).toBeVisible();

    // Adding boundary 1 leaves it selected; Tab cycles to the next (wrapping
    // back to 0 with only two boundaries) — a real, verifiable selection move.
    await expect(page.locator('[data-testid="boundary-1"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-testid="boundary-0"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect(page.locator('[data-testid="boundary-1"]')).not.toHaveAttribute(
      "data-selected",
      "true",
    );

    const before = Number(
      await page.locator('[data-testid="boundary-0"]').getAttribute("data-boundary-sec"),
    );
    await page.keyboard.press("ArrowRight");
    const nudged = Number(
      await page.locator('[data-testid="boundary-0"]').getAttribute("data-boundary-sec"),
    );
    // NUDGE_MS = 5ms (SayMoreConstants.ts).
    expect(nudged).toBeCloseTo(before + 0.005, 2);

    await page.keyboard.press("z");
    const reverted = Number(
      await page.locator('[data-testid="boundary-0"]').getAttribute("data-boundary-sec"),
    );
    expect(reverted).toBeCloseTo(before, 2);
  });

  test("Back returns to the transcription grid", async ({ page }) => {
    await enterSegmenter(page);
    await addBoundaryByListening(page, 1.5);
    await expect(page.locator('[data-testid="boundary-0"]')).toBeVisible();

    await page.getByRole("button", { name: /Back to transcriptions/i }).click();
    await expect(page.getByRole("button", { name: /Segment…/ })).toBeVisible();
    await expect(page.getByTitle("Play this segment")).toHaveCount(1);
  });

  test("dragging a boundary with the mouse moves it", async ({ page }) => {
    await enterSegmenter(page);
    await addBoundaryByListening(page, 3);
    const boundary = page.locator('[data-testid="boundary-0"]');
    await expect(boundary).toBeVisible();
    const before = Number(await boundary.getAttribute("data-boundary-sec"));

    const box = await boundary.boundingBox();
    if (!box) throw new Error("boundary-0 has no bounding box");
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 100, y, { steps: 8 });
    await page.mouse.up();

    const after = Number(await boundary.getAttribute("data-boundary-sec"));
    expect(after).not.toBeCloseTo(before, 2);
  });
});
