/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import IconButton from "@mui/material/IconButton";
import { useState } from "react";
import { clampBoundaryPosition } from "../../model/BoundaryRules";
import { isSegmentIgnored } from "../../model/IgnoreMarkers";
import { DRAG_DEAD_ZONE_PX } from "../../model/SayMoreConstants";
import { LAMETA_DARK_BLUE, LAMETA_ORANGE } from "../../lametaTheme";
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
 * shading, the edit cursor, boundary lines (lameta-orange; click to select, drag
 * to move via the wider top/bottom grips, clamped by neighbours + 460ms), an
 * always-visible per-segment play button at each segment's start, and a
 * hover-only ignore toggle. Rendered in content coordinates inside the
 * WaveformSurface's scrolled layer.
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
    (e.target as Element).setPointerCapture?.(e.pointerId);
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
    if (drag.moved) {
      // Mirror the Delete-key path (ManualSegmenterView): moving a boundary
      // that touches an existing oral-annotation recording needs the same
      // confirm — declining leaves the model untouched, so the boundary
      // simply renders back at its pre-drag position once `drag` clears.
      if (
        !vm.requiresPermanenceConfirm(drag.index) ||
        window.confirm(
          t(
            "segmenter.confirmMove",
            "A segment here has an oral annotation recording. Move this boundary anyway?",
          ),
        )
      ) {
        vm.moveSelectedBoundaryTo(drag.currentSec);
      }
    }
    setDrag(null);
  }

  return (
    <>
      <SegmentShading segments={segments} viewport={viewport} />

      {/* Per-segment controls: an always-visible play button at the segment start
          (near the bottom, like SayMore) and a hover-only ignore toggle up top. */}
      {segments.map((seg, i) => {
        const startX = secondsToPx(seg.range.start);
        const width = secondsToPx(seg.range.end - seg.range.start);
        const ignored = isSegmentIgnored(seg);
        return (
          <div key={`ctl-${i}`} onMouseEnter={() => vm.setHoveredSegment(i)}>
            <IconButton
              title={t("segmenter.playSegment", "Listen to this segment")}
              onClick={() => vm.playSegment(i)}
              sx={playButtonSx}
              style={{ left: startX + 3 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2 1 L11 6 L2 11 Z" fill="#2e7d32" />
              </svg>
            </IconButton>
            <IconButton
              title={t("segmenter.ignore", "Ignore this segment")}
              aria-pressed={ignored}
              onClick={() => vm.toggleIgnore(i)}
              sx={{
                ...ignoreButtonSx,
                background: ignored ? "#d9a441" : "#fff",
                opacity: ignored ? 1 : 0,
                "&:hover": { opacity: 1, background: ignored ? "#d9a441" : "#fff" },
              }}
              style={{ left: startX + 3, width: Math.max(0, width - 6) }}
            >
              {ignored ? "🚫" : "◻"}
            </IconButton>
          </div>
        );
      })}

      {/* Boundary lines: click to select, drag to move. Movable boundaries are
          lameta-orange; immovable ones (segment already has an oral recording)
          are blue — matching SayMore. Selected boundaries get pennant grips at
          top and bottom. */}
      {segments.map((seg, i) => {
        const isDragging = drag?.index === i;
        const boundarySec = isDragging ? drag!.currentSec : seg.range.end;
        const x = secondsToPx(boundarySec);
        const selected = vm.selectedBoundaryIndex === i;
        const color = vm.isBoundaryImmovable(i) ? LAMETA_DARK_BLUE : LAMETA_ORANGE;
        const hitWidth = selected ? 18 : 9;
        const lineWidth = 2;
        return (
          <div
            key={`b-${i}`}
            // Stable hooks so the boundary line can be located for automated/headless
            // driving and assertions, not just pixel-hunted.
            data-testid={`boundary-${i}`}
            data-boundary-index={i}
            data-boundary-sec={boundarySec}
            data-selected={selected || undefined}
            onPointerDown={(e) => onBoundaryPointerDown(e, i)}
            onPointerMove={onBoundaryPointerMove}
            onPointerUp={onBoundaryPointerUp}
            css={css`
              position: absolute;
              top: 0;
              height: ${height}px;
              width: ${hitWidth}px;
              margin-left: ${-hitWidth / 2}px;
              display: flex;
              justify-content: center;
              cursor: col-resize;
              pointer-events: auto;
            `}
            style={{ left: x }}
          >
            {/* the vertical line */}
            <div
              css={css`
                position: absolute;
                top: 0;
                width: ${lineWidth}px;
                height: 100%;
                background: ${color};
              `}
            />
            {selected && (
              <>
                <div css={pennantCss(true, color)} />
                <div css={pennantCss(false, color)} />
                <div
                  css={css`
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 12px;
                    height: 2px;
                    background: ${color};
                  `}
                />
              </>
            )}
          </div>
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

/**
 * A pennant grip at the top (or bottom) of a selected boundary — a rectangle
 * tapering to a point toward the waveform center, mirroring SayMore's selected-
 * boundary marker (shape only, no gradient shading).
 */
function pennantCss(top: boolean, color: string) {
  const clip = top
    ? "polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%)"
    : "polygon(50% 0, 100% 32%, 100% 100%, 0 100%, 0 32%)";
  return css`
    position: absolute;
    ${top ? "top: 0;" : "bottom: 0;"}
    width: 14px;
    height: 22px;
    background: ${color};
    clip-path: ${clip};
  `;
}

const playButtonSx = {
  position: "absolute",
  bottom: "3px",
  width: 20,
  height: 20,
  p: 0,
  border: "1px solid #2e7d32",
  borderRadius: "3px",
  background: "#fff",
  pointerEvents: "auto",
  "&:hover": { background: "#eef6ee" },
} as const;

const ignoreButtonSx = {
  position: "absolute",
  top: "2px",
  height: 20,
  fontSize: 11,
  lineHeight: 1,
  p: "2px 5px",
  minWidth: 0,
  border: "1px solid #90a4ae",
  borderRadius: "3px",
  pointerEvents: "auto",
  transition: "opacity 0.1s",
  maxWidth: 28,
  overflow: "hidden",
} as const;
