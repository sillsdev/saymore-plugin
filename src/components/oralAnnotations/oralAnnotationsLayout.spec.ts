import { describe, it, expect } from "vitest";
import { downsampleChannels, splitOralAnnotationsChannels } from "./oralAnnotationsLayout";

describe("splitOralAnnotationsChannels", () => {
  it("splits source (N channels) / careful / translation per generateOralAnnotationsWav's layout", () => {
    const src0 = new Float32Array([1]);
    const src1 = new Float32Array([2]);
    const careful = new Float32Array([3]);
    const translation = new Float32Array([4]);
    const groups = splitOralAnnotationsChannels([src0, src1, careful, translation], 2);
    expect(groups.source).toEqual([src0, src1]);
    expect(groups.careful).toBe(careful);
    expect(groups.translation).toBe(translation);
  });

  it("handles mono source", () => {
    const src = new Float32Array([1]);
    const careful = new Float32Array([2]);
    const translation = new Float32Array([3]);
    const groups = splitOralAnnotationsChannels([src, careful, translation], 1);
    expect(groups.source).toEqual([src]);
    expect(groups.careful).toBe(careful);
    expect(groups.translation).toBe(translation);
  });

  it("defaults careful/translation to empty channels when absent", () => {
    const src = new Float32Array([1]);
    expect(splitOralAnnotationsChannels([src], 1).careful).toEqual(new Float32Array(0));
    expect(splitOralAnnotationsChannels([src], 1).translation).toEqual(new Float32Array(0));
  });
});

describe("downsampleChannels", () => {
  it("mono-mixes multiple channels by min/max union per bucket", () => {
    const chA = Float32Array.from([-1, 0]);
    const chB = Float32Array.from([0, 1]);
    const points = downsampleChannels([chA, chB], 2, 20);
    expect(points).toEqual([
      { x: 0, yMin: 20, yMax: 10 }, // bucket 0: min(-1,0)=-1, max(-1,0)=0
      { x: 1, yMin: 10, yMax: 0 }, // bucket 1: min(0,1)=0, max(0,1)=1
    ]);
  });

  it("downsamples: one column per pixel regardless of sample count", () => {
    const ch = new Float32Array(1000);
    expect(downsampleChannels([ch], 10, 10)).toHaveLength(10);
  });

  it("returns nothing for no channels or a zero-size box", () => {
    expect(downsampleChannels([], 10, 10)).toEqual([]);
    expect(downsampleChannels([new Float32Array([0])], 0, 10)).toEqual([]);
    expect(downsampleChannels([new Float32Array([0])], 10, 0)).toEqual([]);
    expect(downsampleChannels([new Float32Array(0)], 10, 10)).toEqual([]);
  });
});
