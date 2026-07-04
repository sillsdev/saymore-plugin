/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import { decodeWav, type DecodedWav } from "../../audio/wavCodec";
import { PIXELS_PER_SECOND_AT_100 } from "../../model/SayMoreConstants";
import { LAMETA_DARK_BLUE, LAMETA_DARK_GREEN, LAMETA_UI_FONT } from "../../lametaTheme";
import { PlaybackCursor } from "../waveform/PlaybackCursor";
import { drawMiniWaveform } from "../recorder/miniWaveform";
import { clipCursorXPx } from "../recorder/playbackCursor";
import { StubButton } from "../shell/stub";
import { downsampleChannels, splitOralAnnotationsChannels } from "./oralAnnotationsLayout";
import { formatPosTotal } from "./timeReadout";
import regenerateIconUrl from "./icons/RegenerateAnnotationFile.png";

const ROW_HEIGHT = 56;
const LABEL_WIDTH = 90;

/**
 * The Oral Annotations viewer: SayMore's read-only look at the combined
 * `<media>.oralAnnotations.wav` — three stacked labeled waveform rows
 * (Source/Careful/Translation, one channel group each per
 * `generateOralAnnotationsWav`'s layout) sharing one time axis, a single
 * playback cursor spanning all three, and a `pos / total` readout. No zoom
 * (SayMore's viewer doesn't have one) — fixed fit-with-hscroll.
 */
export const OralAnnotationsViewerView = observer(function OralAnnotationsViewerView(props: {
  store: ProjectStore;
}) {
  const { store } = props;
  const viewer = store.oralViewer;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);

  // One <audio> element on a blob URL of the combined file per byte version —
  // the browser downmixes the multichannel WAV for playback (SayMore just
  // plays the file too).
  useEffect(() => {
    const bytes = viewer?.bytes;
    setIsPlaying(false);
    setPositionSec(0);
    if (!bytes) {
      audioRef.current = null;
      return;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }));
    const audio = new Audio(url);
    audioRef.current = audio;
    const onTime = (): void => setPositionSec(audio.currentTime);
    const onEnded = (): void => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      URL.revokeObjectURL(url);
      audioRef.current = null;
    };
  }, [viewer?.bytes]);

  if (!viewer) return null;

  function handlePlay(): void {
    void audioRef.current?.play();
    setIsPlaying(true);
  }
  function handleStop(): void {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setIsPlaying(false);
  }

  const decoded = viewer.bytes ? safeDecodeWav(viewer.bytes) : undefined;
  const sourceChannelCount = store.envelope?.channels.length ?? 1;
  const groups = decoded
    ? splitOralAnnotationsChannels(decoded.channels, sourceChannelCount)
    : undefined;
  const contentWidthPx = Math.max(1, Math.round(viewer.durationSec * PIXELS_PER_SECOND_AT_100));
  // The cursor is a sibling of the label+canvas Rows inside one wrapper (see
  // below), so its x is relative to that whole grid — offset past the label
  // column so it anchors inside the waveform column (x=0 at the canvas'
  // left edge), not over the row labels.
  const cursorX = LABEL_WIDTH + clipCursorXPx(positionSec, viewer.durationSec, contentWidthPx);

  return (
    <div
      css={css`
        border: 1px solid #b7d59b;
        font-family: ${LAMETA_UI_FONT};
      `}
    >
      <div
        css={css`
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: #e4f0d5;
          border-bottom: 1px solid #b7d59b;
        `}
      >
        <Button
          data-testid="oralann-play"
          variant="contained"
          disableElevation
          disabled={!viewer.bytes || isPlaying}
          onClick={handlePlay}
          sx={toolbarButtonSx("#2e7d32", "#fff")}
        >
          ▶ {t("oralann.play", "Play")}
        </Button>
        <Button
          data-testid="oralann-stop"
          variant="outlined"
          disabled={!isPlaying}
          onClick={handleStop}
          sx={toolbarButtonSx("#90a4ae", "#37474f")}
        >
          ⏹ {t("oralann.stop", "Stop")}
        </Button>
        <span css={css({ flex: 1 })} />
        {viewer.isRegenerating && (
          <CircularProgress
            size={16}
            variant={viewer.regenerateProgress != null ? "determinate" : "indeterminate"}
            value={(viewer.regenerateProgress ?? 0) * 100}
          />
        )}
        <Button
          data-testid="oralann-regenerate"
          variant="outlined"
          disabled={viewer.isRegenerating}
          onClick={() => void viewer.regenerate()}
          sx={toolbarButtonSx("#90a4ae", "#37474f")}
        >
          <img
            src={regenerateIconUrl}
            alt=""
            width={14}
            height={14}
            css={css({ marginRight: 4 })}
          />
          {t("oralann.regenerate", "Regenerate")}
        </Button>
        <StubButton feature={t("annotations.help", "Help")}>?</StubButton>
      </div>

      <div
        css={css`
          overflow-x: auto;
        `}
      >
        {groups ? (
          <div
            css={css`
              position: relative;
              width: fit-content;
              min-width: 100%;
            `}
          >
            <Row
              testId="oralann-row-source"
              label={t("oralann.source", "Source")}
              color={LAMETA_DARK_BLUE}
              channels={groups.source}
              widthPx={contentWidthPx}
            />
            <Row
              testId="oralann-row-careful"
              label={t("oralann.careful", "Careful")}
              color={LAMETA_DARK_GREEN}
              channels={[groups.careful]}
              widthPx={contentWidthPx}
            />
            <Row
              testId="oralann-row-translation"
              label={t("oralann.translation", "Translation")}
              color={LAMETA_DARK_GREEN}
              channels={[groups.translation]}
              widthPx={contentWidthPx}
            />
            <PlaybackCursor
              testId="oralann-cursor"
              xPx={cursorX}
              height={ROW_HEIGHT * 3}
              color="#43a047"
              visible={isPlaying}
            />
          </div>
        ) : (
          <p
            css={css`
              padding: 12px;
              color: ${viewer.error ? "#c62828" : "#78909c"};
            `}
          >
            {viewer.loading || viewer.isRegenerating
              ? t("harness.loading", "Loading…")
              : (viewer.error ?? t("oralann.notGenerated", "Not generated yet."))}
          </p>
        )}
      </div>

      <div
        data-testid="oralann-time-readout"
        css={css`
          padding: 4px 10px;
          text-align: right;
          font-size: 12px;
          color: #607d8b;
          border-top: 1px solid #b7d59b;
        `}
      >
        {formatPosTotal(positionSec, viewer.durationSec)}
      </div>
    </div>
  );
});

