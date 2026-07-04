import { autoSegmentEnvelope, type AutoSegmenterSettings } from "./autoSegmenter";
import type { AutoSegmenterRequest, AutoSegmenterResponse } from "./autoSegmenter";
import { getSilenceBreaks } from "./silenceSegmenter";
import type { Envelope } from "./EnvelopeCache";

/**
 * The auto-segment button's segmenter: the silence/VAD segmenter
 * ({@link getSilenceBreaks}), which breaks on natural pauses regardless of clip
 * length (unlike the length-gated C# port). It's O(n) over the 1-per-ms envelope
 * — fast enough to run on the calling thread, and it reads the envelope in place
 * so there's no `postMessage` clone of the (possibly observable) envelope.
 * `_settings` is accepted for the shared runner signature but unused.
 */
export function runSilenceSegmenter(
  envelope: Envelope,
  _settings: AutoSegmenterSettings,
  onProgress?: (fraction: number) => void,
): Promise<number[]> {
  return Promise.resolve(getSilenceBreaks(envelope, undefined, onProgress));
}

/**
 * Deep-plain copy of an envelope so it survives `postMessage`'s structured
 * clone. The envelope handed in may be a MobX-observable Proxy (it's a store
 * field), and structured clone throws `DataCloneError` on proxies. Rebuilding
 * with fresh Float32Arrays + plain objects strips the proxy wrappers.
 */
function toPlainEnvelope(envelope: Envelope): Envelope {
  return {
    channels: envelope.channels.map((c) => ({
      min: Float32Array.from(c.min),
      max: Float32Array.from(c.max),
    })),
    samplesPerMs: envelope.samplesPerMs,
    sampleRate: envelope.sampleRate,
    durationSec: envelope.durationSec,
  };
}

/**
 * App-side driver for the auto-segmenter. Runs the (potentially long)
 * natural-breaks search in {@link autoSegmenter.worker} off the UI thread and
 * resolves with the boundary seconds, forwarding progress fractions (0→1) as
 * they arrive.
 *
 * Falls back to running the pure port {@link autoSegmentEnvelope} synchronously
 * when Web Workers aren't available (node/test environments, or a host that
 * blocks module workers) — same result, just on the calling thread.
 */
export function runAutoSegmenter(
  envelope: Envelope,
  settings: AutoSegmenterSettings,
  onProgress?: (fraction: number) => void,
): Promise<number[]> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(autoSegmentEnvelope(envelope, settings, onProgress));
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("./autoSegmenter.worker.ts", import.meta.url), { type: "module" });
  } catch {
    // Worker construction can throw where module workers are unsupported.
    return Promise.resolve(autoSegmentEnvelope(envelope, settings, onProgress));
  }

  return new Promise<number[]>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<AutoSegmenterResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.fraction);
      } else {
        worker.terminate();
        resolve(message.boundaries);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Auto-segmenter worker failed."));
    };
    const request: AutoSegmenterRequest = { envelope: toPlainEnvelope(envelope), settings };
    worker.postMessage(request);
  });
}
