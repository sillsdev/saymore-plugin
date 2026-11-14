// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { makeTimeRange } from "../model/TimeRange";
import { MediaElementPlaybackEngine } from "./PlaybackEngine";

function fakeMediaElement(): HTMLMediaElement {
  return {
    currentTime: 0,
    playbackRate: 1,
    ended: false,
    play: () => Promise.resolve(),
    pause: () => {},
    removeAttribute: () => {},
  } as unknown as HTMLMediaElement;
}

function countingElement(): HTMLMediaElement & { plays: number; pauses: number } {
  const el = {
    currentTime: 0,
    playbackRate: 1,
    ended: false,
    plays: 0,
    pauses: 0,
    play() {
      el.plays++;
      return Promise.resolve();
    },
    pause() {
      el.pauses++;
    },
    removeAttribute: () => {},
  };
  return el as unknown as HTMLMediaElement & { plays: number; pauses: number };
}

const frame = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

describe("MediaElementPlaybackEngine pause and resume", () => {
  it("pause holds the range pending and resume continues it with the loops that remain", async () => {
    const el = countingElement();
    const engine = new MediaElementPlaybackEngine(el);
    try {
      let done = false;
      void engine.play(makeTimeRange(0, 1), { maxLoops: 2 }).then(() => (done = true));
      expect(engine.isPlaying).toBe(true);

      el.currentTime = 0.5;
      engine.pause();
      expect(engine.isPlaying).toBe(false);
      expect(engine.isPaused).toBe(true);
      expect(el.pauses).toBeGreaterThan(0);

      // A paused range ignores the range end and keeps its place.
      el.currentTime = 1;
      await frame();
      expect(done).toBe(false);
      expect(engine.isPlaying).toBe(false);

      const playsBefore = el.plays;
      engine.resume();
      expect(engine.isPlaying).toBe(true);
      expect(engine.isPaused).toBe(false);
      expect(el.plays).toBe(playsBefore + 1);

      // End of the first loop: the second one starts from the range start.
      await frame();
      expect(done).toBe(false);
      expect(el.currentTime).toBe(0);
      expect(engine.isPlaying).toBe(true);

      el.currentTime = 1;
      await frame();
      expect(done).toBe(true);
      expect(engine.isPlaying).toBe(false);
    } finally {
      engine.dispose();
    }
  });

  it("pause and resume do nothing when there is nothing to pause or resume", () => {
    const el = countingElement();
    const engine = new MediaElementPlaybackEngine(el);
    try {
      engine.pause();
      engine.resume();
      expect(engine.isPaused).toBe(false);
      expect(el.plays).toBe(0);
    } finally {
      engine.dispose();
    }
  });

  it("stop ends a paused range and clears the paused state", async () => {
    const engine = new MediaElementPlaybackEngine(countingElement());
    try {
      const playing = engine.play(makeTimeRange(0, 1));
      engine.pause();
      engine.stop();
      await playing;
      expect(engine.isPaused).toBe(false);
      engine.resume();
      expect(engine.isPlaying).toBe(false);
    } finally {
      engine.dispose();
    }
  });

  it("a new play() replaces a paused range", async () => {
    const el = countingElement();
    const engine = new MediaElementPlaybackEngine(el);
    try {
      const first = engine.play(makeTimeRange(0, 1));
      engine.pause();
      void engine.play(makeTimeRange(2, 3));
      await first;
      expect(engine.isPaused).toBe(false);
      expect(engine.isPlaying).toBe(true);
    } finally {
      engine.dispose();
    }
  });
});

describe("MediaElementPlaybackEngine.playSequence", () => {
  it("a newer play() ends a running sequence before its next clip starts", async () => {
    const engine = new MediaElementPlaybackEngine(fakeMediaElement());
    try {
      const range = makeTimeRange(0, 1);
      const sequence = engine.playSequence([
        { range, url: "blob:first" },
        { range, url: "blob:second" },
      ]);
      void engine.play(range);
      await sequence;
      const clips = (engine as unknown as { extraEls: Map<string, unknown> }).extraEls;
      expect([...clips.keys()]).toEqual(["blob:first"]);
    } finally {
      engine.dispose();
    }
  });
});
