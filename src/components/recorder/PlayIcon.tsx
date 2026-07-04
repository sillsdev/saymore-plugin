/** @jsxImportSource @emotion/react */
/**
 * Crisp inline-SVG play triangle (John's amendment: the PlaySegment.png PNG
 * looked rough at these sizes) — same glyph the segmenter's own per-segment
 * play button already draws (BoundaryLayer.tsx), reused here for the
 * recorder's source-row and annotation-cell play buttons.
 */
export function PlayIcon(props: { size?: number }) {
  const size = props.size ?? 12;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path d="M2 1 L11 6 L2 11 Z" fill="#2e7d32" />
    </svg>
  );
}
