import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, readText } from "./lametaFixture";

// An .annotations.eaf that already has segments, in the fixture's "Annotated" session.
const EAF = "story.wav.annotations.eaf";
const COMBINED = "story.wav.oralAnnotations.wav";

test("the grid on an .annotations.eaf shows its segments, and an edit is saved to the eaf", async ({
  lameta,
}) => {
  await lameta.selectFile("Annotated", EAF);
  await expect(lameta.tab("Transcription & Translation")).toBeVisible();

  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByTestId("grid-row-1"));
  await expect(frame.locator('[data-testid^="grid-row-"]')).toHaveCount(2);
  await expect(frame.locator('input[placeholder*="transcription"]').first()).toHaveValue(
    "first phrase",
  );

  const cell = frame.locator('input[placeholder*="transcription"]').first();
  await cell.fill("edited in lameta");
  await cell.blur();
  await expect
    .poll(() => readText(lameta.sessionFile("Annotated", EAF)))
    .toContain("<ANNOTATION_VALUE>edited in lameta</ANNOTATION_VALUE>");
});

test("Setup Oral Annotation selects the combined file, whose Careful Speech, Oral Translation and Combined Audio tabs open", async ({
  lameta,
}) => {
  await lameta.selectFile("Annotated", EAF);
  const grid = lameta.pluginFrame();
  await lameta.expectInPlugin(grid.getByRole("button", { name: /Setup Oral Annotation/ }));
  await grid.getByRole("button", { name: /Setup Oral Annotation/ }).click();

  await expect.poll(() => existsSync(lameta.sessionFile("Annotated", COMBINED))).toBe(true);
  await lameta.expectSelected(COMBINED);

  // Careful Speech is the default tab of the combined file.
  await expect(lameta.tab("Careful Speech")).toHaveAttribute("aria-selected", "true");
  await lameta.expectInPlugin(lameta.pluginFrame().getByRole("button", { name: "Speak" }));

  await lameta.tab("Oral Translation").click();
  await lameta.expectInPlugin(lameta.pluginFrame().getByRole("button", { name: "Speak" }));

  await lameta.tab("Combined Audio").click();
  const viewer = lameta.pluginFrame();
  await lameta.expectInPlugin(viewer.getByTestId("oralann-row-careful"));
  await expect(viewer.getByTestId("oralann-row-translation")).toBeVisible();
});

test("Export > Spreadsheet (CSV) File saves through lameta's Save dialog", async ({ lameta }) => {
  const target = join(lameta.projectDir, "..", "exported.csv");
  await lameta.stubSaveDialog(target);

  await lameta.selectFile("Annotated", EAF);
  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: /^Export/ }));
  await frame.getByRole("button", { name: /^Export/ }).click();
  await frame.getByRole("menuitem", { name: "Spreadsheet (CSV) File..." }).click();

  await expect.poll(() => existsSync(target)).toBe(true);
  const csv = readText(target);
  expect(csv).toContain("first phrase");
  expect(csv).toContain("second translation");
});

test("Export > Careful Speech Audio saves the recorded clips as one mp3 through lameta's Save dialog", async ({
  lameta,
}) => {
  const target = join(lameta.projectDir, "..", "careful.mp3");
  await lameta.stubSaveDialog(target);

  await lameta.selectFile("Annotated", EAF);
  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: /^Export/ }));
  await frame.getByRole("button", { name: /^Export/ }).click();
  // The fixture has a Careful Speech clip and an Oral Translation clip.
  await frame.getByRole("menuitem", { name: "Careful Speech Audio..." }).click();

  await expect.poll(() => existsSync(target)).toBe(true);
  // As in SayMore, with an ffmpeg the export is an mp3.
  const mp3 = readFileSync(target);
  const id3 = mp3.subarray(0, 3).toString("latin1") === "ID3";
  const frameSync = mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0;
  expect(id3 || frameSync).toBe(true);
  expect(mp3.length).toBeGreaterThan(1000);
  // The temporary files that the conversion went through are gone.
  expect(
    readdirSync(lameta.sessionFile("Annotated", "story.wav_Annotations")).filter((f) =>
      f.startsWith("_export_"),
    ),
  ).toEqual([]);
});
