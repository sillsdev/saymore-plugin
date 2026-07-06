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
import {
  downsampleChannels,
  seekPositionSec,
  splitOralAnnotationsChannels,
} from "./oralAnnotationsLayout";
import { formatPosTotal } from "./timeReadout";
import { RefreshIcon } from "./RefreshIcon";

const ROW_HEIGHT = 56;
const LABEL_WIDTH = 90;
/**
 * Chromium refuses to rasterize a `<canvas>` whose width exceeds ~32767px and
 * paints a broken-image icon instead. A combined file at
 * {@link PIXELS_PER_SECOND_AT_100} (80 px/s) crosses that at only ~6.8 minutes,
 * so we cap the canvas *backing* width here and CSS-stretch it to the full
 * logical width — the waveform loses a little horizontal resolution on very long
 * files but keeps rendering (and the cursor/seek math, all in logical px, is
 * unaffected). Kept safely under the hard limit.
 */
const MAX_CANVAS_PX = 32000;

/**
 * The Oral Annotations viewer: SayMore's read-only look at the combined
 * `<media>.oralAnnotations.wav` — three stacked labeled waveform rows
 * (Source/Careful/Translation, one channel group each per
 * `generateOralAnnotationsWav`'s layout) sharing one time axis, a single
 * playback cursor spanning all three, click-to-seek while stopped, and a
 * `pos / total` readout. No zoom (SayMore's viewer doesn't have one) — fixed
 * fit-with-hscroll.
 */
export const OralAnnotationsViewerView = observer(function OralAnnotationsViewerView(props: {
  store: ProjectStore;
}) {
  const { store } = props;
  const viewer = store.oralViewer;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);

  // One <audio> element on a blob URL of the combined file per byte version —
  // the browser downmixes the multichannel WAV for playback (SayMore just
  // plays the file too). `timeupdate` (~4-66Hz) drives the text readout only;
  // the cursor's own smoothness comes from the rAF loop below.
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

  const contentWidthPx = Math.max(
    1,
    Math.round((viewer?.durationSec ?? 0) * PIXELS_PER_SECOND_AT_100),
  );

  // Smooth cursor: while playing, move it via a rAF loop writing
  // style.transform directly on the forwarded ref — a compositor-only
  // change, unlike `timeupdate`-driven React state (~4-66Hz, visibly jumpy,
  // and `left` would relayout every update).
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = (): void => {
      const audio = audioRef.current;
      const cursor = cursorRef.current;
      if (audio && cursor) {
        const x = clipCursorXPx(audio.currentTime, viewer?.durationSec ?? 0, contentWidthPx);
        cursor.style.transform = `translateX(${x}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, viewer?.durationSec, contentWidthPx]);

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
  /** Click-to-seek: only while stopped (SayMore parity); Play resumes from here. */
  function handleSeek(e: React.MouseEvent<HTMLDivElement>): void {
    if (isPlaying || !viewer?.durationSec) return;
    const offsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const seconds = seekPositionSec(offsetPx, contentWidthPx, viewer.durationSec);
    setPositionSec(seconds);
    if (audioRef.current) audioRef.current.currentTime = seconds;
  }

  const decoded = viewer.bytes ? safeDecodeWav(viewer.bytes) : undefined;
  const sourceChannelCount = store.envelope?.channels.length ?? 1;
  const groups = decoded
    ? splitOralAnnotationsChannels(decoded.channels, sourceChannelCount)
    : undefined;
  const cursorX = clipCursorXPx(positionSec, viewer.durationSec, contentWidthPx);

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
          variant={isPlaying ? "outlined" : "contained"}
          disableElevation
          disabled={!viewer.bytes || isPlaying}
          onClick={handlePlay}
          sx={transportButtonSx(!isPlaying)}
        >
          ▶ {t("oralann.play", "Play")}
        </Button>
        <Button
          data-testid="oralann-stop"
          variant={isPlaying ? "contained" : "outlined"}
          disableElevation
          disabled={!isPlaying}
          onClick={handleStop}
          sx={transportButtonSx(isPlaying)}
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
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            gap: "4px",
            py: "3px",
            px: "10px",
            color: "#37474f",
            borderColor: "#90a4ae",
            "&.Mui-disabled": { opacity: 0.5 },
          }}
        >
          <RefreshIcon size={14} />
          {t("oralann.regenerate", "Regenerate")}
        </Button>
      </div>

      <div
        css={css`
          overflow-x: auto;
        `}
      >
        {groups ? (
          <div css={css({ display: "flex" })}>
            <div
              css={css`
                display: flex;
                flex-direction: column;
                flex-shrink: 0;
                width: ${LABEL_WIDTH}px;
              `}
            >
              <RowLabel>{t("oralann.source", "Source")}</RowLabel>
              <RowLabel>{t("oralann.careful", "Careful")}</RowLabel>
              <RowLabel>{t("oralann.translation", "Translation")}</RowLabel>
            </div>
            <div
              onClick={handleSeek}
              css={css`
                position: relative;
                width: fit-content;
                cursor: ${isPlaying ? "default" : "pointer"};
              `}
            >
              <RowCanvas
                testId="oralann-row-source"
                color={LAMETA_DARK_BLUE}
                channels={groups.source}
                widthPx={contentWidthPx}
              />
              <RowCanvas
                testId="oralann-row-careful"
                color={LAMETA_DARK_GREEN}
                channels={[groups.careful]}
                widthPx={contentWidthPx}
              />
              <RowCanvas
                testId="oralann-row-translation"
                color={LAMETA_DARK_GREEN}
                channels={[groups.translation]}
                widthPx={contentWidthPx}
              />
              <PlaybackCursor
                ref={cursorRef}
                testId="oralann-cursor"
                xPx={cursorX}
                height={ROW_HEIGHT * 3}
                color="#43a047"
                visible={isPlaying || positionSec > 0}
              />
            </div>
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

function RowLabel(props: { children: React.ReactNode }) {
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: flex-end;
        height: ${ROW_HEIGHT}px;
        padding-right: 8px;
        font-size: 12px;
        font-weight: 600;
        color: #37474f;
        background: #f4f7f0;
        border-right: 1px solid #b7d59b;
        border-bottom: 1px solid #eceff1;
      `}
    >
      {props.children}
    </div>
  );
}

