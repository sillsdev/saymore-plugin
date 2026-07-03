import {
  autoSegmentEnvelope,
  type AutoSegmenterRequest,
  type AutoSegmenterResponse
} from "./autoSegmenter";

/**
 * ES-module Web Worker wrapper around the pure auto-segmenter port. Keeps the
 * (potentially long) natural-breaks search off the UI thread.
 *
 * In:  { envelope, settings }              (AutoSegmenterRequest)
 * Out: { type: "progress", fraction }      (0→1 as breaks are found)
 *      { type: "result", boundaries }      (boundary seconds; terminal message)
 *
 * Built with `worker: { format: "es" }` (vite.config.ts). Instantiate with
 * `new Worker(new URL("./autoSegmenter.worker.ts", import.meta.url), { type: "module" })`.
 */

// Type the worker global structurally rather than via `DedicatedWorkerGlobalScope`
// so this file compiles under the shared tsconfig's lib set (DOM, no WebWorker lib).
interface WorkerScope {
  postMessage(message: AutoSegmenterResponse): void;
  onmessage: ((event: MessageEvent<AutoSegmenterRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;

function post(message: AutoSegmenterResponse): void {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent<AutoSegmenterRequest>) => {
  const { envelope, settings } = event.data;
  const boundaries = autoSegmentEnvelope(envelope, settings, (fraction) => {
    post({ type: "progress", fraction });
  });
  post({ type: "result", boundaries });
};
