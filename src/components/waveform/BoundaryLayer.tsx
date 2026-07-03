/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { clampBoundaryPosition } from "../../model/BoundaryRules";
import { isSegmentIgnored } from "../../model/IgnoreMarkers";
import { DRAG_DEAD_ZONE_PX } from "../../model/SayMoreConstants";
import { t } from "../../l10n";
import type { SegmenterViewModel } from "../../state/SegmenterViewModel";
import type { Viewport } from "./WaveformSurface";
import { SegmentShading } from "./SegmentShading";

interface DragState {
  index: number;
  startClientX: number;
  startEnd: number;
  currentSec: number;
  moved: boolean;
}

/**
 * The interaction overlay synced to the waveform's zoom/scroll: ignored-segment
 * shading, the edit cursor, boundary lines (click to select, drag to move,
 * clamped by neighbours + 460ms), and per-segment hover controls (play + ignore).
 * Rendered in content coordinates inside the WaveformSurface's translated layer.
 */
export const BoundaryLayer = observer(function BoundaryLayer(props: {
  vm: SegmenterViewModel;
  viewport: Viewport;
}) {
  const { vm, viewport } = props;
  const { secondsToPx, height } = viewport;
  const [drag, setDrag] = useState<DragState | null>(null);

  const segments = vm.segments;

  function onBoundaryPointerDown(e: React.PointerEvent, index: number): void {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    vm.selectBoundaryAt(segments[index].range.end);
    setDrag({
      index,
      startClientX: e.clientX,
      startEnd: segments[index].range.end,
      currentSec: segments[index].range.end,
      moved: false,
    });
  }

  function onBoundaryPointerMove(e: React.PointerEvent): void {
    if (!drag) return;
    const deltaPx = e.clientX - drag.startClientX;
    const desired = drag.startEnd + deltaPx / viewport.pxPerSec;
    const clamped = clampBoundaryPosition(segments, drag.index, desired, vm.durationSec);
    setDrag({
      ...drag,
      currentSec: clamped,
      moved: drag.moved || Math.abs(deltaPx) > DRAG_DEAD_ZONE_PX,
    });
  }

  function onBoundaryPointerUp(e: React.PointerEvent): void {
    if (!drag) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (drag.moved) vm.moveSelectedBoundaryTo(drag.currentSec);
    setDrag(null);
  }

  return (
    <>
      <SegmentShading segments={segments} viewport={viewport} />

      {/* Per-segment hover controls (play + ignore) in a thin top band. */}
      {segments.map((seg, i) => {
        const left = secondsToPx(seg.range.start);
        const width = secondsToPx(seg.range.end - seg.range.start);
        const ignored = isSegmentIgnored(seg);
        return (
          <div
            key={`ctl-${i}`}
            onMouseEnter={() => vm.setHoveredSegment(i)}
            css={css`
              position: absolute;
              top: 0;
              height: 24px;
              display: flex;
              align-items: center;
              gap: 4px;
              padding: 0 4px;
              pointer-events: auto;
              opacity: 0;
              transition: opacity 0.1s;
              &:hover {
                opacity: 1;
              }
            `}
            style={{ left, width }}
          >
            <button
              type="button"
              title={t("segmenter.playSegment", "Listen to this segment")}
              onClick={() => vm.playSegment(i)}
              css={buttonCss}
            >
              ▶
            </button>
            <button
              type="button"
              title={t("segmenter.ignore", "Ignore this segment")}
              aria-pressed={ignored}
              onClick={() => vm.toggleIgnore(i)}
              css={css`
                ${buttonCss};
                background: ${ignored ? "#d9a441" : "#fff"};
              `}
            >
              {ignored ? "🚫" : "◻"}
            </button>
          </div>
        );
      })}

      {/* Boundary lines: click to select, drag to move. */}
      {segments.map((seg, i) => {
        const isDragging = drag?.index === i;
        const boundarySec = isDragging ? drag!.currentSec : seg.range.end;
        const x = secondsToPx(boundarySec);
        const selected = vm.selectedBoundaryIndex === i;
        return (
          <div
            key={`b-${i}`}
            onPointerDown={(e) => onBoundaryPointerDown(e, i)}
            onPointerMove={onBoundaryPointerMove}
            onPointerUp={onBoundaryPointerUp}
            css={css`
              position: absolute;
              top: 0;
              height: ${height}px;
              width: 9px;
              margin-left: -4px;
              cursor: col-resize;
              pointer-events: auto;
              &::after {
                content: "";
                position: absolute;
                left: 4px;
                top: 0;
                width: ${selected ? 3 : 1}px;
                height: 100%;
                background: ${selected ? "#1565c0" : "#37474f"};
              }
            `}
            style={{ left: x }}
          />
        );
      })}

      {/* Edit cursor. */}
      <div
        css={css`
          position: absolute;
          top: 0;
          width: 1px;
          height: ${height}px;
          background: #e53935;
          pointer-events: none;
        `}
        style={{ left: secondsToPx(vm.editPositionSec) }}
      />
    </>
  );
});

const buttonCss = css`
  font-size: 11px;
  line-height: 1;
  padding: 2px 5px;
  border: 1px solid #90a4ae;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  &:hover {
    border-color: #546e7a;
  }
`;
