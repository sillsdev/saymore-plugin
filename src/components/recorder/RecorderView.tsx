/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import Button from "@mui/material/Button";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import { MediaElementPlaybackEngine } from "../../audio/PlaybackEngine";
import { WaveformSurface, type Viewport } from "../waveform/WaveformSurface";
import { ListenSpeakButtons } from "./ListenSpeakButtons";
import { PeakMeter } from "./PeakMeter";
import { recorderKeyAction, type RecorderAction } from "./recorderKeys";
import {
  NEW_BOUNDARY_NUDGE_MS,
  PIXELS_PER_SECOND_AT_100,
  SELECTED_SEGMENT_HIGHLIGHT_COLOR,
} from "../../model/SayMoreConstants";
import { LAMETA_DARK_GREEN, LAMETA_UI_FONT } from "../../lametaTheme";

/** Height reserved for the annotation cells strip; AnnotationCellsLayer (C4) fills it in. */
const CELLS_ROW_HEIGHT = 72;

/**
 * The Careful Speech / Oral Translation recorder: SayMore's two-row layout —
 * the segmented source waveform on top (current-segment Moccasin highlight,
 * unsegmented remainder tinted) with the per-segment annotation cells strip
 * below it (pixel-aligned to the same {@link Viewport}), and a left gutter of
 * press-and-hold Listen/Speak buttons + the live mic meter. Space/`b`/arrows/
 * Esc/undo-redo are wired through the pure {@link recorderKeyAction} map.
 */
