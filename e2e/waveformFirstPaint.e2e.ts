import { test, expect, type Page } from "@playwright/test";
import { openRecorder, openSample } from "./helpers";

/**
 * The waveform's first paint must already be the final one: the precomputed,
 * normalized peaks at the zoom width. A render at another width, or a render of
 * wavesurfer's own decode of the media, shows up as a brief flash of a different
 * waveform. These tests record every distinct picture wavesurfer's canvases hold,
 * frame by frame, and require exactly one.
 *
 * The viewport is narrow so that the sample (≈9.8 s × 80 px/s ≈ 785 px) is wider
 * than the pane: the content then scrolls, and a fit-to-pane render would differ
 * from the zoom-width one.
 */

const NARROW_VIEWPORT = { width: 700, height: 800 };
const SETTLE_MS = 1500;

interface WaveProbe {
  /** Each distinct non-blank picture, in order: canvas sizes plus a pixel hash. */
  pictures: string[];
  /** URLs passed to window.fetch after the probe started. */
  fetches: string[];
}

/** Record every distinct picture of the waveform canvases, and every fetch. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: WaveProbe = { pictures: [], fetches: [] };
    (window as unknown as { __waveProbe: WaveProbe }).__waveProbe = probe;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      probe.fetches.push(input instanceof Request ? input.url : String(input));
      return originalFetch(input, init);
    };

    const hash = (s: string): number => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
      return h;
    };
    const isBlank = (c: HTMLCanvasElement): boolean => {
      const ctx = c.getContext("2d");
      if (!ctx || c.width === 0 || c.height === 0) return true;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
      return true;
    };
    let last = "";
    const tick = (): void => {
      const surface = document.querySelector('[data-testid="waveform-surface"]');
      const canvases = surface
        ? Array.from(surface.querySelectorAll("*")).flatMap((el) =>
            el.shadowRoot ? Array.from(el.shadowRoot.querySelectorAll("canvas")) : [],
          )
        : [];
      const drawn = canvases.filter((c) => !isBlank(c));
      if (drawn.length > 0) {
        const picture = drawn.map((c) => `${c.width}x${c.height}:${hash(c.toDataURL())}`).join("|");
        if (picture !== last) {
          last = picture;
          probe.pictures.push(picture);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readProbe(page: Page): Promise<WaveProbe> {
  return page.evaluate(() => (window as unknown as { __waveProbe: WaveProbe }).__waveProbe);
}

async function expectSinglePaintAndNoMediaFetch(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readProbe(page)).pictures.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(SETTLE_MS);
  const probe = await readProbe(page);
  expect(probe.pictures).toHaveLength(1);
  // The app reads media bytes through its file adapter, never with fetch; a
  // fetch of a blob: URL is wavesurfer loading the media in order to decode it.
  expect(probe.fetches.filter((u) => u.startsWith("blob:"))).toEqual([]);
}

test.describe("Waveform first paint", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(NARROW_VIEWPORT);
  });

  test("the segmenter paints its waveform once, without decoding the media", async ({ page }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Manually segment/i }).click();
    await expect(page.getByText(/Segments: 0/)).toBeVisible();

    await installProbe(page);
    await openSample(page, { sel: "eaf", view: "segmenter" });
    await expectSinglePaintAndNoMediaFetch(page);
  });

  test("the recorder's source row paints its waveform once, without decoding the media", async ({
    page,
  }) => {
    await openSample(page, { sel: "audio" });
    await page.getByRole("button", { name: /Auto-segment/i }).click();
    await expect(page.getByText("Free Translation")).toBeVisible({ timeout: 15_000 });

    await installProbe(page);
    await openSample(page, { sel: "eaf" });
    await expect(page.getByText("Free Translation")).toBeVisible();
    await openRecorder(page, "Careful Speech");
    await expectSinglePaintAndNoMediaFetch(page);
  });
});
