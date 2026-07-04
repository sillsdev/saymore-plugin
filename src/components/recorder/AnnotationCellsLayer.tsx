/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { t } from "../../l10n";
import { SELECTED_SEGMENT_HIGHLIGHT_COLOR } from "../../model/SayMoreConstants";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { Viewport } from "../waveform/WaveformSurface";
import { layoutCells, newSegmentRect, type CellRect } from "./cellLayout";
import { drawMiniWaveform, miniWaveformFromWav } from "./miniWaveform";
import { PlayIcon } from "./PlayIcon";
import rerecordIconUrl from "./icons/RerecordOralAnnotation.png";
import eraseIconUrl from "./icons/RecordErase.png";

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
  // Read during render (inside this observer component) so MobX tracks the
  // overlay Map entry for THIS key — reading it inside the effect below,
  // like the previous version did, happens outside any reactive context, so
  // a re-record/erase (which changes the bytes at the same key, not the
  // cell's annotated flag or range) never re-ran the effect and the canvas
  // kept showing the stale clip.
  const bytes = cell.annotated ? vm.store.get(cell.range, vm.kind) : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const canvasWidth = Math.max(1, Math.round(rect.width));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!bytes) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
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
  }, [bytes, canvasWidth, height]);

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

      {/* Always visible once annotated (SayMore draws it persistently, not hover-only). */}
      {cell.annotated && (
        <button
          type="button"
          data-testid={`cell-play-${rect.index}`}
          title={t("recorder.playAnnotation", "Play the recording")}
          onClick={() => vm.playAnnotation(rect.index)}
          css={iconButtonCss("bottom", "left")}
        >
          <PlayIcon size={12} />
        </button>
      )}

      {hovered && cell.annotated && (
        <>
          <ReRecordButton vm={vm} index={rect.index} />
          <button
            type="button"
            data-testid={`cell-erase-${rect.index}`}
            title={t("recorder.erase", "Erase")}
            onClick={handleErase}
            css={iconButtonCss("top", "right")}
          >
            <img src={eraseIconUrl} alt="" width={14} height={14} />
          </button>
        </>
      )}
    </div>
  );
});

/** Press-and-hold re-record on one cell — same abort-on-capture-loss semantics as ListenButton/SpeakButton. */
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
    <button
      type="button"
      data-testid={`cell-rerecord-${index}`}
      title={t("recorder.reRecord", "Press and hold to re-record")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onCaptureLost}
      onLostPointerCapture={onCaptureLost}
      css={iconButtonCss("bottom", "right")}
    >
      <img src={rerecordIconUrl} alt="" width={14} height={14} draggable={false} />
    </button>
  );
}

const canvasCss = css`
  display: block;
  width: 100%;
  height: 100%;
`;

function iconButtonCss(vAlign: "top" | "bottom", hAlign: "left" | "right") {
  return css`
    position: absolute;
    ${vAlign}: 2px;
    ${hAlign}: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid #90a4ae;
    border-radius: 3px;
    background: #fff;
    cursor: pointer;
    &:hover {
      background: #eef6ee;
    }
  `;
}
