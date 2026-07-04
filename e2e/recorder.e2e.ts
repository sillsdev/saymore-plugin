import { test, expect, type Page } from "@playwright/test";
import {
  holdKey,
  listIdbFileNames,
  openSample,
  readIdbFileBytes,
  SAMPLE_MEDIA_NAME,
} from "./helpers";

/**
 * THE POINT of this suite. Un-gated now that the merge step (e318b49: real
 * MicRecorder wired into ProjectStore.openRecorder) and the C6 icon-button UI
 * (16096de) have landed. The fake-mic launch flags in playwright.config.ts
 * make `getUserMedia` yield a synthetic tone — the real MicRecorder +
 * AudioWorklet capture path runs for real against it.
 */

const TOO_SHORT_HOLD_MS = 200; // well under MIN_SEGMENT_LENGTH_MS (460ms)
const RECORD_HOLD_MS = 1000;
// MediaElementPlaybackEngine auto-stops a range once currentTime reaches its
// end, so holding well past a segment's real length is safe — release just
// needs to land after that auto-stop, not at any precise instant.
const LISTEN_SEGMENT0_HOLD_MS = 1800; // segment 0 is ~1s
const ANNOTATIONS_FOLDER = `${SAMPLE_MEDIA_NAME}_Annotations/`;
const COMBINED_WAV_NAME = `${SAMPLE_MEDIA_NAME}.oralAnnotations.wav`;

/**
 * Two real segments ([0, ~1s], [~1s, ~2.5s]) via the same real-time
 * listen+Enter technique as segmenter.e2e.ts (playback always restarts from
 * cursor 0, so the second hold must run long enough to pass the first
 * boundary) — deterministic without any pixel math, and short enough that a
 * push-to-talk listen-hold can reach each segment's end in a couple of
 * seconds.
 */
async function createTwoRealSegments(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();
  await expect(page.getByText(/Transcription/)).toBeVisible();
  await page.getByRole("button", { name: /Segment…/ }).click();
  await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();

  await page.keyboard.press(" ");
  await page.waitForTimeout(1000);
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");

  await page.keyboard.press(" ");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");

  await expect(page.getByText(/Segments: 2/)).toBeVisible();
  await page.waitForTimeout(700); // let the debounced eaf auto-save flush

  await page.getByRole("button", { name: /Back to transcriptions/i }).click();
  await expect(page.getByText(/Transcription/)).toBeVisible();
}

async function openRecorder(
  page: Page,
  kind: "Careful Speech" | "Oral Translation",
): Promise<void> {
  await page.getByRole("button", { name: /Oral Annotations Tools/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(kind) }).click();
  await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();
  // MicRecorder.open() (getUserMedia + AudioContext + AudioWorklet.addModule)
  // is async; give it a moment before the first push-to-talk hold.
  await page.waitForTimeout(500);
}

