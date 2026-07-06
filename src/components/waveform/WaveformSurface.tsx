/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import WaveSurfer from "wavesurfer.js";
import type { Envelope } from "../../audio/EnvelopeCache";
import { envelopeToPeaks } from "../../audio/envelope";
import { t } from "../../l10n";
import { LAMETA_WAVEFORM } from "../../lametaTheme";

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
/** Keep `time` pinned at `viewportX` (px from the pane's left) across a zoom. */
export interface ZoomAnchor {
  time: number;
  viewportX: number;
}

export interface WaveformSurfaceApi {
  secondsToPx(seconds: number): number;
  pxToSeconds(px: number): number;
  setZoom(minPxPerSec: number, anchor?: ZoomAnchor): void;
  scrollToSeconds(seconds: number): void;
  onScroll(cb: (scrollLeftPx: number) => void): () => void;
  onZoom(cb: (minPxPerSec: number) => void): () => void;
  /** The scroller's viewport rect, for hit-testing the mouse against the wave. */
  getScrollerRect(): DOMRect | undefined;
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
  /** Wave/progress color; defaults to the segmenter's green (the recorder's
   * source row uses a blue shade instead — same waveform, different tool). */
  waveColor?: string;
  /** CSS opacity of the rendered wave; defaults to the segmenter's 0.7. The
   * recorder renders at 1 and encodes per-segment state (current/normal/
   * ignored) via its own overlay masks instead. */
  waveOpacity?: number;
  /** wavesurfer click-to-seek → position the segmenter cursor. */
  onSeek?(seconds: number): void;
  /** Render the interaction overlay in content coordinates, synced to scroll. */
  overlay?(viewport: Viewport): ReactNode;
  /** Show a centered "Preparing waveform…" note over the (empty) surface while the
   * envelope is still decoding (stage B of ProjectStore.load). */
  loading?: boolean;
}

const DEFAULT_HEIGHT = 128;
/** Extra room below the wave so the horizontal scrollbar doesn't cover content. */
const SCROLLBAR_SPACE = 16;

