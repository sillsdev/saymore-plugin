/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { LAMETA_DARK_BLUE } from "../../lametaTheme";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { Viewport } from "../waveform/WaveformSurface";

interface DragState {
  startClientX: number;
  startEndSec: number;
  currentSec: number;
}

/**
 * The virtual end-boundary of the unsegmented remainder — only rendered while
 * `vm.currentIndex === "new"`. Dragging previews locally (so it tracks the
 * pointer at 1:1 without waiting on the VM round-trip); the VM's own clamping
 * (≥460ms past the last segment, ≤ media end) applies on release.
 */
export const NewSegmentBoundaryLayer = observer(function NewSegmentBoundaryLayer(props: {
  vm: RecorderViewModel;
  viewport: Viewport;
}) {
  const { vm, viewport } = props;
  const [drag, setDrag] = useState<DragState | null>(null);

  if (vm.currentIndex !== "new") return null;

  const sec = drag ? drag.currentSec : vm.newSegmentEndSec;
  const x = viewport.secondsToPx(sec);

  function onPointerDown(e: React.PointerEvent): void {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      startClientX: e.clientX,
      startEndSec: vm.newSegmentEndSec,
      currentSec: vm.newSegmentEndSec,
    });
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startClientX) / viewport.pxPerSec;
    setDrag({ ...drag, currentSec: drag.startEndSec + deltaSec });
  }

  function onPointerUp(e: React.PointerEvent): void {
    if (!drag) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    vm.dragNewBoundaryTo(drag.currentSec);
    setDrag(null);
  }

  return (
    <div
      data-testid="new-segment-boundary"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      css={css`
        position: absolute;
        top: 0;
        height: ${viewport.height}px;
        width: 9px;
        margin-left: -4px;
        cursor: col-resize;
        pointer-events: auto;
      `}
      style={{ left: x }}
    >
      <div
        css={css`
          position: absolute;
          top: 0;
          left: 4px;
          width: 2px;
          height: 100%;
          background: ${LAMETA_DARK_BLUE};
        `}
      />
    </div>
  );
});
