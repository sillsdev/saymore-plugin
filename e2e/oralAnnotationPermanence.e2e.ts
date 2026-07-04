import { test, expect, type Page } from "@playwright/test";
import { encodeWavPcm16Mono } from "../src/audio/wavWriter";
import { segmentWavName } from "../src/fs/OralAnnotationFiles";
import { makeTimeRange } from "../src/model/TimeRange";
import { listIdbFileNames, openSample, SAMPLE_MEDIA_NAME, writeIdbFileBytes } from "./helpers";

/**
 * Requested by the coordinator after the boundary-drag spec landed: drag the
 * boundary at 1.25s and confirm the csFloat rename parity holds for oral
 * annotations, including the SayMore "permanence" confirm (moving a boundary
 * that already has a Careful Speech / Oral Translation recording should warn,
 * then rename the WAV(s) to the new range — never silently orphan them).
 *
 * `test.fixme`-gated: verified empirically (ran this against the current
 * source with the assertions relaxed to just log) that TWO things don't
 * happen yet, reported to the coordinator for A/C to route:
 *
 *  1. No confirm is shown. `BoundaryLayer`'s pointer drag handlers
 *     (src/components/waveform/BoundaryLayer.tsx onBoundaryPointerUp) call
 *     `vm.moveSelectedBoundaryTo()` unconditionally — unlike the Delete-key
 *     path in ManualSegmenterView.onKeyDown, which does gate on
 *     `vm.requiresPermanenceConfirm()` + `window.confirm()`. Dragging an
 *     "immovable" (oral-annotated) boundary isn't blocked or confirmed at all.
 *  2. The rename never reaches disk. `SegmenterViewModel`'s oral-file journal
 *     (the rename/delete FileOps computed per edit) is only flushed by
 *     `save()` (src/state/SegmenterViewModel.ts) — and nothing in the running
 *     app calls `save()` today (only its own unit spec does; the debounced
 *     `scheduleAutoSave()` only rewrites the eaf XML). So even a confirmed
 *     move wouldn't rename the WAVs on disk yet — this is the same
 *     "merge step not landed" family of gap gating recorder.e2e.ts.
 *
 * Flip to `test` once both land.
 */

const FAKE_WAV = encodeWavPcm16Mono(new Float32Array(80), 8000);

async function seedOralWav(page: Page, start: number, end: number): Promise<string> {
  const name = segmentWavName(SAMPLE_MEDIA_NAME, makeTimeRange(start, end), "Careful");
  await writeIdbFileBytes(page, name, FAKE_WAV);
  return name;
}

test.describe("Boundary drag vs. oral-annotation permanence (csFloat rename parity)", () => {
  test.fixme("dragging an oral-annotated boundary prompts permanence-confirm and renames its WAV", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });

    // Pre-seed oral-annotation WAVs as if a prior session had already
    // recorded Careful Speech for [0.75, 1.25] and [1.25, 2] — the boundary
    // at 1.25s is therefore "immovable" (SayMore draws it blue) and
    // dragging it must rename both files to the new csFloat range, not
    // orphan them.
    const leftWav = await seedOralWav(page, 0.75, 1.25);
    const rightWav = await seedOralWav(page, 1.25, 2);

    await page.getByRole("button", { name: /Use manual segmentation tool/i }).click();
    await expect(page.getByText(/Transcription/)).toBeVisible();
    await page.getByRole("button", { name: /Segment…/ }).click();
    await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();

    // Exact boundary placement via the dev debug hook (`window.__seg`,
    // exposed by ManualSegmenterView in DEV builds "so the segmenter can be
    // driven from the console / an automated smoke test") — real playback
    // timing can't reliably hit 0.75/1.25/2 to the precision csFloat
    // filenames need.
    await page.evaluate(() => {
      const vm = (window as unknown as { __seg: SegmenterHandle }).__seg;
      vm.setCursor(0.75);
      vm.addBoundaryAtCursor();
      vm.setCursor(1.25);
      vm.addBoundaryAtCursor();
      vm.setCursor(2);
      vm.addBoundaryAtCursor();
    });
    await expect(page.getByText(/Segments: 3/)).toBeVisible();
    await page.waitForTimeout(700); // let the debounced eaf auto-save flush before reload

    // The oralIndex was built when the eaf was first created, before these
    // WAVs existed — reload so ProjectStore rescans the adapter and picks
    // them up (mirrors re-opening a session that already has recordings).
    // The harness reactively syncs its URL to annotationsView, so the
    // reload restores straight back into the segmenter.
    await page.reload();
    await expect(page.getByRole("button", { name: /Back to transcriptions/i })).toBeVisible();

    const boundaryAt125 = page.locator('[data-testid="boundary-1"]'); // ends segment [0.75, 1.25]
    await expect(boundaryAt125).toHaveAttribute("data-boundary-sec", "1.25");

    let dialogSeen = false;
    page.on("dialog", (d) => {
      dialogSeen = true;
      void d.accept();
    });

    const box = await boundaryAt125.boundingBox();
    if (!box) throw new Error("boundary-1 has no bounding box");
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 60, y, { steps: 8 });
    await page.mouse.up();

    expect(dialogSeen).toBe(true);

    const newSec = Number(await boundaryAt125.getAttribute("data-boundary-sec"));
    expect(newSec).not.toBeCloseTo(1.25, 2);

    await page.waitForTimeout(700); // let any auto-save / journal flush settle
    const files = await listIdbFileNames(page);
    expect(files).not.toContain(leftWav);
    expect(files).not.toContain(rightWav);
  });
});

/** The subset of SegmenterViewModel this spec drives directly for exact positioning. */
interface SegmenterHandle {
  setCursor(seconds: number): void;
  addBoundaryAtCursor(): unknown;
}
