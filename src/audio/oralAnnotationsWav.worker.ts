import {
  generateOralAnnotationsWav,
  type OralAnnotationsWavRequest,
  type OralAnnotationsWavResponse,
} from "./oralAnnotationsWav";

/**
 * ES-module Web Worker wrapper around {@link generateOralAnnotationsWav}. Keeps
 * combined-file generation off the UI thread (mirrors `autoSegmenter.worker.ts`).
 *
 * In:  { source, segments, totalDurationSec }  (OralAnnotationsWavRequest)
 * Out: { type: "progress", fraction }          (0 before, 1 after — generation
 *      { type: "result", bytes }                itself has no natural midpoint)
 *
 * Built with `worker: { format: "es" }` (vite.config.ts). Instantiate with
 * `new Worker(new URL("./oralAnnotationsWav.worker.ts", import.meta.url), { type: "module" })`
 * — unlike the AudioWorklet case (see recorderWorklet.js), this IS a pattern
 * Vite's bundler recognizes and compiles into its own chunk.
 */

interface WorkerScope {
  postMessage(message: OralAnnotationsWavResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<OralAnnotationsWavRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;

function post(message: OralAnnotationsWavResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

ctx.onmessage = (event: MessageEvent<OralAnnotationsWavRequest>) => {
  const { source, segments, totalDurationSec } = event.data;
  post({ type: "progress", fraction: 0 });
  const bytes = generateOralAnnotationsWav(source, segments, totalDurationSec);
  post({ type: "result", bytes }, [bytes.buffer]);
};
