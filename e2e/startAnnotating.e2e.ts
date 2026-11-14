import { test, expect, type Page } from "@playwright/test";
import {
  COMBINED_WAV_NAME,
  expectGridVisible,
  fileTreeRow,
  idbFileExists,
  openSample,
  readIdbFileText,
  resetSample,
  SAMPLE_EAF_NAME,
  SAMPLE_MEDIA_NAME,
  tabChip,
  waitForFiles,
} from "./helpers";

/** An ELAN file as another tool wrote it: a foreign tier, another media path, ids up to a9. */
const ELAN_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="" FORMAT="3.0" VERSION="3.0">
  <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
    <MEDIA_DESCRIPTOR MEDIA_URL="file:///elsewhere/other.wav" MIME_TYPE="audio/x-wav"/>
    <PROPERTY NAME="lastUsedAnnotationId">3</PROPERTY>
  </HEADER>
  <TIME_ORDER>
    <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="0"/>
    <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="1000"/>
    <TIME_SLOT TIME_SLOT_ID="ts3" TIME_VALUE="1000"/>
    <TIME_SLOT TIME_SLOT_ID="ts4" TIME_VALUE="2400"/>
  </TIME_ORDER>
  <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="Transcription">
    <ANNOTATION><ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2"><ANNOTATION_VALUE>kia ora</ANNOTATION_VALUE></ALIGNABLE_ANNOTATION></ANNOTATION>
    <ANNOTATION><ALIGNABLE_ANNOTATION ANNOTATION_ID="a2" TIME_SLOT_REF1="ts3" TIME_SLOT_REF2="ts4"><ANNOTATION_VALUE>haere mai</ANNOTATION_VALUE></ALIGNABLE_ANNOTATION></ANNOTATION>
  </TIER>
  <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="Notes">
    <ANNOTATION><REF_ANNOTATION ANNOTATION_ID="a9" ANNOTATION_REF="a1"><ANNOTATION_VALUE>a greeting</ANNOTATION_VALUE></REF_ANNOTATION></ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>`;

const AUDACITY_FIXTURE =
  "0.000000\t1.000000\tfirst\n\\\t4000.000000\t200.000000\n1.000000\t2.400000\tsecond\n";

/** Click a Start Annotating button that opens a file dialog, and choose `content` in it. */
async function chooseFile(
  page: Page,
  buttonName: RegExp,
  file: { name: string; content: string },
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: buttonName }).click();
  await (
    await chooser
  ).setFiles({ name: file.name, mimeType: "text/plain", buffer: Buffer.from(file.content) });
}

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
    const segmentCount = await page.locator('[data-testid^="grid-row-"]').count();
    expect(segmentCount).toBeGreaterThanOrEqual(2);
  });

  test("offers SayMore's five methods in SayMore's order", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    const names = await page
      .getByRole("button", { name: /segment|Careful|ELAN|Audacity/i })
      .allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([
      "Manually segment",
      "Use Careful Speech Tool",
      "Copy an existing ELAN file",
      "Import an Audacity Label file",
      "Auto-segment",
    ]);
    await expect(page.getByLabel("Import label text into")).toHaveValue("Transcription");
  });

  test("Audacity labels become segments with their text in the transcription tier", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await chooseFile(page, /Import an Audacity Label file/i, {
      name: "labels.txt",
      content: AUDACITY_FIXTURE,
    });

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expectGridVisible(page);
    await expect(page.locator('[data-testid^="grid-row-"]')).toHaveCount(2);

    const eaf = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(eaf).toContain(`MEDIA_URL="${SAMPLE_MEDIA_NAME}"`);
    expect(eaf).toContain("<ANNOTATION_VALUE>first</ANNOTATION_VALUE>");
    expect(eaf).toContain("<ANNOTATION_VALUE>second</ANNOTATION_VALUE>");
    expect(eaf).toContain('TIME_VALUE="2400"');
    expect(eaf).not.toContain("REF_ANNOTATION");
  });

  test("Audacity labels can go into the Free Translation tier instead", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByLabel("Import label text into").selectOption("FreeTranslation");
    await chooseFile(page, /Import an Audacity Label file/i, {
      name: "labels.txt",
      content: AUDACITY_FIXTURE,
    });

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expectGridVisible(page);
    const eaf = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(eaf).toContain("<ANNOTATION_VALUE>first</ANNOTATION_VALUE>");
    expect(eaf).toMatch(/<REF_ANNOTATION[^>]*>\s*<ANNOTATION_VALUE>second<\/ANNOTATION_VALUE>/);
    expect(eaf).toMatch(/<ALIGNABLE_ANNOTATION[^>]*>\s*<ANNOTATION_VALUE><\/ANNOTATION_VALUE>/);
  });

  test("an existing ELAN file is copied: segments and foreign tiers kept, media retargeted", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await chooseFile(page, /Copy an existing ELAN file/i, {
      name: "story.eaf",
      content: ELAN_FIXTURE,
    });

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expectGridVisible(page);
    await expect(page.locator('[data-testid^="grid-row-"]')).toHaveCount(2);

    const eaf = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(eaf).toContain(`MEDIA_URL="${SAMPLE_MEDIA_NAME}"`);
    expect(eaf).not.toContain("elsewhere");
    expect(eaf).toContain('TIER_ID="Notes"');
    expect(eaf).toContain("a greeting");
    expect(eaf).toContain("kia ora");
    expect(eaf).toMatch(/<PROPERTY NAME="lastUsedAnnotationId">9<\/PROPERTY>/);
    expect(eaf).toContain('TIER_ID="Phrase Free Translation"');
  });

  test("an ELAN file with differently named tiers starts with no segments", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await chooseFile(page, /Copy an existing ELAN file/i, {
      name: "story.eaf",
      content: ELAN_FIXTURE.replace('TIER_ID="Transcription"', 'TIER_ID="tx"'),
    });

    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toBeVisible({ timeout: 15_000 });
    await expectGridVisible(page);
    await expect(page.getByTitle("Play this segment")).toHaveCount(0);
    const eaf = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(eaf).toContain('TIER_ID="tx"');
    expect(eaf).toContain('TIER_ID="Transcription"');
  });

  test("cancelling the file dialog changes nothing", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Copy an existing ELAN file/i }).click();
    await (await chooser).setFiles([]);
    await expect(page.getByRole("button", { name: /Auto-segment/i })).toBeEnabled();
    await expect(fileTreeRow(page, SAMPLE_EAF_NAME)).toHaveCount(0);
  });

  test("Careful Speech starts with an empty eaf and opens the Careful Speech recorder", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Use Careful Speech Tool/i }).click();

    await expect(tabChip(page, "careful-speech")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Speak" })).toBeVisible();
    await waitForFiles(page, (files) => files.includes(COMBINED_WAV_NAME), 15_000);
    expect(await idbFileExists(page, SAMPLE_EAF_NAME)).toBe(true);
    const eaf = await readIdbFileText(page, SAMPLE_EAF_NAME);
    expect(eaf).not.toContain("<ALIGNABLE_ANNOTATION");
  });
});
