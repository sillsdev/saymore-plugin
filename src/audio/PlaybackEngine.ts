import { makeAutoObservable } from "mobx";
import type { TimeRange } from "../model/TimeRange";

/**
 * Playback abstraction over HTMLMediaElement(s) (plan decision: no full-buffer
 * Web Audio decode of the source media). Sub-range playback stops via rAF
 * monitoring (~5–20ms slop, accepted). Careful/translation per-segment WAVs are
 * small object-URL Audio elements sequenced by `playSequence` for the grid's
 * "Both" column option.
 *
 * CONTRACT ONLY: the F2 track supplies the real media-element implementation.
 * `SpyPlaybackEngine` below is the test/dev double every other track uses.
 */
export interface PlayOptions {
  /** Playback rate 0.1–1.0 (native HTMLMediaElement.playbackRate; pitch preserved). */
  rate?: number;
  /** Loop the range up to this many times (grid autoplay uses ≤5). */
  maxLoops?: number;
}

/** A range to play, optionally from a different media source than the main media. */
export interface PlaySource {
  range: TimeRange;
  /** Object URL of a distinct clip (careful/translation WAV); omit for main media. */
  url?: string;
}

export interface PlaybackEngine {
  readonly isPlaying: boolean;
  /** True between {@link pause} and {@link resume}; the paused range or sequence stays pending. */
  readonly isPaused: boolean;
  /** Current playhead position in seconds, in the clip that is playing. */
  readonly positionSec: number;
  /** The URL of the oral recording that is playing, or undefined while the main media plays. */
  readonly clipUrl: string | undefined;

  /** Play a sub-range of the main media (or the whole thing if omitted). */
  play(range?: TimeRange, opts?: PlayOptions): Promise<void>;

  /** Play several clips back-to-back (the grid "Both" playback option). */
  playSequence(sources: PlaySource[], opts?: PlayOptions): Promise<void>;

  stop(): void;

  /** Hold the current range or sequence at its position; no-op unless playing. */
  pause(): void;

  /** Continue a paused range or sequence from where it paused; no-op unless paused. */
  resume(): void;

  setPlaybackRate(rate: number): void;

  dispose(): void;
}

/** Recorded call for assertions in specs. */
export interface PlaybackCall {
  kind: "play" | "playSequence" | "stop" | "pause" | "resume" | "setPlaybackRate";
  range?: TimeRange;
  sources?: PlaySource[];
  opts?: PlayOptions;
  rate?: number;
}

/**
 * Non-audio test double. Records calls and lets a test flip `isPlaying` /
 * `positionSec`; never touches the DOM, so it works in the node vitest env.
 */
export class SpyPlaybackEngine implements PlaybackEngine {
  isPlaying = false;
  isPaused = false;
  positionSec = 0;
  clipUrl: string | undefined = undefined;
  readonly calls: PlaybackCall[] = [];

  async play(range?: TimeRange, opts?: PlayOptions): Promise<void> {
    this.calls.push({ kind: "play", range, opts });
    this.isPlaying = true;
    this.isPaused = false;
  }

  async playSequence(sources: PlaySource[], opts?: PlayOptions): Promise<void> {
    this.calls.push({ kind: "playSequence", sources, opts });
    this.isPlaying = true;
    this.isPaused = false;
  }

  stop(): void {
    this.calls.push({ kind: "stop" });
    this.isPlaying = false;
    this.isPaused = false;
  }

  pause(): void {
    this.calls.push({ kind: "pause" });
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.isPaused = true;
  }

  resume(): void {
    this.calls.push({ kind: "resume" });
    if (!this.isPaused) return;
    this.isPlaying = true;
    this.isPaused = false;
  }

  setPlaybackRate(rate: number): void {
    this.calls.push({ kind: "setPlaybackRate", rate });
  }

  dispose(): void {
    this.stop();
  }
}

/** Range-end monitoring slop (seconds). rAF granularity makes ~5–20ms typical. */
const STOP_SLOP_SEC = 0.015;

