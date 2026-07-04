/**
 * AudioWorkletProcessor for MicRecorder.ts: forwards each render quantum's
 * channel-0 Float32 frame plus its max-abs peak to the main thread. Runs on
 * the audio rendering thread — no buffering/recording policy here, that lives
 * in MicRecorder (main thread) per the plan's "thin capture" split.
 *
 * DELIBERATELY PLAIN JAVASCRIPT, NOT TYPESCRIPT, AND SELF-CONTAINED (NO IMPORTS):
 * `audioContext.audioWorklet.addModule(url)` is not a pattern Vite's bundler
 * recognizes (unlike `new Worker(new URL(...))`, which gets its own compiled
 * chunk) — `new URL("./recorderWorklet", import.meta.url)` is treated as a
 * generic static-asset reference, so the referenced file is embedded/copied
 * VERBATIM, unprocessed: no TS-to-JS transpilation and no bundling of its own
 * imports. A `.ts` extension here would additionally get MIME-sniffed as
 * `video/mp2t` (the registered MIME type for `.ts`, predating TypeScript) when
 * inlined as a data: URL, which browsers reject for module scripts. Verified
 * against a real `vp build` output — do not "fix" this by converting back to
 * `.ts` or adding an import.
 *
 * The registered processor name (`RECORDER_WORKLET_NAME` in
 * `recorderWorkletName.ts`) is duplicated here as a literal for the same
 * self-containment reason; keep the two in sync.
 */

class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel0 = inputs[0] && inputs[0][0];
    if (channel0 && channel0.length > 0) {
      let peak = 0;
      for (let i = 0; i < channel0.length; i++) {
        const abs = Math.abs(channel0[i]);
        if (abs > peak) peak = abs;
      }
      // Copy: the engine reuses/recycles the input buffer after process() returns.
      const samples = channel0.slice();
      this.port.postMessage({ samples, peak }, [samples.buffer]);
    }
    // Keep the node alive for the lifetime of the hot mic.
    return true;
  }
}

// Keep in sync with RECORDER_WORKLET_NAME in ./recorderWorkletName.ts.
registerProcessor("recorder-worklet", RecorderProcessor);
