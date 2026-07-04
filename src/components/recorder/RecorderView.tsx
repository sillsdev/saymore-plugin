/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import { MediaElementPlaybackEngine } from "../../audio/PlaybackEngine";
import {
  WaveformSurface,
  type Viewport,
  type WaveformSurfaceApi,
} from "../waveform/WaveformSurface";
import { PlaybackCursor } from "../waveform/PlaybackCursor";
import { AnnotationCellsLayer } from "./AnnotationCellsLayer";
import { ListenButton, SpeakButton } from "./ListenSpeakButtons";
import { NewSegmentBoundaryLayer } from "./NewSegmentBoundaryLayer";
import { PeakMeter } from "./PeakMeter";
import { sourceCursorXPx } from "./playbackCursor";
import { SourceSegmentControls } from "./SourceSegmentControls";
import { recorderKeyAction, type RecorderAction } from "./recorderKeys";
import {
  NEW_BOUNDARY_NUDGE_MS,
  PIXELS_PER_SECOND_AT_100,
  SELECTED_SEGMENT_HIGHLIGHT_COLOR,
} from "../../model/SayMoreConstants";
import {
  LAMETA_BLUE,
  LAMETA_DARK_BLUE,
  LAMETA_DARK_GREEN,
  LAMETA_GREEN,
  LAMETA_UI_FONT,
} from "../../lametaTheme";

/** Height of the annotation cells strip below the waveform (and its left-column twin). */
const CELLS_ROW_HEIGHT = 104;
/** Fixed width of the left label+button column (identical in both grid rows). */
const LEFT_COLUMN_WIDTH = 96;
const ROW_BORDER = "1px solid #b7d59b";

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
  const surfaceRef = useRef<WaveformSurfaceApi>(null);
  // Mirrors the waveform's live viewport so the cells strip below it stays
  // pixel-aligned as the wave scrolls (the two rows are separate scroll
  // regions — WaveformSurface owns the only native scrollbar). Note: this
  // updates on scroll/zoom but not on a bare window resize.
  const [cellsViewport, setCellsViewport] = useState<Viewport | undefined>(undefined);

  // Focus on mount so the keyboard model works without a click first — matters
  // most inside the lameta iframe, which starts out unfocused.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const api = surfaceRef.current;
    if (!api) return;
    const sync = (): void => setCellsViewport(surfaceRef.current?.getViewport());
    sync();
    const unsubScroll = api.onScroll(sync);
    const unsubZoom = api.onZoom(sync);
    return () => {
      unsubScroll();
      unsubZoom();
    };
  }, [store.envelope, vm]);

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

      {/* Strict 2x2 table: [source label+Listen] [source waveform] over
          [annotation label+Speak+meter] [annotation cells], full-height
          separators on both axes so it reads as a four-cell table. */}
      <div
        css={css`
          display: grid;
          grid-template-columns: ${LEFT_COLUMN_WIDTH}px 1fr;
          grid-template-rows: auto auto;
        `}
      >
        <RowLabelCell background="#eef2fa" borderRight borderBottom>
          <RowLabel color={LAMETA_DARK_BLUE}>{t("recorder.sourceAudio", "Source Audio")}</RowLabel>
          <ListenButton vm={vm} />
        </RowLabelCell>

        <div
          css={css`
            border-bottom: ${ROW_BORDER};
            min-width: 0;
          `}
        >
          <WaveformSurface
            ref={surfaceRef}
            durationSec={store.envelope?.durationSec ?? 0}
            envelope={store.envelope}
            mediaElement={mediaElement}
            minPxPerSec={PIXELS_PER_SECOND_AT_100}
            waveColor={LAMETA_DARK_BLUE}
            overlay={(viewport) => <RecorderOverlay vm={vm} viewport={viewport} />}
          />
        </div>

        <RowLabelCell background="#e9f4dc" borderRight>
          <RowLabel color={LAMETA_DARK_GREEN}>
            {vm.kind === "Careful"
              ? t("recorder.carefulSpeech", "Careful Speech")
              : t("recorder.oralTranslation", "Oral Translation")}
          </RowLabel>
          <SpeakButton vm={vm} />
          <PeakMeter vm={vm} />
        </RowLabelCell>

        <div
          data-testid="recorder-cells-row"
          css={css`
            position: relative;
            height: ${CELLS_ROW_HEIGHT}px;
            overflow: hidden;
            background: #e4f0d5;
            min-width: 0;
          `}
        >
          {cellsViewport && (
            <div
              css={css`
                position: relative;
                height: 100%;
              `}
              style={{
                width: cellsViewport.contentWidth,
                transform: `translateX(${-cellsViewport.scrollLeft}px)`,
              }}
            >
              <AnnotationCellsLayer vm={vm} viewport={cellsViewport} height={CELLS_ROW_HEIGHT} />
            </div>
          )}
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

