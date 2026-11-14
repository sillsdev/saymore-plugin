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

    // As in SayMore, only the current row has a play button: make each row current and press it.
    const count = await page.locator('[data-testid^="grid-row-"]').count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      await page.getByTestId(`segment-cell-${i}`).click();
      const playButton = page.getByTestId(`grid-row-${i}`).getByTitle("Play this segment");
      await expect(playButton).toHaveCount(1);
      await playButton.click();
    }

    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});

/** A row's segment range, read from its first cell's tooltip ("02.1 - 04.6"). */
async function segmentRange(page: Page, row: number): Promise<{ start: number; end: number }> {
  const title = (await page.getByTestId(`segment-cell-${row}`).getAttribute("title")) ?? "";
  const match = /([\d:.]+) - ([\d:.]+)/.exec(title);
  if (!match) throw new Error(`No time range in "${title}"`);
  const seconds = (text: string) =>
    text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return { start: seconds(match[1]), end: seconds(match[2]) };
}

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
    // recorded: the last one says whether the engine is playing or holding, and the element
    // last played says where playback is.
    await page.evaluate(() => {
      const w = window as unknown as { lastMediaCall: string; lastMediaEl: HTMLMediaElement };
      const proto = HTMLMediaElement.prototype;
      const play = proto.play;
      const pause = proto.pause;
      proto.play = function (this: HTMLMediaElement) {
        w.lastMediaCall = "play";
        w.lastMediaEl = this;
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

    // Only the current row has a play button, as in SayMore.
    await cell(page, 0, "transcription").click();
    await expect(playButton).toHaveCount(0);
    await expect(page.getByTestId("grid-row-0").getByTitle("Play this segment")).toHaveText("■");

    // Row 2's playback has ended: what plays now is inside row 0's range, not row 2's.
    const row2 = await segmentRange(page, 2);
    const row0 = await segmentRange(page, 0);
    const position = (): Promise<number> =>
      page.evaluate(
        () => (window as unknown as { lastMediaEl: HTMLMediaElement }).lastMediaEl.currentTime,
      );
    await expect
      .poll(async () => {
        const at = await position();
        return at >= row0.start - 0.05 && at <= row0.end + 0.05;
      })
      .toBe(true);
    const at = await position();
    expect(at < row2.start - 0.05 || at > row2.end + 0.05).toBe(true);
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

test.describe("Transcription grid: fonts and playback fill", () => {
  async function openGrid(page: Page) {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("grid-row-2")).toBeVisible();
  }
  const cell = (page: Page, row: number, column: "transcription" | "freeTranslation") =>
    page.locator(`[data-grid-cell="${row}:${column}"]`);

  test("a column font chosen with Options > Fonts... applies to its cells and persists", async ({
    page,
  }) => {
    await openGrid(page);
    await page.getByTestId("transcription-options").click();
    await page.getByRole("menuitem", { name: "Fonts..." }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Font", { exact: true }).fill("Courier New");
    await dialog.getByLabel("Size").click();
    await page.getByRole("option", { name: "18", exact: true }).click();
    await dialog.getByLabel("Italic").check();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toBeHidden();

    const expectFont = async () => {
      const style = await cell(page, 0, "transcription").evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, size: s.fontSize, italic: s.fontStyle };
      });
      expect(style.family).toContain("Courier New");
      expect(style.size).toBe("24px");
      expect(style.italic).toBe("italic");
      const other = await cell(page, 0, "freeTranslation").evaluate(
        (el) => getComputedStyle(el).fontFamily,
      );
      expect(other).not.toContain("Courier New");
    };
    await expectFont();
    // Rows grow so the larger text is not clipped.
    const rowHeight = await page
      .getByTestId("grid-row-0")
      .evaluate((el) => (el as HTMLElement).offsetHeight);
    expect(rowHeight).toBeGreaterThan(34);

    await page.reload();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });
    await expectFont();
    const stored = await page.evaluate(() => localStorage.getItem("projectSettings"));
    expect(JSON.parse(stored ?? "null")).toEqual({
      version: 1,
      transcriptionFont: { family: "Courier New", sizePt: 18, italic: true },
    });
  });

  test("the current row's first cell fills as playback progresses, and only it has a play button", async ({
    page,
  }) => {
    await openGrid(page);
    await expect(page.getByTitle("Play this segment")).toHaveCount(1);
    await cell(page, 1, "transcription").click();
    await expect(page.getByTestId("grid-row-1").getByTitle("Play this segment")).toHaveText("■");
    await expect(page.getByTitle("Play this segment")).toHaveCount(1);

    const fill = page.getByTestId("segment-cell-1").getByTestId("playback-progress");
    const widthPercent = () =>
      fill.evaluate((el) => parseFloat((el as HTMLElement).style.width) || 0).catch(() => 0);
    await expect.poll(widthPercent, { timeout: 10_000 }).toBeGreaterThan(0);
    const early = await widthPercent();
    await expect.poll(widthPercent, { timeout: 10_000 }).toBeGreaterThan(early);

    // Inset 3px top and bottom within the cell.
    const boxes = await page.getByTestId("segment-cell-1").evaluate((el) => {
      const cellBox = el.getBoundingClientRect();
      const fillBox = el
        .querySelector('[data-testid="playback-progress"]')!
        .getBoundingClientRect();
      return { top: fillBox.top - cellBox.top, bottom: cellBox.bottom - fillBox.bottom };
    });
    expect(boxes.top).toBeCloseTo(3, 0);
    expect(boxes.bottom).toBeCloseTo(3, 0);

    await expect(page.getByTestId("segment-cell-1")).toHaveAttribute(
      "title",
      /^Segment range: \d\d\.\d - \d\d\.\d\nPress F2 to Play\/Pause$/,
    );
    await expect(page.getByTestId("segment-cell-0")).toHaveAttribute(
      "title",
      /^\d\d\.\d - \d\d\.\d$/,
    );
  });
});
