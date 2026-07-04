/**
 * The `AudioWorkletProcessor` name that `MicRecorder.ts` uses to construct its
 * `AudioWorkletNode`. `recorderWorklet.js` (which calls `registerProcessor`
 * with the matching literal) can't import this constant — it must stay a
 * self-contained plain-JS file with no imports (see its own top comment for
 * why) — so keep the two string literals in sync by hand.
 */
export const RECORDER_WORKLET_NAME = "recorder-worklet";
