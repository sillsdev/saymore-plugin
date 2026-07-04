/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { forwardRef } from "react";

/**
 * A thin vertical line in content coordinates — the segmenter's edit cursor
 * and the recorder's playback cursors (source waveform + annotation cell
 * mini-waveform) all share this same visual. `visible` defaults to true so
 * existing always-on cursors (the segmenter's) don't need to pass it.
 *
 * Positioned via `transform: translateX` (not `left`) so a caller that needs
 * per-frame smoothness (the Oral Annotations viewer's rAF loop) can grab the
 * forwarded ref and write `style.transform` directly, bypassing React
 * entirely for those updates — `translateX` is a compositor-only change,
 * `left` would relayout on every frame.
 */
export const PlaybackCursor = forwardRef<
  HTMLDivElement,
  {
    xPx: number;
    height: number;
    color?: string;
    visible?: boolean;
    testId?: string;
  }
>(function PlaybackCursor(props, ref) {
  if (props.visible === false) return null;
  return (
    <div
      ref={ref}
      data-testid={props.testId ?? "playback-cursor"}
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        width: 1px;
        background: ${props.color ?? "#e53935"};
        pointer-events: none;
      `}
      style={{ transform: `translateX(${props.xPx}px)`, height: props.height }}
    />
  );
});
