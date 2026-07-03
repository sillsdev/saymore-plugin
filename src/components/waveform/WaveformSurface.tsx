/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";
import WaveSurfer from "wavesurfer.js";
import type { Envelope } from "../../audio/EnvelopeCache";
import { envelopeToPeaks } from "../../audio/envelope";

/**
 * The current mapping between media time and on-screen pixels, handed to the
 * interaction overlay so it can position boundaries/shading in lockstep with the
 * waveform's zoom and scroll.
 */
export interface Viewport {
  pxPerSec: number;
  scrollLeft: number;
  /** Full rendered content width in px (duration × pxPerSec, min container width). */
  contentWidth: number;
  height: number;
  /** Media seconds → content x (px), independent of scroll. */
  secondsToPx(seconds: number): number;
  /** Content x (px) → media seconds. */
  pxToSeconds(px: number): number;
}

/**
 * Renderer-agnostic imperative API. Every interaction component programs against
 * THIS (not wavesurfer directly), so the renderer can be swapped for a
 * viewport-windowed custom canvas without touching the overlay or tools.
 */
export interface WaveformSurfaceApi {
  secondsToPx(seconds: number): number;
  pxToSeconds(px: number): number;
  setZoom(minPxPerSec: number): void;
  scrollToSeconds(seconds: number): void;
  onScroll(cb: (scrollLeftPx: number) => void): () => void;
  onZoom(cb: (minPxPerSec: number) => void): () => void;
  getViewport(): Viewport;
}

export interface WaveformSurfaceProps {
  /** Precomputed envelope used as wavesurfer `peaks` (never decodes the media). */
  envelope?: Envelope;
  /** Explicit media duration (seconds) so the renderer never decodes the media. */
  durationSec: number;
  /** Existing media element to share with the PlaybackEngine (preferred). */
  mediaElement?: HTMLMediaElement;
  /** Fallback media source URL if no element is shared. */
  mediaUrl?: string;
  height?: number;
  /** Zoom in pixels-per-second (SayMore 100% ≈ 80 px/s). */
  minPxPerSec?: number;
  /** wavesurfer click-to-seek → position the segmenter cursor. */
  onSeek?(seconds: number): void;
  /** Render the interaction overlay in content coordinates, synced to scroll. */
  overlay?(viewport: Viewport): ReactNode;
}

const DEFAULT_HEIGHT = 128;

export const WaveformSurface = forwardRef<WaveformSurfaceApi, WaveformSurfaceProps>(
  function WaveformSurface(props, ref) {
    const { envelope, durationSec, mediaElement, mediaUrl, onSeek, overlay } = props;
    const height = props.height ?? DEFAULT_HEIGHT;

    const rootRef = useRef<HTMLDivElement>(null);
    const waveRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const minPxRef = useRef<number>(props.minPxPerSec ?? 80);
    const readyRef = useRef(false);
    const scrollSubs = useRef(new Set<(px: number) => void>());
    const zoomSubs = useRef(new Set<(px: number) => void>());

    const [scrollLeft, setScrollLeft] = useState(0);
    const [pxPerSec, setPxPerSec] = useState(props.minPxPerSec ?? 80);
    const [contentWidth, setContentWidth] = useState(0);
    const [ready, setReady] = useState(false);

    // Recompute the pixel mapping from the container + current zoom.
    function recompute(): void {
      const ws = wsRef.current;
      const root = rootRef.current;
      if (!ws || !root || durationSec <= 0) return;
      const viewportWidth = root.clientWidth;
      const effectivePxPerSec = Math.max(minPxRef.current, viewportWidth / durationSec);
      const width = effectivePxPerSec * durationSec;
      setPxPerSec(effectivePxPerSec);
      setContentWidth(width);
      setScrollLeft(ws.getScroll());
    }

    useEffect(() => {
      const container = waveRef.current;
      if (!container || durationSec <= 0) return;

      const ws = WaveSurfer.create({
        container,
        height,
        waveColor: "#9db4c0",
        progressColor: "#9db4c0",
        cursorColor: "#d33",
        cursorWidth: 1,
        backend: "MediaElement",
        interact: true,
        dragToSeek: false,
        autoScroll: true,
        fillParent: true,
        normalize: false,
        minPxPerSec: minPxRef.current,
        duration: durationSec,
        peaks: envelope ? envelopeToPeaks(envelope) : undefined,
        ...(mediaElement ? { media: mediaElement } : mediaUrl ? { url: mediaUrl } : {})
      });
      wsRef.current = ws;

      ws.on("ready", () => {
        readyRef.current = true;
        setReady(true);
        recompute();
      });
      ws.on("decode", () => {
        readyRef.current = true;
        setReady(true);
        recompute();
      });
      ws.on("redraw", recompute);
      ws.on("zoom", (px: number) => {
        minPxRef.current = px;
        recompute();
        zoomSubs.current.forEach((cb) => cb(px));
      });
      ws.on("scroll", () => {
        const left = ws.getScroll();
        setScrollLeft(left);
        scrollSubs.current.forEach((cb) => cb(left));
      });
      ws.on("interaction", (newTime: number) => onSeek?.(newTime));

      // MediaElement backend with shared element may already be "ready".
      recompute();
      setReady(true);

      const onResize = () => recompute();
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
        wsRef.current = null;
        // Detach without tearing down a shared media element's playback state.
        try {
          ws.unAll();
          ws.destroy();
        } catch {
          /* ignore teardown races */
        }
      };
    }, [mediaElement, mediaUrl, durationSec]);

    const secondsToPx = (seconds: number): number => seconds * pxPerSec;
    const pxToSeconds = (px: number): number => (pxPerSec > 0 ? px / pxPerSec : 0);

    const viewport: Viewport = {
      pxPerSec,
      scrollLeft,
      contentWidth,
      height,
      secondsToPx,
      pxToSeconds
    };

    useImperativeHandle(
      ref,
      (): WaveformSurfaceApi => ({
        secondsToPx,
        pxToSeconds,
        setZoom: (minPxPerSec: number) => {
          minPxRef.current = minPxPerSec;
          // ws.zoom() throws "No audio loaded" before the renderer is ready.
          if (readyRef.current) {
            try {
              wsRef.current?.zoom(minPxPerSec);
            } catch {
              /* not ready yet; recompute keeps the overlay consistent */
            }
          }
          recompute();
        },
        scrollToSeconds: (seconds: number) => {
          const ws = wsRef.current;
          if (ws && durationSec > 0) ws.setScrollTime(seconds);
        },
        onScroll: (cb) => {
          scrollSubs.current.add(cb);
          return () => scrollSubs.current.delete(cb);
        },
        onZoom: (cb) => {
          zoomSubs.current.add(cb);
          return () => zoomSubs.current.delete(cb);
        },
        getViewport: () => viewport
      }),
      [pxPerSec, scrollLeft, contentWidth]
    );

    return (
      <div
        ref={rootRef}
        css={css`
          position: relative;
          height: ${height}px;
          overflow: hidden;
          background: #f4f6f8;
        `}
      >
        <div ref={waveRef} css={css`position: absolute; inset: 0;`} />
        <div
          css={css`
            position: absolute;
            inset: 0;
            overflow: hidden;
            pointer-events: none;
          `}
        >
          <div
            css={css`
              position: absolute;
              top: 0;
              left: 0;
              height: ${height}px;
              width: ${contentWidth}px;
              transform: translateX(${-scrollLeft}px);
            `}
          >
            {ready && overlay?.(viewport)}
          </div>
        </div>
      </div>
    );
  }
);