function RowCanvas(props: {
  testId: string;
  color: string;
  channels: Float32Array[];
  widthPx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Backing store is capped (see MAX_CANVAS_PX); the element is then CSS-stretched
  // to the full logical width so it still spans the row and lines up with the cursor.
  const backingWidth = Math.min(props.widthPx, MAX_CANVAS_PX);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = downsampleChannels(props.channels, backingWidth, ROW_HEIGHT);
    drawMiniWaveform(canvas, points, props.color);
  }, [props.channels, backingWidth, props.color]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={props.testId}
      width={backingWidth}
      height={ROW_HEIGHT}
      style={{ width: props.widthPx }}
      css={css`
        display: block;
        border-bottom: 1px solid #eceff1;
      `}
    />
  );
}

function safeDecodeWav(bytes: Uint8Array): DecodedWav | undefined {
  try {
    return decodeWav(bytes);
  } catch {
    return undefined;
  }
}

function transportButtonSx(engaged: boolean) {
  return {
    textTransform: "none",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    gap: "4px",
    py: "3px",
    px: "10px",
    ...(engaged
      ? {
          background: LAMETA_DARK_GREEN,
          color: "#fff",
          borderColor: LAMETA_DARK_GREEN,
          "&:hover": { background: LAMETA_DARK_GREEN },
        }
      : { color: LAMETA_DARK_GREEN, borderColor: LAMETA_DARK_GREEN }),
    "&.Mui-disabled": { opacity: 0.5 },
  } as const;
}
