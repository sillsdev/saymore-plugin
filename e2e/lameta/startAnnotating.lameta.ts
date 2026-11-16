import { existsSync, readFileSync } from "node:fs";
import { test, expect, readText, type Lameta } from "./lametaFixture";

// The "Start Annotating" tab that the plugin gives an audio file with no .annotations.eaf.

test("an mp3 offers conversion, and converting selects the standard WAV on its Start Annotating tab", async ({
  lameta,
}) => {
  await lameta.selectFile("Start", "speech.mp3");
  await lameta.tab("Start Annotating").click();

  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: "Convert" }));
  await frame.getByRole("button", { name: "Convert" }).click();

  const wav = lameta.sessionFile("Start", "speech_StandardAudio.wav");
  await expect.poll(() => existsSync(wav), { timeout: 30_000 }).toBe(true);
  await lameta.expectSelected("speech_StandardAudio.wav");
  await lameta.expectInPlugin(
    lameta.pluginFrame().getByRole("button", { name: "Manually segment" }),
  );
  expect(existsSync(lameta.sessionFile("Start", "speech.mp3"))).toBe(true);
});

test("a WAV shows SayMore's five ways to start, in SayMore's order", async ({ lameta }) => {
  await lameta.selectFile("Start", "speech.wav");
  await lameta.tab("Start Annotating").click();

  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: "Manually segment" }));
  const names = await frame
    .getByRole("button", { name: /segment|Careful|ELAN|Audacity/i })
    .allInnerTexts();
  expect(names.map((n) => n.trim())).toEqual([
    "Manually segment",
    "Use Careful Speech Tool",
    "Copy an existing ELAN file",
    "Import an Audacity Label file",
    "Auto-segment",
  ]);
});

test("Manually segment creates the eaf, lameta selects it, and the segmenter opens", async ({
  lameta,
}) => {
  await lameta.selectFile("Start", "speech.wav");
  await lameta.tab("Start Annotating").click();
  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: "Manually segment" }));
  await frame.getByRole("button", { name: "Manually segment" }).click();

  const eaf = lameta.sessionFile("Start", "speech.wav.annotations.eaf");
  await expect.poll(() => existsSync(eaf)).toBe(true);
  await lameta.expectSelected("speech.wav.annotations.eaf");
  await lameta.expectInPlugin(lameta.pluginFrame().getByText(/Segments: 0/));

  // With an eaf, SayMore annotates through the eaf, so the WAV loses its Start Annotating tab.
  await lameta.fileRow("speech.wav").click();
  await expect(lameta.tab("Start Annotating")).toHaveCount(0);
});

/** Open the Start Annotating tab of the fixture's speech.wav and wait for its buttons. */
async function openStartOnWav(lameta: Lameta) {
  await lameta.selectFile("Start", "speech.wav");
  await lameta.tab("Start Annotating").click();
  const frame = lameta.pluginFrame();
  await lameta.expectInPlugin(frame.getByRole("button", { name: "Auto-segment" }));
  return frame;
}

const EAF = "speech.wav.annotations.eaf";

test("Auto-segment writes a segmented eaf, and lameta selects it on its grid", async ({
  lameta,
}) => {
  const frame = await openStartOnWav(lameta);
  await frame.getByRole("button", { name: "Auto-segment" }).click();

  await expect
    .poll(() => existsSync(lameta.sessionFile("Start", EAF)), { timeout: 30_000 })
    .toBe(true);
  await lameta.expectSelected(EAF);
  const grid = lameta.pluginFrame();
  await lameta.expectInPlugin(grid.getByTestId("grid-row-0"));
  // The fixture's audio is three bursts of tone with pauses between them.
  expect(await grid.locator('[data-testid^="grid-row-"]').count()).toBeGreaterThanOrEqual(2);
  expect(readText(lameta.sessionFile("Start", EAF))).toContain("<ALIGNABLE_ANNOTATION");
});

test("Copy an existing ELAN file makes the eaf from it, and lameta selects it on its grid", async ({
  lameta,
}) => {
  const frame = await openStartOnWav(lameta);
  await frame.getByTestId("start-elan-file").setInputFiles({
    name: "story.eaf",
    mimeType: "text/plain",
    buffer: readFileSync(lameta.sessionFile("Annotated", "story.wav.annotations.eaf")),
  });

  await expect.poll(() => existsSync(lameta.sessionFile("Start", EAF))).toBe(true);
  await lameta.expectSelected(EAF);
  const grid = lameta.pluginFrame();
  await lameta.expectInPlugin(grid.getByTestId("grid-row-1"));
  await expect(grid.locator('[data-testid^="grid-row-"]')).toHaveCount(2);
  const eaf = readText(lameta.sessionFile("Start", EAF));
  expect(eaf).toContain('MEDIA_URL="speech.wav"');
  expect(eaf).toContain("<ANNOTATION_VALUE>second translation</ANNOTATION_VALUE>");
});

test("Import an Audacity Label file makes segments with its text, and lameta selects the eaf", async ({
  lameta,
}) => {
  const frame = await openStartOnWav(lameta);
  await frame.getByTestId("start-audacity-file").setInputFiles({
    name: "labels.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("0.000000\t1.000000\tfirst\n1.000000\t2.400000\tsecond\n"),
  });

  await expect.poll(() => existsSync(lameta.sessionFile("Start", EAF))).toBe(true);
  await lameta.expectSelected(EAF);
  await lameta.expectInPlugin(lameta.pluginFrame().getByTestId("grid-row-1"));
  const eaf = readText(lameta.sessionFile("Start", EAF));
  expect(eaf).toContain("<ANNOTATION_VALUE>first</ANNOTATION_VALUE>");
  expect(eaf).toContain("<ANNOTATION_VALUE>second</ANNOTATION_VALUE>");
  expect(eaf).toContain('TIME_VALUE="2400"');
});