/** HTMLMediaElement.playbackRate is clamped to the plan's 0.1–1.0 window. */
function clampRate(rate: number | undefined): number {
  if (rate == null || Number.isNaN(rate)) return 1;
  return Math.min(1, Math.max(0.1, rate));
}

/** rAF with a setTimeout fallback so non-DOM shims degrade gracefully. */
function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(() => cb());
  }
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export function createAudioElement(url: string): HTMLAudioElement {
  if (typeof Audio !== "undefined") {
    const el = new Audio(url);
    el.preload = "auto";
    return el;
  }
  if (typeof document !== "undefined") {
    const el = document.createElement("audio");
    el.src = url;
    el.preload = "auto";
    return el;
  }
  throw new Error(
    "MediaElementPlaybackEngine requires a browser environment (no Audio/document available).",
  );
}

/**
 * The real {@link PlaybackEngine}: wraps one main {@link HTMLMediaElement} (plus
 * small object-URL Audio elements for careful/translation clips) and enforces
 * sub-range playback by monitoring `currentTime` on each animation frame,
 * pausing when the range end is reached (~5–20ms slop, plan-accepted). Exposes
 * MobX-observable {@link isPlaying} / {@link positionSec} that update during
 * playback. All DOM access is confined to methods so importing this module is
 * safe in node/vitest.
 */
export class MediaElementPlaybackEngine implements PlaybackEngine {
  isPlaying = false;
  isPaused = false;
  positionSec = 0;
  clipUrl: string | undefined = undefined;

  private mainEl: HTMLMediaElement;
  private readonly ownsMainEl: boolean;
  /** Extra Audio elements for distinct clip URLs, keyed by URL. */
  private extraEls = new Map<string, HTMLAudioElement>();
  private rafId: number | null = null;
  private stopRequested = false;
  /** Resolver/pauser for the range currently playing; invoked by stop(). */
  private finishActive: (() => void) | null = null;
  /** Hold / continue the range currently playing; invoked by pause() / resume(). */
  private pauseActive: (() => void) | null = null;
  private resumeActive: (() => void) | null = null;
  /**
   * Bumped by every stop(). A sequence compares it after each clip, because a
   * newer play() clears `stopRequested` before the older sequence resumes.
   */
  private stopCount = 0;

  constructor(source: string | HTMLMediaElement) {
    if (typeof source === "string") {
      this.mainEl = createAudioElement(source);
      this.ownsMainEl = true;
    } else {
      this.mainEl = source;
      this.ownsMainEl = false;
    }
    makeAutoObservable<
      MediaElementPlaybackEngine,
      | "mainEl"
      | "ownsMainEl"
      | "extraEls"
      | "rafId"
      | "stopRequested"
      | "finishActive"
      | "pauseActive"
      | "resumeActive"
      | "stopCount"
    >(this, {
      mainEl: false,
      ownsMainEl: false,
      extraEls: false,
      rafId: false,
      stopRequested: false,
      finishActive: false,
      pauseActive: false,
      resumeActive: false,
      stopCount: false,
    });
  }

  /**
   * The underlying main media element, so the waveform renderer (wavesurfer's
   * MediaElement backend) can share it — one element for transport + cursor.
   */
  get mediaElement(): HTMLMediaElement {
    return this.mainEl;
  }

  private setPlayingState(v: boolean): void {
    this.isPlaying = v;
  }

  private setPausedState(v: boolean): void {
    this.isPaused = v;
  }

  private setPosition(sec: number): void {
    this.positionSec = sec;
  }

  private setClipUrl(url: string | undefined): void {
    this.clipUrl = url;
  }

