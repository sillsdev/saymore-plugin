/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../../l10n";
import type { SegmenterViewModel } from "../../state/SegmenterViewModel";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * The manual-segmenter toolbar: transport, edit actions, zoom, undo/redo, save,
 * and the segment-count + time readout. All actions mirror the keyboard model.
 */
export const SegmenterToolbar = observer(function SegmenterToolbar(props: {
  vm: SegmenterViewModel;
  onSave: () => void;
  saveLabel: string;
}) {
  const { vm, onSave, saveLabel } = props;
  const current = vm.isPlaying ? vm.playback.positionSec : vm.cursorSec;
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 8px;
        border-bottom: 1px solid #cfd8dc;
        font-size: 13px;
      `}
    >
      <button type="button" onClick={() => vm.togglePlay()} css={btn}>
        {vm.isPlaying
          ? t("segmenter.stop", "Stop (Space)")
          : t("segmenter.listen", "Listen (Space)")}
      </button>
      <button type="button" onClick={() => vm.addBoundaryAtCursor()} css={btn}>
        {t("segmenter.addBoundary", "Add Boundary (Enter)")}
      </button>
      <button
        type="button"
        disabled={vm.selectedBoundaryIndex < 0}
        onClick={() => vm.deleteSelectedBoundary()}
        css={btn}
      >
        {t("segmenter.deleteBoundary", "Delete Boundary (Del)")}
      </button>

      <span css={sep} />

      <button type="button" disabled={!vm.canUndo} onClick={() => vm.undo()} css={btn}>
        {t("segmenter.undo", "Undo (Z)")}
      </button>
      <button type="button" disabled={!vm.canRedo} onClick={() => vm.redo()} css={btn}>
        {t("segmenter.redo", "Redo")}
      </button>

      <span css={sep} />

      <button type="button" onClick={() => vm.zoomOut()} css={btn} title="Ctrl+3">
        −
      </button>
      <span css={css`min-width: 3.5em; text-align: center;`}>{vm.zoomPercent}%</span>
      <button type="button" onClick={() => vm.zoomIn()} css={btn} title="Ctrl+1">
        +
      </button>
      <button type="button" onClick={() => vm.zoomReset()} css={btn} title="Ctrl+2">
        {t("segmenter.zoomReset", "100%")}
      </button>

      <span css={sep} />

      <button type="button" onClick={onSave} css={btn}>
        {saveLabel}
        {vm.isDirty ? " *" : ""}
      </button>

      <span css={css`flex: 1;`} />

      <span css={css`color: #455a64;`}>
        {t("segmenter.segmentCount", "Segments: {count}", { count: vm.segmentCount })}
      </span>
      <span css={css`font-variant-numeric: tabular-nums; color: #455a64;`}>
        {formatTime(current)} / {formatTime(vm.durationSec)}
      </span>
    </div>
  );
});

const btn = css`
  padding: 4px 8px;
  border: 1px solid #90a4ae;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
  &:not(:disabled):hover {
    border-color: #546e7a;
  }
`;

const sep = css`
  width: 1px;
  align-self: stretch;
  background: #cfd8dc;
`;
