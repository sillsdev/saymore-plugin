/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import { t } from "../../l10n";
import { SELECTED_SEGMENT_HIGHLIGHT_COLOR } from "../../model/SayMoreConstants";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { Viewport } from "../waveform/WaveformSurface";
import { layoutCells, newSegmentRect, type CellRect } from "./cellLayout";
import { drawMiniWaveform, miniWaveformFromWav } from "./miniWaveform";

const MINI_WAVEFORM_COLOR = "#2e7d32";

/**
 * The per-segment annotation strip below the source waveform: one cell per
 * real segment (pixel-aligned to `viewport` via {@link layoutCells}), plus the
 * virtual new-segment slot while `vm.currentIndex === "new"`.
 */
export const AnnotationCellsLayer = observer(function AnnotationCellsLayer(props: {
  vm: RecorderViewModel;
  viewport: Viewport;
  height: number;
}) {
  const { vm, viewport, height } = props;
  const rects = layoutCells(vm.cells, viewport);
  const newRect =
    vm.currentIndex === "new"
      ? newSegmentRect(vm.endOfLastSegment, vm.newSegmentEndSec, viewport)
      : undefined;

  return (
    <>
      {rects.map((rect) => (
        <AnnotationCell key={rect.index} vm={vm} rect={rect} height={height} />
      ))}
      {newRect && (
        <div
          data-testid="new-segment-cell"
          css={css`
            position: absolute;
            top: 0;
            height: ${height}px;
            background: ${SELECTED_SEGMENT_HIGHLIGHT_COLOR};
            opacity: 0.5;
          `}
          style={{ left: newRect.left, width: newRect.width }}
        />
      )}
    </>
  );
});

const AnnotationCell = observer(function AnnotationCell(props: {
  vm: RecorderViewModel;
  rect: CellRect;
  height: number;
}) {
  const { vm, rect, height } = props;
  const cell = vm.cells[rect.index];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const canvasWidth = Math.max(1, Math.round(rect.width));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cell.annotated) return;
    const bytes = vm.store.get(cell.range, vm.kind);
    if (!bytes) return;
    try {
      drawMiniWaveform(
        canvas,
        miniWaveformFromWav(bytes, canvasWidth, height),
        MINI_WAVEFORM_COLOR,
      );
    } catch {
      // Not a decodable WAV (shouldn't happen for our own recordings) — leave
      // the cell's translucent fill without a mini-waveform rather than crash.
    }
  }, [vm, cell.annotated, cell.range.start, cell.range.end, canvasWidth, height]);

  function handleErase(): void {
    if (window.confirm(t("recorder.confirmErase", "Erase this recording? This can be undone."))) {
      vm.eraseAnnotation(rect.index);
    }
  }

  return (
    <div
      data-testid={`annotation-cell-${rect.index}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      css={css`
        position: absolute;
        top: 0;
        height: ${height}px;
        border-right: 1px solid #dce7d0;
        pointer-events: auto;
        background: ${cell.isCurrent
          ? SELECTED_SEGMENT_HIGHLIGHT_COLOR
          : cell.annotated
            ? "rgba(46, 125, 50, 0.10)"
            : "transparent"};
      `}
      style={{ left: rect.left, width: rect.width }}
    >
      {cell.ignored ? (
        <span
          css={css`
            display: block;
            padding-top: 4px;
            text-align: center;
            font-size: 11px;
            color: #78909c;
          `}
        >
          {t("recorder.skipped", "skipped")}
        </span>
      ) : (
        <canvas ref={canvasRef} width={canvasWidth} height={height} css={canvasCss} />
      )}

      {hovered && !cell.ignored && (
        <div css={hoverBarCss}>
          <IconButton
            size="small"
            sx={hoverButtonSx}
            title={t("recorder.playAnnotation", "Play the recording")}
            disabled={!cell.annotated}
            onClick={() => vm.playAnnotation(rect.index)}
          >
            🔊
          </IconButton>
          <IconButton
            size="small"
            sx={hoverButtonSx}
            title={t("recorder.playSource", "Play the source")}
            onClick={() => vm.playSourceOf(rect.index)}
          >
            ▶
          </IconButton>
          <ReRecordButton vm={vm} index={rect.index} />
          <IconButton
            size="small"
            sx={hoverButtonSx}
            title={t("recorder.erase", "Erase")}
            disabled={!cell.annotated}
            onClick={handleErase}
          >
            🗑
          </IconButton>
        </div>
      )}
    </div>
  );
});

/** Press-and-hold re-record on one cell — same abort-on-capture-loss semantics as ListenSpeakButtons. */
function ReRecordButton(props: { vm: RecorderViewModel; index: number }) {
  const { vm, index } = props;
  const heldRef = useRef(false);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    heldRef.current = true;
    vm.reRecordDown(index);
  }
  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>): void {
    if (!heldRef.current) return;
    heldRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    void vm.reRecordUp(index);
  }
  function onCaptureLost(): void {
    if (!heldRef.current) return;
    heldRef.current = false;
    vm.abortRecording();
  }

  return (
    <IconButton
      size="small"
      sx={hoverButtonSx}
      title={t("recorder.reRecord", "Press and hold to re-record")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onCaptureLost}
      onLostPointerCapture={onCaptureLost}
    >
      🎙
    </IconButton>
  );
}

const canvasCss = css`
  display: block;
  width: 100%;
  height: 100%;
`;

const hoverBarCss = css`
  position: absolute;
  bottom: 2px;
  left: 2px;
  right: 2px;
  display: flex;
  justify-content: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 3px;
`;

const hoverButtonSx = {
  width: 20,
  height: 20,
  p: 0,
  fontSize: 11,
  "&.Mui-disabled": { opacity: 0.4 },
} as const;
