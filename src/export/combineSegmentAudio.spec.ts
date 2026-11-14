import { describe, expect, it } from "vitest";
import { decodeWav } from "../audio/wavCodec";
import { encodeWavPcm16Mono } from "../audio/wavWriter";
import {
  concatenateWavs,
  leadingNumber,
  MixedWavFormatError,
  NotWavError,
  sortSegmentWavNames,
} from "./combineSegmentAudio";

const clip = (name: string, samples: number[], rate = 8000) => ({
  name,
  bytes: encodeWavPcm16Mono(new Float32Array(samples), rate),
});

describe("sortSegmentWavNames", () => {
  it("orders by the number each name starts with, numerically", () => {
    const names = [
      "X.wav_Annotations/10.5_to_12_Careful.wav",
      "X.wav_Annotations/2_to_3_Careful.wav",
      "X.wav_Annotations/0.75_to_1.25_Careful.wav",
    ];
    expect(sortSegmentWavNames(names)).toEqual([names[2], names[1], names[0]]);
  });

  it("drops names that do not start with a number", () => {
    expect(sortSegmentWavNames(["a_Careful.wav", "1_to_2_Careful.wav"])).toEqual([
      "1_to_2_Careful.wav",
    ]);
  });

  it("reads the number from the file name, not the folder", () => {
    expect(leadingNumber("9.wav_Annotations/0.5_to_1_Careful.wav")).toBe(0.5);
  });
});

describe("concatenateWavs", () => {
  it("joins the clips back to back with no gap", () => {
    const out = concatenateWavs([clip("a", [0.5, 0.25]), clip("b", [-0.5])]);
    const decoded = decodeWav(out);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.channels).toHaveLength(1);
    expect(Array.from(decoded.channels[0])).toEqual([0.5, 0.25, -0.5]);
  });

  it("keeps the order it is given", () => {
    const out = concatenateWavs([clip("b", [-0.5]), clip("a", [0.5])]);
    expect(Array.from(decodeWav(out).channels[0])).toEqual([-0.5, 0.5]);
  });

  it("refuses clips with different sample rates", () => {
    expect(() => concatenateWavs([clip("a", [0.5], 8000), clip("b", [0.5], 16000)])).toThrow(
      MixedWavFormatError,
    );
  });

  it("refuses a clip that is not a WAV file", () => {
    expect(() =>
      concatenateWavs([clip("a", [0.5]), { name: "b", bytes: new Uint8Array(20) }]),
    ).toThrow(NotWavError);
  });

  it("refuses an empty list", () => {
    expect(() => concatenateWavs([])).toThrow();
  });
});
