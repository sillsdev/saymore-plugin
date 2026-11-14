// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { Envelope } from "../../audio/EnvelopeCache";
import { envelopeToPeaks } from "../../audio/envelope";

interface CreateCall {
  options: Record<string, unknown>;
  /** The content box's CSS width at the moment wavesurfer was created. */
  contentWidthAtCreate: string;
}

const { createCalls } = vi.hoisted(() => ({ createCalls: [] as CreateCall[] }));

vi.mock("wavesurfer.js", () => ({
  default: {
    create: (options: Record<string, unknown>) => {
      const container = options.container as HTMLElement;
      createCalls.push({
        options,
        contentWidthAtCreate: getComputedStyle(container.parentElement!).width,
      });
      return { on: vi.fn(), unAll: vi.fn(), destroy: vi.fn() };
    },
  },
}));

import { WaveformSurface } from "./WaveformSurface";

const DURATION_SEC = 10;
const PX_PER_SEC = 80;

/** A quiet envelope, so normalization scales its peaks up. */
function quietEnvelope(): Envelope {
  const n = DURATION_SEC * 1000;
  const max = new Float32Array(n);
  const min = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    max[i] = 0.05 * Math.abs(Math.sin(i / 50));
    min[i] = -max[i];
  }
  return { channels: [{ max, min }], samplesPerMs: 1, sampleRate: 1000, durationSec: DURATION_SEC };
}

describe("WaveformSurface", () => {
  let mediaElement: HTMLAudioElement;

  beforeEach(() => {
    createCalls.length = 0;
    mediaElement = document.createElement("audio");
    mediaElement.src = "blob:media";
  });
  afterEach(() => cleanup());

  it("does not create wavesurfer before the envelope exists, and shows the loading note", () => {
    render(
      <WaveformSurface
        durationSec={DURATION_SEC}
        mediaElement={mediaElement}
        mediaUrl="blob:media"
        minPxPerSec={PX_PER_SEC}
        loading
      />,
    );
    expect(createCalls).toHaveLength(0);
    expect(screen.getByText(/Preparing waveform/)).toBeTruthy();
  });

  it("creates wavesurfer once, from the normalized peaks and the explicit duration", () => {
    const envelope = quietEnvelope();
    render(
      <WaveformSurface
        envelope={envelope}
        durationSec={DURATION_SEC}
        mediaElement={mediaElement}
        mediaUrl="blob:media"
        minPxPerSec={PX_PER_SEC}
      />,
    );
    // StrictMode is not in play here, so exactly one instance.
    expect(createCalls).toHaveLength(1);
    const { options } = createCalls[0];
    expect(options.peaks).toEqual(envelopeToPeaks(envelope));
    expect(options.duration).toBe(DURATION_SEC);
    expect(options.media).toBe(mediaElement);
    expect(options.url).toBeUndefined();
  });

  it("sizes the content box to the zoom width before wavesurfer measures it", () => {
    render(
      <WaveformSurface
        envelope={quietEnvelope()}
        durationSec={DURATION_SEC}
        mediaElement={mediaElement}
        minPxPerSec={PX_PER_SEC}
      />,
    );
    expect(createCalls[0].contentWidthAtCreate).toBe(`${DURATION_SEC * PX_PER_SEC}px`);
  });

  it("creates wavesurfer with peaks when the envelope arrives after mounting", () => {
    const { rerender } = render(
      <WaveformSurface
        durationSec={DURATION_SEC}
        mediaElement={mediaElement}
        minPxPerSec={PX_PER_SEC}
      />,
    );
    expect(createCalls).toHaveLength(0);
    const envelope = quietEnvelope();
    rerender(
      <WaveformSurface
        envelope={envelope}
        durationSec={DURATION_SEC}
        mediaElement={mediaElement}
        minPxPerSec={PX_PER_SEC}
      />,
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].options.peaks).toEqual(envelopeToPeaks(envelope));
  });

  it("passes peaks and the duration when only a media URL is given", () => {
    render(
      <WaveformSurface
        envelope={quietEnvelope()}
        durationSec={DURATION_SEC}
        mediaUrl="blob:media"
      />,
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].options.peaks).toBeDefined();
    expect(createCalls[0].options.duration).toBe(DURATION_SEC);
  });
});