export const WaveformSurface = forwardRef<WaveformSurfaceApi, WaveformSurfaceProps>(
  function WaveformSurface(props, ref) {
    const { envelope, durationSec, mediaElement, mediaUrl, onSeek, overlay } = props;
    const height = props.height ?? DEFAULT_HEIGHT;
    const waveColor = props.waveColor ?? LAMETA_WAVEFORM;
    const waveOpacity = props.waveOpacity ?? 0.7;

    const rootRef = useRef<HTMLDivElement>(null);
    const waveRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const minPxRef = useRef<number>(props.minPxPerSec ?? 80);
    const readyRef = useRef(false);
    const pendingAnchorRef = useRef<ZoomAnchor | null>(null);
    const scrollSubs = useRef(new Set<(px: number) => void>());
    const zoomSubs = useRef(new Set<(px: number) => void>());

    const [scrollLeft, setScrollLeft] = useState(0);
    const [pxPerSec, setPxPerSec] = useState(props.minPxPerSec ?? 80);
    const [contentWidth, setContentWidth] = useState(0);
    const [ready, setReady] = useState(false);

    // The rendered content width: the natural width at the current zoom
    // (px/s × duration), but never narrower than the visible pane. When it
    // exceeds the pane the root scrolls horizontally (native scrollbar) and the
    // wave + overlay scroll together because they share this content box.
    function recompute(): void {
      const root = rootRef.current;
      if (!root || durationSec <= 0) return;
      const paneWidth = root.clientWidth;
      const effectivePxPerSec = Math.max(minPxRef.current, paneWidth / durationSec);
      const width = effectivePxPerSec * durationSec;
      setPxPerSec(effectivePxPerSec);
      setContentWidth(width);
      setScrollLeft(root.scrollLeft);
      // No ws.zoom(): wavesurfer `fillParent` renders to the (wide) content box
      // set below, and the root scrolls it. Calling zoom here would loop with the
      // "redraw" event and mis-measure the MediaElement backend.
    }

    // Size the content box BEFORE wavesurfer mounts. A layout effect runs before
    // the passive create-effect below (and before paint), so `contentWidth` is
    // already committed to the DOM when wavesurfer takes its first measurement —
    // it then renders once, at the final zoom width. Without this, wavesurfer's
    // first render lands at the pane width (contentWidth still 0 → CSS 100%) and
    // a second render follows at the zoom width; that fit-to-pane render max-
    // downsamples the (normalized) peaks into a solid block, so the correction
    // reads as a flash of a totally different waveform.
    useLayoutEffect(() => {
      recompute();
    }, [durationSec]);

    useEffect(() => {
      const container = waveRef.current;
      if (!container || durationSec <= 0) return;

      const ws = WaveSurfer.create({
        container,
        height,
        waveColor,
        progressColor: waveColor,
        cursorColor: "transparent", // the overlay draws the edit cursor
        cursorWidth: 0,
        backend: "MediaElement",
        interact: true,
        dragToSeek: false,
        autoScroll: false,
        fillParent: true,
        normalize: false,
        minPxPerSec: 1,
        duration: durationSec,
        peaks: envelope ? envelopeToPeaks(envelope) : undefined,
        ...(mediaElement ? { media: mediaElement } : mediaUrl ? { url: mediaUrl } : {}),
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
      ws.on("interaction", (newTime: number) => onSeek?.(newTime));
      // TEMP flash-diagnostic
      ws.on("redraw", () => {
        (window as unknown as { __wsRenders?: unknown[] }).__wsRenders ??= [];
        (window as unknown as { __wsRenders: unknown[] }).__wsRenders.push({
          t: performance.now(),
          width: ws.getWidth(),
          color: waveColor,
        });
        // eslint-disable-next-line no-console
        console.log("[wsRedraw]", waveColor, ws.getWidth());
      });

      // MediaElement backend with shared element may already be "ready".
      readyRef.current = true;
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
    }, [mediaElement, mediaUrl, durationSec, waveColor]);

    // After a zoom changes the content width, pin the anchor time back under the
    // same viewport x (runs before paint, so there's no visible jump).
    useLayoutEffect(() => {
      const anchor = pendingAnchorRef.current;
      const root = rootRef.current;
      if (!anchor || !root) return;
      pendingAnchorRef.current = null;
      root.scrollLeft = anchor.time * pxPerSec - anchor.viewportX;
    }, [pxPerSec, contentWidth]);

    const secondsToPx = (seconds: number): number => seconds * pxPerSec;
    const pxToSeconds = (px: number): number => (pxPerSec > 0 ? px / pxPerSec : 0);

    const viewport: Viewport = {
      pxPerSec,
      scrollLeft,
      contentWidth,
      height,
      secondsToPx,
      pxToSeconds,
    };

    function handleScroll(): void {
      const left = rootRef.current?.scrollLeft ?? 0;
      setScrollLeft(left);
      scrollSubs.current.forEach((cb) => cb(left));
    }

    useImperativeHandle(
      ref,
      (): WaveformSurfaceApi => ({
        secondsToPx,
        pxToSeconds,
        setZoom: (minPxPerSec: number, anchor?: ZoomAnchor) => {
          minPxRef.current = minPxPerSec;
          pendingAnchorRef.current = anchor ?? null;
          recompute();
          zoomSubs.current.forEach((cb) => cb(minPxPerSec));
        },
        scrollToSeconds: (seconds: number) => {
          const root = rootRef.current;
          if (root) root.scrollLeft = seconds * pxPerSec;
        },
        onScroll: (cb) => {
          scrollSubs.current.add(cb);
          return () => scrollSubs.current.delete(cb);
        },
        onZoom: (cb) => {
          zoomSubs.current.add(cb);
          return () => zoomSubs.current.delete(cb);
        },
        getScrollerRect: () => rootRef.current?.getBoundingClientRect(),
        getViewport: () => viewport,
      }),
      [pxPerSec, scrollLeft, contentWidth],
    );

    return (
      <div
        ref={rootRef}
        onScroll={handleScroll}
        css={css`
          position: relative;
          height: ${height + SCROLLBAR_SPACE}px;
          overflow-x: auto;
          overflow-y: hidden;
          background: #fff;
        `}
      >
        <div
          css={css`
            position: relative;
            height: ${height}px;
            width: ${contentWidth > 0 ? `${contentWidth}px` : "100%"};
          `}
        >
          <div
            ref={waveRef}
            css={css`
              position: absolute;
              inset: 0;
              z-index: 1;
            `}
            style={{ opacity: waveOpacity }}
          />
          <div
            css={css`
              position: absolute;
              top: 0;
              left: 0;
              height: ${height}px;
              width: ${contentWidth}px;
              z-index: 2;
              pointer-events: none;
            `}
          >
            {ready && overlay?.(viewport)}
          </div>
        </div>
        {props.loading && (
          <div
            css={css`
              position: absolute;
              inset: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13px;
              color: #78909c;
              pointer-events: none;
            `}
          >
            {t("plugin.preparingWaveform", "Preparing waveform…")}
          </div>
        )}
      </div>
    );
  },
);
