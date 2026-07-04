import {
  generateOralAnnotationsWav,
  type OralAnnotationsSource,
  type OralSegmentInput,
  type OralAnnotationsWavRequest,
  type OralAnnotationsWavResponse,
} from "./oralAnnotationsWav";

/**
 * Deep-plain copy so the request survives `postMessage`'s structured clone.
 * `source.channels`/clip `Uint8Array`s handed in may be MobX-observable
 * Proxies (store fields), and structured clone throws `DataCloneError` on
 * proxies — mirrors `autoSegmenterClient.ts`'s `toPlainEnvelope`.
 */
function toPlainRequest(
  source: OralAnnotationsSource,
  segments: OralSegmentInput[],
  totalDurationSec: number,
): OralAnnotationsWavRequest {
  return {
    source: {
      channels: source.channels.map((c) => Float32Array.from(c)),
      sampleRate: source.sampleRate,
    },
    segments: segments.map((s) => ({
      range: { start: s.range.start, end: s.range.end },
      ignored: s.ignored,
      careful: s.careful ? Uint8Array.from(s.careful) : undefined,
      translation: s.translation ? Uint8Array.from(s.translation) : undefined,
    })),
    totalDurationSec,
  };
}

/**
 * App-side driver for {@link generateOralAnnotationsWav}. Runs generation in
 * {@link "./oralAnnotationsWav.worker"} off the UI thread, forwarding progress
 * fractions (0 before, 1 after) if a callback is given.
 *
 * Falls back to running {@link generateOralAnnotationsWav} synchronously when
 * Web Workers aren't available (node/test environments, or a host that blocks
 * module workers) — same result, just on the calling thread.
 */
export function runGenerateOralAnnotationsWav(
  source: OralAnnotationsSource,
  segments: OralSegmentInput[],
  totalDurationSec: number,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (typeof Worker === "undefined") {
    onProgress?.(0);
    const bytes = generateOralAnnotationsWav(source, segments, totalDurationSec);
    onProgress?.(1);
    return Promise.resolve(bytes);
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("./oralAnnotationsWav.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // Worker construction can throw where module workers are unsupported.
    onProgress?.(0);
    const bytes = generateOralAnnotationsWav(source, segments, totalDurationSec);
    onProgress?.(1);
    return Promise.resolve(bytes);
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<OralAnnotationsWavResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.fraction);
      } else {
        worker.terminate();
        resolve(message.bytes);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Oral-annotations WAV worker failed."));
    };
    worker.postMessage(toPlainRequest(source, segments, totalDurationSec));
  });
}
