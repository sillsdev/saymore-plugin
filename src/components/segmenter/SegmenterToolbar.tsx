/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../../l10n";
import type { SegmenterViewModel } from "../../state/SegmenterViewModel";

/** SayMore's zoom combo choices (SegmenterDlgBase.cs). */
const ZOOM_CHOICES = [100, 125, 150, 175, 200, 250, 300, 500, 750, 1000];

/** Match the original readout ("00.0 / 02.9"): seconds with one decimal. */
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return sec.toFixed(1).padStart(4, "0");
}

// ── Icons (approximating SayMore's toolstrip glyphs) ────────────────────────
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M3 2 L13 8 L3 14 Z" fill="#2e7d32" />
  </svg>
);
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <rect x="3" y="3" width="10" height="10" fill="#c62828" />
  </svg>
);
const BoundaryIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="#607d8b"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M6 3 h4 M6 13 h4 M8 3 v10" />
  </svg>
);
const DeleteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" stroke="#78909c" strokeWidth="2" aria-hidden>
    <path d="M4 4 L12 12 M12 4 L4 12" />
  </svg>
);

/**
 * The manual-segmenter footer, laid out like SayMore's ManualSegmenterDlg:
 * a vertical stack of flat icon+label action buttons on the left, with the
 * segment count + time readout and the zoom dropdown on the right. Edits persist
 * continuously (no undo/redo/save buttons).
 */
export const SegmenterToolbar = observer(function SegmenterToolbar(props: {
  vm: SegmenterViewModel;
}) {
  const { vm } = props;
  const current = vm.isPlaying ? vm.playback.positionSec : vm.cursorSec;
  const zoomOptions = ZOOM_CHOICES.includes(vm.zoomPercent)
    ? ZOOM_CHOICES
    : [...ZOOM_CHOICES, vm.zoomPercent].sort((a, b) => a - b);

  return (
    <div
      css={css`
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 10px 12px;
        border-top: 1px solid #cfd8dc;
        background: #f0f0f0;
        font-size: 13px;
      `}
    >
      {/* Left: the three primary actions, stacked vertically. */}
      <div
        css={css`
          display: flex;
          flex-direction: column;
          gap: 2px;
        `}
      >
        <button type="button" onClick={() => vm.togglePlay()} css={action}>
          {vm.isPlaying ? <StopIcon /> : <PlayIcon />}
          {vm.isPlaying
            ? t("segmenter.stop", "Stop (press the SPACE BAR)")
            : t("segmenter.listen", "Listen (press the SPACE BAR)")}
        </button>
        <button type="button" onClick={() => vm.addBoundaryAtCursor()} css={action}>
          <BoundaryIcon />
          {t("segmenter.addBoundary", "Add Segment Boundary (press ENTER)")}
        </button>
        <button
          type="button"
          disabled={vm.selectedBoundaryIndex < 0}
          onClick={() => vm.deleteSelectedBoundary()}
          css={action}
        >
          <DeleteIcon />
          {t("segmenter.deleteBoundary", "Delete Selected Boundary (press DELETE)")}
        </button>
      </div>

      <span
        css={css`
          flex: 1;
        `}
      />

      {/* Right: segment count + time on top, zoom below. */}
      <div
        css={css`
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          color: #455a64;
          white-space: nowrap;
        `}
      >
        <div
          css={css`
            display: flex;
            gap: 28px;
          `}
        >
          <span>
            {t("segmenter.segmentCount", "Segments: {count}", { count: vm.segmentCount })}
          </span>
          <span
            css={css`
              font-variant-numeric: tabular-nums;
            `}
          >
            {formatTime(current)} / {formatTime(vm.durationSec)}
          </span>
        </div>
        <label
          css={css`
            display: flex;
            align-items: center;
            gap: 6px;
          `}
        >
          {t("segmenter.zoom", "Zoom:")}
          <select
            value={vm.zoomPercent}
            onChange={(e) => vm.setZoomPercent(Number(e.target.value))}
            title="Ctrl+1: In; Ctrl+2: 100%; Ctrl+3: Out"
            css={css`
              padding: 2px 4px;
              border: 1px solid #90a4ae;
              border-radius: 3px;
              background: #fff;
              font-size: 13px;
            `}
          >
            {zoomOptions.map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
});

const action = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #212121;
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
  &:not(:disabled):hover {
    color: #000;
    text-decoration: underline;
  }
`;
