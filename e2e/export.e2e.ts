import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { decodeWav } from "../src/audio/wavCodec";
import { encodeWavPcm16Mono } from "../src/audio/wavWriter";
import { openSample, SAMPLE_MEDIA_NAME, writeIdbFileBytes } from "./helpers";

test.describe("Export menu", () => {
  test("is enabled once the grid has rows", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Export/ })).toBeEnabled();
  });

  test("Export > Subtitles File (Transcription) downloads SayMore's SRT", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    const cell = page.locator('input[placeholder*="transcription"]').first();
    await cell.fill("hello, world");
    await cell.blur();

    await page.getByRole("button", { name: /^Export/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Subtitles File (Transcription)..." }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("ETR009_Tiny_transcription_subtitle.srt");
    const text = readFileSync((await download.path())!, "utf8");
    expect(text).toMatch(
      /^1\r\n00:00:00,\d\d --> \d\d:\d\d:\d\d,\d\d\r\nhello, world\r\n\r\n2\r\n/,
    );
  });

  test("Export > Spreadsheet (CSV) File downloads a quoted row", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    const cell = page.locator('input[placeholder*="transcription"]').first();
    await cell.fill("hello, world");
    await cell.blur();

    await page.getByRole("button", { name: /^Export/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Spreadsheet (CSV) File..." }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("ETR009_Tiny_transcription.csv");
    const text = readFileSync((await download.path())!, "utf8");
    expect(text).toMatch(/^1,00:00:00\.\d\d,\d\d:\d\d:\d\d\.\d\d,"hello, world",\r\n/);
  });

  test("Export > FLEx Interlinear Text asks for writing systems and writes a .flextext with a byte order mark", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^Export/ }).click();
    await page.getByRole("menuitem", { name: "FLEx Interlinear Text..." }).click();
    await page.getByLabel("Transcription:").fill("qaa");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export..." }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("ETR009_Tiny.mp3.flextext");
    const bytes = readFileSync((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    expect(text).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(text).toContain('<language lang="qaa" />');
  });
});

test.describe("Export menu audio items", () => {
  const clipWav = (v: number) => encodeWavPcm16Mono(new Float32Array([v]), 8000);

  test("are disabled until recordings exist, then export the combined WAV in start order", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^Export/ }).click();
    await expect(page.getByRole("menuitem", { name: "Careful Speech Audio..." })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: "Oral Translation Audio..." })).toBeDisabled();
    await page.keyboard.press("Escape");

    const folder = `${SAMPLE_MEDIA_NAME}_Annotations`;
    await writeIdbFileBytes(page, `${folder}/2_to_3_Careful.wav`, clipWav(0.5));
    await writeIdbFileBytes(page, `${folder}/0.5_to_2_Careful.wav`, clipWav(0.25));

    await page.getByRole("button", { name: /^Export/ }).click();
    await expect(page.getByRole("menuitem", { name: "Careful Speech Audio..." })).toBeEnabled();
    await expect(page.getByRole("menuitem", { name: "Oral Translation Audio..." })).toBeDisabled();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Careful Speech Audio..." }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("ETR009_Tiny_CarefulSpeech.wav");
    const decoded = decodeWav(new Uint8Array(readFileSync((await download.path())!)));
    expect(Array.from(decoded.channels[0])).toEqual([0.25, 0.5]);
    await expect(page.getByRole("status")).toContainText("exported as a WAV file");
  });
});