  private cancelRaf(): void {
    if (this.rafId != null) {
      cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  private getExtraEl(url: string): HTMLAudioElement {
    let el = this.extraEls.get(url);
    if (!el) {
      el = createAudioElement(url);
      this.extraEls.set(url, el);
    }
    return el;
  }

  /**
   * Play `range` (or the whole element if omitted) on `el`, looping up to
   * `loops` times. Resolves when playback completes or {@link stop} is called.
   */
  private playRangeOnElement(
    el: HTMLMediaElement,
    range: TimeRange | undefined,
    rate: number,
    loops: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.stopRequested = false;
      el.playbackRate = rate;
      const start = range?.start ?? 0;
      const end = range?.end;
      let remaining = Math.max(1, Math.floor(loops));

      const finish = (): void => {
        this.cancelRaf();
        this.finishActive = null;
        this.pauseActive = null;
        this.resumeActive = null;
        try {
          el.pause();
        } catch {
          /* element may already be detached */
        }
        this.setPlayingState(false);
        resolve();
      };

      const onReachedEnd = (): void => {
        remaining -= 1;
        if (this.stopRequested || remaining <= 0) {
          finish();
          return;
        }
        startOne();
      };

      const tick = (): void => {
        this.setPosition(el.currentTime);
        if (this.stopRequested) {
          finish();
          return;
        }
        if (end != null && el.currentTime >= end - STOP_SLOP_SEC) {
          onReachedEnd();
          return;
        }
        if (el.ended) {
          onReachedEnd();
          return;
        }
        this.rafId = scheduleFrame(tick);
      };

      const startOne = (): void => {
        try {
          el.currentTime = start;
        } catch {
          /* seeking before metadata load is best-effort */
        }
        this.setPlayingState(true);
        this.setPosition(start);
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
        this.cancelRaf();
        this.rafId = scheduleFrame(tick);
      };

      this.finishActive = finish;
      this.pauseActive = (): void => {
        this.cancelRaf();
        try {
          el.pause();
        } catch {
          /* element may already be detached */
        }
        this.setPlayingState(false);
      };
      this.resumeActive = (): void => {
        this.setPlayingState(true);
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
        this.cancelRaf();
        this.rafId = scheduleFrame(tick);
      };
      startOne();
    });
  }

  play(range?: TimeRange, opts?: PlayOptions): Promise<void> {
    this.stop();
    this.setClipUrl(undefined);
    return this.playRangeOnElement(this.mainEl, range, clampRate(opts?.rate), opts?.maxLoops ?? 1);
  }

  async playSequence(sources: PlaySource[], opts?: PlayOptions): Promise<void> {
    this.stop();
    this.stopRequested = false;
    const generation = this.stopCount;
    const rate = clampRate(opts?.rate);
    const loops = Math.max(1, Math.floor(opts?.maxLoops ?? 1));
    for (let loop = 0; loop < loops; loop++) {
      for (const src of sources) {
        if (this.stopRequested || generation !== this.stopCount) return;
        const el = src.url ? this.getExtraEl(src.url) : this.mainEl;
        this.setClipUrl(src.url);
        await this.playRangeOnElement(el, src.range, rate, 1);
        if (this.stopRequested || generation !== this.stopCount) return;
      }
    }
  }

  pause(): void {
    if (!this.isPlaying || !this.pauseActive) return;
    this.pauseActive();
    this.setPausedState(true);
  }

  resume(): void {
    if (!this.isPaused || !this.resumeActive) return;
    this.setPausedState(false);
    this.resumeActive();
  }

  stop(): void {
    this.stopCount++;
    this.stopRequested = true;
    this.setPausedState(false);
    this.cancelRaf();
    const finish = this.finishActive;
    this.finishActive = null;
    if (finish) {
      finish();
    } else {
      this.setPlayingState(false);
    }
    for (const el of this.extraEls.values()) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    try {
      this.mainEl.pause();
    } catch {
      /* ignore */
    }
  }

  setPlaybackRate(rate: number): void {
    const r = clampRate(rate);
    this.mainEl.playbackRate = r;
    for (const el of this.extraEls.values()) el.playbackRate = r;
  }

  dispose(): void {
    this.stop();
    for (const el of this.extraEls.values()) {
      try {
        el.pause();
        el.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
    this.extraEls.clear();
    if (this.ownsMainEl) {
      try {
        this.mainEl.pause();
        this.mainEl.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
  }
}