function Row(props: {
  testId: string;
  label: string;
  color: string;
  channels: Float32Array[];
  widthPx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = downsampleChannels(props.channels, props.widthPx, ROW_HEIGHT);
    drawMiniWaveform(canvas, points, props.color);
  }, [props.channels, props.widthPx, props.color]);

  return (
    <div
      data-testid={props.testId}
      css={css`
        display: flex;
        align-items: stretch;
        height: ${ROW_HEIGHT}px;
        border-bottom: 1px solid #eceff1;
      `}
    >
      <div
        css={css`
          display: flex;
          align-items: center;
          justify-content: flex-end;
          width: ${LABEL_WIDTH}px;
          padding-right: 8px;
          font-size: 12px;
          font-weight: 600;
          color: #37474f;
          background: #f4f7f0;
          border-right: 1px solid #b7d59b;
          flex-shrink: 0;
        `}
      >
        {props.label}
      </div>
      <canvas ref={canvasRef} width={props.widthPx} height={ROW_HEIGHT} />
    </div>
  );
}

function safeDecodeWav(bytes: Uint8Array): DecodedWav | undefined {
  try {
    return decodeWav(bytes);
  } catch {
    return undefined;
  }
}

function toolbarButtonSx(borderColor: string, color: string) {
  return {
    textTransform: "none",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    gap: "4px",
    py: "3px",
    px: "10px",
    color,
    borderColor,
    "&.Mui-disabled": { opacity: 0.5 },
  } as const;
}
