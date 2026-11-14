import { describe, expect, it } from "vitest";
import {
  cancelSegmenterRequest,
  requestSegmenterOn,
  takeSegmenterRequest,
} from "./segmenterHandoff";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe("segmenter handoff", () => {
  it("is taken once for the requested eaf", () => {
    const s = memoryStorage();
    requestSegmenterOn("a.wav.annotations.eaf", s);
    expect(takeSegmenterRequest("a.wav.annotations.eaf", s)).toBe(true);
    expect(takeSegmenterRequest("a.wav.annotations.eaf", s)).toBe(false);
  });

  it("is not taken for another eaf, and is spent by trying", () => {
    const s = memoryStorage();
    requestSegmenterOn("a.wav.annotations.eaf", s);
    expect(takeSegmenterRequest("b.wav.annotations.eaf", s)).toBe(false);
    expect(takeSegmenterRequest("a.wav.annotations.eaf", s)).toBe(false);
  });

  it("can be cancelled", () => {
    const s = memoryStorage();
    requestSegmenterOn("a.wav.annotations.eaf", s);
    cancelSegmenterRequest(s);
    expect(takeSegmenterRequest("a.wav.annotations.eaf", s)).toBe(false);
  });

  it("does nothing without storage", () => {
    requestSegmenterOn("a", undefined);
    expect(takeSegmenterRequest("a", undefined)).toBe(false);
  });
});
