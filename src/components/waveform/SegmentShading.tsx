/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import type { AnnotationSegment } from "../../model/AnnotationSegment";
import { isSegmentIgnored } from "../../model/IgnoreMarkers";
import type { Viewport } from "./WaveformSurface";

/**
 * Shades ignored segments (transcription `%ignore%`) in the interaction overlay.
 * Purely presentational; rendered in content coordinates (the parent overlay is
 * translated by scroll).
 */
export const SegmentShading = observer(function SegmentShading(props: {
  segments: readonly AnnotationSegment[];
  viewport: Viewport;
}) {
  const { segments, viewport } = props;
  return (
    <>
      {segments.map((seg, i) =>
        isSegmentIgnored(seg) ? (
          <div
            key={i}
            css={css`
              position: absolute;
              top: 0;
              height: ${viewport.height}px;
              background: repeating-linear-gradient(
                45deg,
                rgba(120, 120, 120, 0.18),
                rgba(120, 120, 120, 0.18) 6px,
                rgba(120, 120, 120, 0.06) 6px,
                rgba(120, 120, 120, 0.06) 12px
              );
              pointer-events: none;
            `}
            style={{
              left: viewport.secondsToPx(seg.range.start),
              width: viewport.secondsToPx(seg.range.end - seg.range.start)
            }}
          />
        ) : null
      )}
    </>
  );
});
