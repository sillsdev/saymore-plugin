import { test, expect, type Page } from "@playwright/test";
import { openSample } from "./helpers";

test.describe("Transcription grid", () => {
  test("editing Transcription / Free Translation cells persists through a reload", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

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

    await expect(page.getByText("Free Translation")).toBeVisible();
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
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

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

test.describe("Transcription grid: SayMore behaviour", () => {
  async function openGrid(page: Page) {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });
    // The bundled sample auto-segments into three rows.
    await expect(page.getByTestId("grid-row-2")).toBeVisible();
  }
  const cell = (page: Page, row: number, column: "transcription" | "freeTranslation") =>
    page.locator(`[data-grid-cell="${row}:${column}"]`);

  async function ignoreRow(page: Page, row: number) {
    await cell(page, row, "transcription").click({ button: "right" });
    await page.getByRole("menuitemcheckbox", { name: "Ignored" }).click();
    await expect(page.getByTestId(`grid-row-${row}`)).toHaveAttribute("data-ignored", "true");
  }

  test("Ignored rows read 'Ignored', are not editable, and the toggle persists", async ({
    page,
  }) => {
    await openGrid(page);
    await ignoreRow(page, 1);
    const row = page.getByTestId("grid-row-1");
    await expect(row.getByText("Ignored")).toHaveCount(2);
    await expect(row.locator("input")).toHaveCount(0);
    await expect(row).not.toContainText("%ignore%");

    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByTestId("grid-row-1")).toHaveAttribute("data-ignored", "true");

    await cell(page, 1, "transcription").click({ button: "right" });
    const item = page.getByRole("menuitemcheckbox", { name: "Ignored" });
    await expect(item).toHaveAttribute("aria-checked", "true");
    await item.click();
    await expect(page.getByTestId("grid-row-1")).not.toHaveAttribute("data-ignored", "true");
    await expect(cell(page, 1, "transcription")).toHaveValue("");
  });

  test("Tab wraps across rows and Up/Down skip ignored rows", async ({ page }) => {
    await openGrid(page);
    await ignoreRow(page, 1);

    await cell(page, 0, "transcription").click();
    await page.keyboard.press("Tab");
    await expect(cell(page, 0, "freeTranslation")).toBeFocused();
    await page.keyboard.press("Tab");
    // Tab visits ignored rows; only the arrow keys skip them.
    await expect(cell(page, 1, "transcription")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cell(page, 0, "freeTranslation")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(cell(page, 2, "freeTranslation")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(cell(page, 0, "freeTranslation")).toBeFocused();
  });

  test("entering a row starts playing it, and F2 pauses and resumes it", async ({ page }) => {
    await openGrid(page);
    const playButton = page.getByTestId("grid-row-2").getByTitle("Play this segment");
    // The engine's element is a detached Audio, so the page's play() and pause() calls are
    // recorded: the last one says whether the engine is playing or holding.
    await page.evaluate(() => {
      const w = window as unknown as { lastMediaCall: string };
      const proto = HTMLMediaElement.prototype;
      const play = proto.play;
      const pause = proto.pause;
      proto.play = function (this: HTMLMediaElement) {
        w.lastMediaCall = "play";
        return play.call(this);
      };
      proto.pause = function (this: HTMLMediaElement) {
        w.lastMediaCall = "pause";
        pause.call(this);
      };
    });
    const anyMediaPlaying = (): Promise<boolean> =>
      page.evaluate(
        () => (window as unknown as { lastMediaCall: string }).lastMediaCall === "play",
      );
    await cell(page, 2, "transcription").click();
    await expect(playButton).toHaveText("■");
    await expect.poll(anyMediaPlaying).toBe(true);

    // As in SayMore, a pause leaves the row in progress (its button still shows stop).
    await page.keyboard.press("F2");
    await expect.poll(anyMediaPlaying).toBe(false);
    await expect(playButton).toHaveText("■");

    await page.keyboard.press("F2");
    await expect.poll(anyMediaPlaying).toBe(true);

    await cell(page, 0, "transcription").click();
    await expect(playButton).toHaveText("▶");
  });

  test("playback speed and column playback options are remembered", async ({ page }) => {
    await openGrid(page);
    await page.getByRole("combobox", { name: "Playback speed" }).click();
    await page.getByRole("option", { name: "40%" }).click();
    await page.getByTestId("transcription-options").click();
    await page.getByRole("menuitemradio", { name: "Playback Both Recordings" }).click();

    await page.reload();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveText("40%");
    await page.getByTestId("transcription-options").click();
    await expect(
      page.getByRole("menuitemradio", { name: "Playback Both Recordings" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
