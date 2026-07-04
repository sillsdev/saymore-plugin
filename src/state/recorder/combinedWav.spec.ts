import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../fs/InMemoryAdapter";
import { encodeWavPcm16Mono } from "../../audio/wavWriter";
import { regenerateCombinedOralWav, combinedOralWavName } from "./combinedWav";
import type { OralAnnotationsSource } from "../../audio/oralAnnotationsWav";

const MEDIA = "longerSound.wav";
const COMBINED = combinedOralWavName(MEDIA); // "longerSound.wav.oralAnnotations.wav"

/** A trivial 8kHz mono source so the real generator has channels to interleave. */
function fakeSource(): OralAnnotationsSource {
  return { channels: [new Float32Array(8000 * 3)], sampleRate: 8000 };
}

describe("regenerateCombinedOralWav", () => {
  it("writes <media>.oralAnnotations.wav when a clip exists (real generator)", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed(MEDIA, new Uint8Array([1, 2, 3]));
    const carefulClip = encodeWavPcm16Mono(new Float32Array(8000).fill(0.25), 8000);

    const outcome = await regenerateCombinedOralWav({
      adapter,
      mediaFileName: MEDIA,
      totalDurationSec: 3,
      segments: [
        { range: { start: 0, end: 1 }, ignored: false, careful: carefulClip },
        { range: { start: 1, end: 2 }, ignored: true },
      ],
      decodeMedia: async () => fakeSource(),
    });

    expect(outcome).toBe("written");
    expect(await adapter.exists(COMBINED)).toBe(true);
    const bytes = await adapter.readBytes(COMBINED);
    expect(bytes.length).toBeGreaterThan(44); // real WAV header + data
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  });

  it("skips (no write, no decode) when no segment carries a clip — CanGenerate parity", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed(MEDIA, new Uint8Array([1]));
    let decoded = false;

    const outcome = await regenerateCombinedOralWav({
      adapter,
      mediaFileName: MEDIA,
      totalDurationSec: 3,
      segments: [
        { range: { start: 0, end: 1 }, ignored: false },
        { range: { start: 1, end: 2 }, ignored: true },
      ],
      decodeMedia: async () => {
        decoded = true;
        return fakeSource();
      },
    });

    expect(outcome).toBe("skipped-no-annotations");
    expect(decoded).toBe(false);
    expect(await adapter.exists(COMBINED)).toBe(false);
  });

  it("skips when the media can't be decoded", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed(MEDIA, new Uint8Array([1]));

    const outcome = await regenerateCombinedOralWav({
      adapter,
      mediaFileName: MEDIA,
      totalDurationSec: 3,
      segments: [{ range: { start: 0, end: 1 }, ignored: false, translation: new Uint8Array([9]) }],
      decodeMedia: async () => undefined,
    });

    expect(outcome).toBe("skipped-no-source");
    expect(await adapter.exists(COMBINED)).toBe(false);
  });

  it("uses the injected generator and writes its bytes to the right name", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seed(MEDIA, new Uint8Array([1]));

    const outcome = await regenerateCombinedOralWav({
      adapter,
      mediaFileName: MEDIA,
      totalDurationSec: 3,
      segments: [{ range: { start: 0, end: 1 }, ignored: false, careful: new Uint8Array([7]) }],
      decodeMedia: async () => fakeSource(),
      generate: async () => new Uint8Array([42, 43]),
    });

    expect(outcome).toBe("written");
    expect(await adapter.readBytes(COMBINED)).toEqual(new Uint8Array([42, 43]));
  });
});
