/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";

/**
 * A thin vertical line in content coordinates — the segmenter's edit cursor
 * and the recorder's playback cursors (source waveform + annotation cell
 * mini-waveform) all share this same visual. `visible` defaults to true so
 * existing always-on cursors (the segmenter's) don't need to pass it.
 */
export function PlaybackCursor(props: {
  xPx: number;
  height: number;
  color?: string;
  visible?: boolean;
  testId?: string;
}) {
  if (props.visible === false) return null;
  return (
    <div
      data-testid={props.testId ?? "playback-cursor"}
      css={css`
        position: absolute;
        top: 0;
        width: 1px;
        background: ${props.color ?? "#e53935"};
        pointer-events: none;
      `}
      style={{ left: props.xPx, height: props.height }}
    />
  );
}
