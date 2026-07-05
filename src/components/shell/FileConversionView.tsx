/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useState } from "react";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import { t } from "../../l10n";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * Shown on the "Start Annotating" tab when the selected media is NOT already PCM WAV.
 * SayMore can only annotate standard WAV, so we offer a one-click conversion to
 * `<basename>_StandardAudio.wav` (run by the host via `api.ffmpeg.run`, which reports a
 * 0→1 fraction so the bar is determinate). The source file is left untouched. On success
 * the shell reselects the new WAV and the normal auto/manual segment screen follows.
 *
 * Presentational only — `onConvert` (supplied by the shell) does the ffmpeg call + reselect.
 */
export function FileConversionView(props: {
  sourceName: string;
  outputName: string;
  onConvert: (onProgress: (fraction: number) => void) => Promise<void>;
}) {
  const { sourceName, outputName, onConvert } = props;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);

  async function run(): Promise<void> {
    setBusy(true);
    setProgress(0);
    setError(undefined);
    try {
      await onConvert(setProgress);
      // On success the shell reselects the new WAV and swaps this view out, so we
      // intentionally leave `busy` set.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const percent = Math.round(progress * 100);

  return (
    <div
      css={css`
        font-family: ${LAMETA_UI_FONT};
        line-height: 1.5;
        color: #263238;
        padding: 1.5rem;
        max-width: 42rem;
      `}
    >
      <div
        css={css`
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 0.75rem;
        `}
      >
        <InfoIcon />
        <h2
          css={css`
            font-size: 1.15rem;
            font-weight: 600;
            margin: 2px 0 0;
          `}
        >
          {t("convert.title", "Convert to audio for annotating")}
        </h2>
      </div>

      <p
        css={css`
          margin: 0 0 1rem;
        `}
      >
        {t(
          "convert.explanation",
          "To annotate this file, a standard WAV audio copy will be created alongside it. " +
            "The original file is not changed.",
        )}
      </p>

      <dl
        css={css`
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 4px 12px;
          margin: 0 0 1.25rem;
          dt {
            color: #607d8b;
          }
          dd {
            margin: 0;
            font-weight: 600;
            word-break: break-all;
          }
        `}
      >
        <dt>{t("convert.sourceLabel", "From")}</dt>
        <dd>{sourceName}</dd>
        <dt>{t("convert.outputLabel", "New audio file")}</dt>
        <dd>{outputName}</dd>
      </dl>

      <Button
        variant="contained"
        disableElevation
        disabled={busy}
        onClick={() => void run()}
        sx={{
          py: "8px",
          px: "22px",
          fontSize: 15,
          fontFamily: "inherit",
          textTransform: "none",
          background: "#1565c0",
          "&:hover": { background: "#0d47a1" },
        }}
      >
        {busy
          ? t("convert.converting", "Converting… {percent}%", { percent })
          : t("convert.convert", "Convert")}
      </Button>

      {busy && (
        <LinearProgress
          variant="determinate"
          value={percent}
          sx={{
            mt: "1rem",
            maxWidth: "24rem",
            height: 6,
            borderRadius: "3px",
            background: "#bbdefb",
            "& .MuiLinearProgress-bar": { background: "#1565c0" },
          }}
        />
      )}

      {error && (
        <p
          css={css`
            margin-top: 1rem;
            color: #c62828;
          `}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** A small, self-contained info glyph (no external asset — CSP-safe inline SVG). */
function InfoIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      css={css`
        flex: none;
      `}
    >
      <circle cx="12" cy="12" r="10" fill="#1565c0" />
      <rect x="11" y="10" width="2" height="7" rx="1" fill="#fff" />
      <circle cx="12" cy="7.5" r="1.25" fill="#fff" />
    </svg>
  );
}
