/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { t } from "../../l10n";
import { NUDGE_MS } from "../../model/SayMoreConstants";
import { MediaElementPlaybackEngine } from "../../audio/PlaybackEngine";
import type { ProjectStore } from "../../state/ProjectStore";
import { WaveformSurface, type WaveformSurfaceApi } from "../waveform/WaveformSurface";
import { BoundaryLayer } from "../waveform/BoundaryLayer";
import { SegmenterToolbar } from "./SegmenterToolbar";

/**
 * The Manual Segmenter tool: waveform + interaction overlay + toolbar, wired to
 * the SayMore keyboard model. Space = listen/stop, Enter = add boundary,
 * Delete = remove selected boundary, ←/→ = nudge ±5ms (with delayed replay),
 * Ctrl+1/2/3 = zoom in/reset/out, Z/Ctrl+Z = undo. Edits persist continuously
 * (the ViewModel auto-saves), so there is no save button.
 */
export const ManualSegmenterView = observer(function ManualSegmenterView(props: {
  store: ProjectStore;
  /** Root height. Defaults to the full viewport (embedded tab); the host
   * simulator passes a bounded height so it sits inside the Annotations pane. */
  height?: string;
}) {
  const { store } = props;
  const height = props.height ?? "100vh";
  const vm = store.segmenter!;
  const surfaceRef = useRef<WaveformSurfaceApi>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Push zoom changes into the renderer.
  useEffect(() => {
    surfaceRef.current?.setZoom(vm.minPxPerSec);
  }, [vm.minPxPerSec]);

  // Focus on mount so the keyboard model works without a click.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Ctrl + mouse-wheel zooms the waveform (a non-passive listener so we can
  // preventDefault the browser's page-zoom gesture).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) vm.zoomIn();
      else vm.zoomOut();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vm]);

  // Dev-only harness handle (stripped from production builds) so the segmenter
  // can be driven from the console / an automated smoke test.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __seg?: unknown }).__seg = vm;
    }
  }, [vm]);

  const mediaElement =
    vm.playback instanceof MediaElementPlaybackEngine ? vm.playback.mediaElement : undefined;

  function onKeyDown(e: React.KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case " ":
        e.preventDefault();
        vm.togglePlay();
        break;
      case "Enter":
        e.preventDefault();
        vm.addBoundaryAtCursor();
        break;
      case "Tab":
        // Keyboard boundary selection: cycle without having to click the 1px line.
        e.preventDefault();
        vm.cycleSelectedBoundary(e.shiftKey ? -1 : 1);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (vm.selectedBoundaryIndex >= 0) {
          if (
            !vm.requiresPermanenceConfirm(vm.selectedBoundaryIndex) ||
            window.confirm(
              t(
                "segmenter.confirmDelete",
                "A segment here has an oral annotation recording. Delete this boundary and its recordings?",
              ),
            )
          ) {
            vm.deleteSelectedBoundary();
          }
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        vm.nudgeSelected(-NUDGE_MS);
        break;
      case "ArrowRight":
        e.preventDefault();
        vm.nudgeSelected(NUDGE_MS);
        break;
      case "1":
        if (ctrl) {
          e.preventDefault();
          vm.zoomIn();
        }
        break;
      case "2":
        if (ctrl) {
          e.preventDefault();
          vm.zoomReset();
        }
        break;
      case "3":
        if (ctrl) {
          e.preventDefault();
          vm.zoomOut();
        }
        break;
      case "z":
      case "Z":
        e.preventDefault();
        if (ctrl && e.shiftKey) vm.redo();
        else vm.undo();
        break;
      case "y":
      case "Y":
        if (ctrl) {
          e.preventDefault();
          vm.redo();
        }
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      css={css`
        outline: none;
        display: flex;
        flex-direction: column;
        height: ${height};
        font-family: system-ui, sans-serif;
      `}
    >
      <div
        css={css`
          padding: 12px 12px 0;
        `}
      >
        <WaveformSurface
          ref={surfaceRef}
          envelope={store.envelope}
          durationSec={vm.durationSec}
          mediaElement={mediaElement}
          mediaUrl={store.mediaUrl}
          minPxPerSec={vm.minPxPerSec}
          onSeek={(seconds) => vm.setCursor(seconds)}
          overlay={(viewport) => <BoundaryLayer vm={vm} viewport={viewport} />}
        />
      </div>

      {vm.warning && (
        <div
          css={css`
            padding: 6px 10px;
            background: #ffebee;
            color: #c62828;
            font-weight: 600;
            font-size: 13px;
          `}
        >
          {vm.warning}
        </div>
      )}

      <SegmenterToolbar vm={vm} />
    </div>
  );
});