/** The label+button cell in the fixed-width left column, identical in both grid rows. */
function RowLabelCell(props: {
  background: string;
  borderRight?: boolean;
  borderBottom?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 4px;
        ${props.borderRight ? `border-right: ${ROW_BORDER};` : ""}
        ${props.borderBottom ? `border-bottom: ${ROW_BORDER};` : ""}
      `}
      style={{ background: props.background }}
    >
      {props.children}
    </div>
  );
}

function RowLabel(props: { color: string; children: React.ReactNode }) {
  return (
    <div
      css={css`
        font-size: 11px;
        font-weight: 700;
        text-align: center;
        line-height: 1.2;
      `}
      style={{ color: props.color }}
    >
      {props.children}
    </div>
  );
}

/**
 * The source row's overlay: a uniform background (the blue comes from the
 * waveform polyline itself, via WaveformSurface's waveColor) with only the
 * current segment (or virtual new-boundary) highlighted Moccasin — John
 * asked to drop the earlier per-segment/segmented-vs-unsegmented background
 * washes. Also the draggable new-boundary line and the per-segment
 * play/Ignored/Undo controls, all in the wave's content coordinates.
 */
const RecorderOverlay = observer(function RecorderOverlay(props: {
  vm: RecorderViewModel;
  viewport: Viewport;
}) {
  const { vm, viewport } = props;
  const cells = vm.cells;
  const lastSegmentEnd = cells.length > 0 ? cells[cells.length - 1].range.end : 0;

  const currentCell = cells.find((c) => c.isCurrent);
  const highlight =
    vm.currentIndex === "new"
      ? { startSec: lastSegmentEnd, endSec: vm.newSegmentEndSec }
      : currentCell
        ? { startSec: currentCell.range.start, endSec: currentCell.range.end }
        : undefined;

  return (
    <>
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

      <SourceSegmentControls vm={vm} viewport={viewport} />
      <NewSegmentBoundaryLayer vm={vm} viewport={viewport} />
      <PlaybackCursor
        xPx={sourceCursorXPx(vm.playback.positionSec, viewport)}
        height={viewport.height}
        visible={vm.playback.isPlaying}
      />
    </>
  );
});

const ERROR_RED = "#c62828";

/**
 * Bottom info strip: a colored banner for the recorder's current mode (light
 * tint + dark text while working, a solid emphatic panel for the two
 * end-states) plus the transient too-short warning as its own row underneath
 * — SayMore keeps that as a separate label so it doesn't get lost inside the
 * hint text.
 */
const HintStrip = observer(function HintStrip(props: { vm: RecorderViewModel }) {
  const { vm } = props;

  return (
    <div>
      {vm.mode === "Error" ? (
        <Banner icon="⚠" background={ERROR_RED} color="#fff" bold>
          {vm.warning ?? t("recorder.deviceError", "The microphone was disconnected.")}
        </Banner>
      ) : vm.mode === "Done" ? (
        <Banner icon="✓" background={LAMETA_DARK_GREEN} color="#fff" bold>
          {t("recorder.done", "Finished")}
        </Banner>
      ) : vm.mode === "Record" ? (
        <Banner icon="ℹ" background={LAMETA_GREEN} color="#1b3a06">
          {t("recorder.recordHint", "To record, press and hold the SPACE BAR.")}
        </Banner>
      ) : (
        <Banner icon="ℹ" background={LAMETA_BLUE} color="#12233f">
          {t(
            "recorder.listenHint",
            "To listen to the source recording, press and hold the SPACE BAR.",
          )}
        </Banner>
      )}

      {/* The too-short flash is transient and layered on top of a working
          mode's banner above — Error/Done already show it as the banner itself. */}
      {vm.warning && vm.mode !== "Error" && (
        <Banner icon="⚠" background="#fdecea" color={ERROR_RED}>
          {vm.warning}
        </Banner>
      )}
    </div>
  );
});

function Banner(props: {
  icon: string;
  background: string;
  color: string;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: ${props.bold ? 600 : 400};
        border-top: 1px solid #b7d59b;
      `}
      style={{ background: props.background, color: props.color }}
    >
      <span aria-hidden>{props.icon}</span>
      <span>{props.children}</span>
    </div>
  );
}