/** Poll until `listIdbFileNames` satisfies `predicate`, or fail after `timeoutMs`. */
async function waitForFiles(
  page: Page,
  predicate: (files: string[]) => boolean,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = await listIdbFileNames(page);
    if (predicate(files)) return files;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for files: ${JSON.stringify(files)}`);
    await page.waitForTimeout(150);
  }
}

test.describe("Oral Annotations recorder (Careful Speech / Oral Translation)", () => {
  test("record over an armed segment: cell shows annotated, WAV lands in _Annotations/, advances", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await createTwoRealSegments(page);
    await openRecorder(page, "Careful Speech");

    await expect(page.getByRole("button", { name: "Speak" })).toBeDisabled();
    await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS); // listen: arms Record for segment 0
    await expect(page.getByRole("button", { name: "Speak" })).toBeEnabled();
    await holdKey(page, " ", RECORD_HOLD_MS); // record segment 0

    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();
    // Advance: the listen gate resets for the newly-current segment (1).
    await expect(page.getByRole("button", { name: "Speak" })).toBeDisabled();

    const files = await listIdbFileNames(page);
    expect(files.some((f) => f.startsWith(ANNOTATIONS_FOLDER) && f.endsWith("_Careful.wav"))).toBe(
      true,
    );
  });

  test("a too-short press shows the Whoops warning and writes nothing", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await createTwoRealSegments(page);
    await openRecorder(page, "Careful Speech");

    await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS);
    const filesBefore = await listIdbFileNames(page);

    await holdKey(page, " ", TOO_SHORT_HOLD_MS);

    await expect(page.getByText(/Whoops/i)).toBeVisible();
    expect(await listIdbFileNames(page)).toEqual(filesBefore);
    await expect(page.locator('[data-testid="cell-play-0"]')).toHaveCount(0);
  });

  test("re-record, erase, and undo round-trip a cell's recording", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await createTwoRealSegments(page);
    await openRecorder(page, "Careful Speech");

    await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS);
    await holdKey(page, " ", RECORD_HOLD_MS);
    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();
    const firstTakeFiles = await listIdbFileNames(page);
    const wavName = firstTakeFiles.find(
      (f) => f.startsWith(ANNOTATIONS_FOLDER) && f.endsWith("_Careful.wav"),
    );
    if (!wavName) throw new Error("expected a _Careful.wav after the first take");
    const firstTakeBytes = await readIdbFileBytes(page, wavName);

    // Re-record (press-and-hold on the cell's mic button) replaces the take —
    // same filename (same segment range), different bytes.
    const cell = page.locator('[data-testid="annotation-cell-0"]');
    await cell.hover();
    const rerecordBtn = page.locator('[data-testid="cell-rerecord-0"]');
    await expect(rerecordBtn).toBeVisible();
    const box = await rerecordBtn.boundingBox();
    if (!box) throw new Error("cell-rerecord-0 has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(RECORD_HOLD_MS);
    await page.mouse.up();
    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();
    expect(await listIdbFileNames(page)).toContain(wavName); // same name, overwritten
    const reRecordedBytes = await readIdbFileBytes(page, wavName);
    expect(reRecordedBytes).not.toEqual(firstTakeBytes); // different capture window

    // Erase drops the recording (segment 0 becomes current again); undo
    // restores it. window.confirm() fires synchronously during the click, so
    // the dialog handler must be armed first.
    await cell.hover();
    page.once("dialog", (d) => void d.accept());
    await page.locator('[data-testid="cell-erase-0"]').click();
    await expect(page.locator('[data-testid="cell-play-0"]')).toHaveCount(0);
    expect(await listIdbFileNames(page)).not.toContain(wavName);

    await page.keyboard.press("z");
    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();
    expect(await listIdbFileNames(page)).toContain(wavName);
    expect(await readIdbFileBytes(page, wavName)).toEqual(reRecordedBytes); // restores the re-recorded take
  });

  test("Oral Translation: minimal listen → record → annotated flow", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await createTwoRealSegments(page);
    await openRecorder(page, "Oral Translation");

    await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS);
    await holdKey(page, " ", RECORD_HOLD_MS);

    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();
    const files = await listIdbFileNames(page);
    expect(
      files.some((f) => f.startsWith(ANNOTATIONS_FOLDER) && f.endsWith("_Translation.wav")),
    ).toBe(true);
  });

  test("leaving the recorder regenerates <media>.oralAnnotations.wav", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await createTwoRealSegments(page);
    await openRecorder(page, "Careful Speech");

    await holdKey(page, " ", LISTEN_SEGMENT0_HOLD_MS);
    await holdKey(page, " ", RECORD_HOLD_MS);
    await expect(page.locator('[data-testid="cell-play-0"]')).toBeVisible();

    await page.getByRole("button", { name: /Back to transcriptions/i }).click();
    await expect(page.getByRole("button", { name: /Segment…/ })).toBeVisible();

    await waitForFiles(page, (files) => files.includes(COMBINED_WAV_NAME), 10_000);
  });
});
