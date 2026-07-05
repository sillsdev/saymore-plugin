/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useState } from "react";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import { t } from "../../l10n";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * The "SayMore" tab for an Audio file with no `<media>.annotations.eaf` companion yet.
 * Two segmentation methods that work purely in the browser:
 *  - **Auto-segment** (`onAutoSegment`): run the auto-segmenter over the audio, write the
 *    resulting segments into a SayMore-compatible EAF, then open it (grid default). It
 *    receives a progress callback (0→1) so we can show a bar while it works.
 *  - **Manually segment** (`onStart`): create the matching empty EAF and hand control to
 *    the manual segmenter (the eaf's "Segments" tab claims default while it is empty).
 *
 * The create/reveal work is supplied by the shell so this view stays presentational (the
 * wiring differs between the self-hosted flow and the host `selectFile` flow).
 */
export function StartAnnotatingView(props: {
  onStart: () => Promise<void>;
  onAutoSegment: (onProgress: (fraction: number) => void) => Promise<void>;
}) {
  const { onStart, onAutoSegment } = props;
  const [busy, setBusy] = useState<"manual" | "auto" | undefined>(undefined);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);

  async function run(which: "manual" | "auto", action: () => Promise<void>): Promise<void> {
    setBusy(which);
    setProgress(0);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(undefined);
    }
    // On success the shell swaps this view out, so we intentionally leave `busy` set.
  }

  const buttonSx = {
    py: "8px",
    px: "18px",
    fontSize: 15,
    fontFamily: "inherit",
    textTransform: "none",
  } as const;

  return (
    <div
      css={css`
        padding: 1rem;
        font-family: ${LAMETA_UI_FONT};
        line-height: 1.5;
      `}
    >
      <div
        css={css`
          display: flex;
          gap: 12px;
        `}
      >
        <Button
          variant="contained"
          disableElevation
          disabled={busy !== undefined}
          onClick={() => void run("auto", () => onAutoSegment(setProgress))}
          sx={{
            ...buttonSx,
            background: "#2e7d32",
            "&:hover": { background: "#276b2a" },
          }}
        >
          {busy === "auto"
            ? t("start.autoSegmenting", "Segmenting… {percent}%", {
                percent: Math.round(progress * 100),
              })
            : t("start.autoSegment", "Auto-segment")}
        </Button>

        <Button
          variant="outlined"
          disabled={busy !== undefined}
          onClick={() => void run("manual", onStart)}
          sx={{
            ...buttonSx,
            color: "#37474f",
            borderColor: "#90a4ae",
            background: "#fff",
            "&:hover": { borderColor: "#607d8b", background: "#fff" },
          }}
        >
          {busy === "manual"
            ? t("start.creating", "Creating annotation file…")
            : t("start.manuallySegment", "Manually segment")}
        </Button>
      </div>

      {busy === "auto" && (
        <LinearProgress
          variant="determinate"
          value={Math.round(progress * 100)}
          sx={{
            mt: "0.75rem",
            maxWidth: "20rem",
            height: 6,
            borderRadius: "3px",
            background: "#c8e6c9",
            "& .MuiLinearProgress-bar": { background: "#2e7d32" },
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
