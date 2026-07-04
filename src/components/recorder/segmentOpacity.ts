/**
 * Recorder segment state is encoded as WAVEFORM OPACITY, not a fill color
 * (John: no per-segment background fills in the recorder, including the
 * earlier Moccasin current-segment highlight — the segmenter is unaffected).
 * Three levels, applied to both the source-row waveform per segment and the
 * annotation-row mini-waveforms.
 */
export const SEGMENT_OPACITY = {
  current: 1,
  normal: 0.7,
  ignored: 0.3,
} as const;

export function cellOpacity(cell: { isCurrent: boolean; ignored: boolean }): number {
  if (cell.isCurrent) return SEGMENT_OPACITY.current;
  if (cell.ignored) return SEGMENT_OPACITY.ignored;
  return SEGMENT_OPACITY.normal;
}

/**
 * The source row's wave renders at a uniform base opacity (1, so the
 * "current" segment needs no mask at all); segments that should look less
 * opaque get a translucent white mask on top. Against a white background,
 * `mask_alpha = 1 - targetOpacity` reproduces `targetOpacity` exactly
 * (`line*(1-mask) + white*mask` vs. drawing the line at opacity `1-mask`
 * over the same white background are the same expression).
 */
export function opacityMaskAlpha(targetOpacity: number): number {
  return 1 - targetOpacity;
}