export const RecorderView = observer(function RecorderView(props: { store: ProjectStore }) {
  const { store } = props;
  const vm = store.recorder;
  const rootRef = useRef<HTMLDivElement>(null);

  // Focus on mount so the keyboard model works without a click first — matters
  // most inside the lameta iframe, which starts out unfocused.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Listened on `window` (not React's onKeyDown) so Space/Esc/etc. still fire
  // even if focus has landed on a child control (e.g. after clicking a cell
  // button) — SayMore's push-to-talk model is global to the dialog, not
  // per-element. Torn down on unmount so a closed recorder never eats keys.
  useEffect(() => {
    if (!vm) return;
    function dispatch(e: KeyboardEvent, phase: "down" | "up"): void {
      const action = recorderKeyAction(
        e.key,
        phase,
        e.repeat,
        vm!.mode,
        vm!.currentIndex === "new",
        { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey },
      );
      if (!action) return;
      e.preventDefault();
      runRecorderAction(vm!, action);
    }
    const onKeyDown = (e: KeyboardEvent): void => dispatch(e, "down");
    const onKeyUp = (e: KeyboardEvent): void => dispatch(e, "up");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [vm]);

  if (!vm) return null; // openRecorder()'s preconditions failed; nothing to drive.

  const title =
    vm.kind === "Careful"
      ? t("recorder.titleCareful", "Careful Speech Recorder")
      : t("recorder.titleTranslation", "Oral Translation Recorder");
  const mediaElement =
    vm.playback instanceof MediaElementPlaybackEngine ? vm.playback.mediaElement : undefined;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      css={css`
        border: 1px solid #b7d59b;
        font-family: ${LAMETA_UI_FONT};
        outline: none;
      `}
    >
      <div
        css={css`
          display: flex;
          align-items: center;
          padding: 6px 10px;
          background: #eaf3e0;
          border-bottom: 1px solid #b7d59b;
        `}
      >
        <Button
          variant="outlined"
          onClick={() => store.closeRecorder()}
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            gap: "6px",
            py: "3px",
            px: "10px",
            color: "#33691e",
            background: "#fff",
            borderColor: "#b7d59b",
            "&:hover": { borderColor: "#8dbf63", background: "#fff" },
          }}
        >
          ← {t("annotations.backToTranscriptions", "Back to transcriptions")}
        </Button>
        <span
          css={css`
            margin-left: 200px;
            font-size: 14px;
            font-weight: bold;
            color: #33691e;
          `}
        >
          {title}
        </span>
      </div>

      <div
        css={css`
          display: flex;
        `}
      >
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 10px 8px;
            background: #f4f7f0;
            border-right: 1px solid #b7d59b;
          `}
        >
          <ListenSpeakButtons vm={vm} />
          <PeakMeter vm={vm} />
        </div>

        <div
          css={css`
            flex: 1;
            min-width: 0;
          `}
        >
          <WaveformSurface
            durationSec={store.envelope?.durationSec ?? 0}
            envelope={store.envelope}
            mediaElement={mediaElement}
            minPxPerSec={PIXELS_PER_SECOND_AT_100}
            overlay={(viewport) => <RecorderOverlay vm={vm} viewport={viewport} />}
          />
          <div
            data-testid="recorder-cells-row"
            css={css`
              height: ${CELLS_ROW_HEIGHT}px;
              background: #fafafa;
              border-top: 1px solid #b7d59b;
            `}
          >
            {/* AnnotationCellsLayer lands in the next Track C commit (C4). */}
          </div>
        </div>
      </div>

      <HintStrip vm={vm} />
    </div>
  );
});

function runRecorderAction(vm: RecorderViewModel, action: RecorderAction): void {
  switch (action) {
    case "listenDown":
      vm.listenDown();
      break;
    case "listenUp":
      vm.listenUp();
      break;
    case "speakDown":
      vm.speakDown();
      break;
    case "speakUp":
      void vm.speakUp();
      break;
    case "replay":
      vm.replayCurrentSource();
      break;
    case "nudgeNewBoundaryLeft":
      vm.nudgeNewBoundary(-NEW_BOUNDARY_NUDGE_MS);
      break;
    case "nudgeNewBoundaryRight":
      vm.nudgeNewBoundary(NEW_BOUNDARY_NUDGE_MS);
      break;
    case "abort":
      vm.abortRecording();
      break;
    case "undo":
      vm.undo();
      break;
    case "redo":
      vm.redo();
      break;
  }
}

/**
 * Current-segment (or virtual new-boundary) Moccasin highlight, plus a light
 * tint over the unsegmented remainder so it reads as distinct from annotated
 * source — both positioned in the same content coordinates as the wave.
 */
const RecorderOverlay = observer(function RecorderOverlay(props: {
  vm: RecorderViewModel;
  viewport: Viewport;
}) {
  const { vm, viewport } = props;
  const cells = vm.cells;
  const lastSegmentEnd = cells.length > 0 ? cells[cells.length - 1].range.end : 0;
  const unsegmentedX = viewport.secondsToPx(lastSegmentEnd);

  const currentCell = cells.find((c) => c.isCurrent);
  const highlight =
    vm.currentIndex === "new"
      ? { startSec: lastSegmentEnd, endSec: vm.newSegmentEndSec }
      : currentCell
        ? { startSec: currentCell.range.start, endSec: currentCell.range.end }
        : undefined;

  return (
    <>
      <div
        css={css`
          position: absolute;
          top: 0;
          height: ${viewport.height}px;
          background: rgba(96, 125, 139, 0.08);
          pointer-events: none;
        `}
        style={{ left: unsegmentedX, width: Math.max(0, viewport.contentWidth - unsegmentedX) }}
      />

      {highlight && (
        <div
          css={css`
            position: absolute;
            top: 0;
            height: ${viewport.height}px;
            background: ${SELECTED_SEGMENT_HIGHLIGHT_COLOR};
            opacity: 0.65;
            pointer-events: none;
          `}
          style={{
            left: viewport.secondsToPx(highlight.startSec),
            width: Math.max(
              0,
              viewport.secondsToPx(highlight.endSec) - viewport.secondsToPx(highlight.startSec),
            ),
          }}
        />
      )}
    </>
  );
});

/** Bottom info strip: listen/record hints, the too-short warning, error, or Done. */
const HintStrip = observer(function HintStrip(props: { vm: RecorderViewModel }) {
  const { vm } = props;
  const rowCss = css`
    padding: 6px 10px;
    font-size: 12px;
    border-top: 1px solid #b7d59b;
    background: #fff;
  `;

  if (vm.mode === "Error") {
    return (
      <div css={rowCss}>
        <span css={css({ color: "#c62828" })}>
          ⚠ {vm.warning ?? t("recorder.deviceError", "The microphone was disconnected.")}
        </span>
      </div>
    );
  }

  if (vm.mode === "Done") {
    return (
      <div css={rowCss}>
        <span css={css({ color: LAMETA_DARK_GREEN, fontWeight: 600 })}>
          ✓ {t("recorder.done", "Finished")}
        </span>
      </div>
    );
  }

  return (
    <div css={rowCss}>
      ℹ{" "}
      {vm.mode === "Record"
        ? t("recorder.recordHint", "To record, press and hold the SPACE BAR.")
        : t(
            "recorder.listenHint",
            "To listen to the source recording, press and hold the SPACE BAR.",
          )}
      {vm.warning && (
        <span
          css={css`
            margin-left: 12px;
            color: #c62828;
          `}
        >
          {vm.warning}
        </span>
      )}
    </div>
  );
});
