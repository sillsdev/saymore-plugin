/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useRef, useState } from "react";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import { t } from "../../l10n";
import { LAMETA_UI_FONT } from "../../lametaTheme";
import type { LabelTextTier } from "../../import/audacityLabels";

type Method = "manual" | "careful" | "elan" | "audacity" | "auto";

/**
 * The "SayMore" tab for an Audio file with no `<media>.annotations.eaf` companion yet.
 * SayMore's five ways to start, in SayMore's order:
 *  - **Manually segment** (`onStart`): create the matching empty EAF and hand control to
 *    the manual segmenter.
 *  - **Use Careful Speech Tool** (`onCarefulSpeech`): create the empty EAF and open the
 *    Careful Speech recorder, which segments as it records.
 *  - **Copy an existing ELAN file** / **Import an Audacity Label file** (`onUseFile`): the
 *    user picks a file and the shell turns it into the EAF. Which kind of file it really is
 *    gets decided from its content, as SayMore does; `tier` says where Audacity label
 *    text goes.
 *  - **Auto-segment** (`onAutoSegment`): run the auto-segmenter, write the segments into
 *    the EAF, then open it. It receives a progress callback (0→1) for the bar.
 *
 * The create/reveal work is supplied by the shell so this view stays presentational (the
 * wiring differs between the self-hosted flow and the host `selectFile` flow). A method
 * whose callback is omitted is not offered.
 */
export function StartAnnotatingView(props: {
  onStart: () => Promise<void>;
  onAutoSegment: (onProgress: (fraction: number) => void) => Promise<void>;
  onCarefulSpeech?: () => Promise<void>;
  onUseFile?: (fileText: string, tier: LabelTextTier) => Promise<void>;
}) {
  const { onStart, onAutoSegment, onCarefulSpeech, onUseFile } = props;
  const [busy, setBusy] = useState<Method | undefined>(undefined);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [labelTier, setLabelTier] = useState<LabelTextTier>("Transcription");
  const elanInput = useRef<HTMLInputElement>(null);
  const audacityInput = useRef<HTMLInputElement>(null);

  async function run(which: Method, action: () => Promise<void>): Promise<void> {
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

  function onFileChosen(
    which: "elan" | "audacity",
    tier: LabelTextTier,
    input: HTMLInputElement,
  ): void {
    const file = input.files?.[0];
    // Choosing the same file twice in a row must still fire a change event.
    input.value = "";
    if (!file || !onUseFile) return;
    void run(which, async () => onUseFile(await file.text(), tier));
  }

  const buttonSx = {
    py: "8px",
    px: "18px",
    fontSize: 15,
    fontFamily: "inherit",
    textTransform: "none",
  } as const;
  const outlinedSx = {
    ...buttonSx,
    color: "#37474f",
    borderColor: "#90a4ae",
    background: "#fff",
    "&:hover": { borderColor: "#607d8b", background: "#fff" },
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
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
        `}
      >
        <Button
          variant="outlined"
          disabled={busy !== undefined}
          onClick={() => void run("manual", onStart)}
          sx={outlinedSx}
        >
          {busy === "manual"
            ? t("start.creating", "Creating annotation file…")
            : t("start.manuallySegment", "Manually segment")}
        </Button>

        {onCarefulSpeech && (
          <Button
            variant="outlined"
            disabled={busy !== undefined}
            onClick={() => void run("careful", onCarefulSpeech)}
            sx={outlinedSx}
          >
            {busy === "careful"
              ? t("start.creating", "Creating annotation file…")
              : t("start.carefulSpeech", "Use Careful Speech Tool")}
          </Button>
        )}

        {onUseFile && (
          <>
            <Button
              variant="outlined"
              disabled={busy !== undefined}
              onClick={() => elanInput.current?.click()}
              sx={outlinedSx}
            >
              {busy === "elan"
                ? t("start.creating", "Creating annotation file…")
                : t("start.elan", "Copy an existing ELAN file")}
            </Button>
            <input
              ref={elanInput}
              type="file"
              accept=".eaf"
              data-testid="start-elan-file"
              hidden
              onChange={(e) => onFileChosen("elan", "Transcription", e.currentTarget)}
            />

            <span
              css={css`
                display: inline-flex;
                align-items: center;
                gap: 8px;
              `}
            >
              <Button
                variant="outlined"
                disabled={busy !== undefined}
                onClick={() => audacityInput.current?.click()}
                sx={outlinedSx}
              >
                {busy === "audacity"
                  ? t("start.creating", "Creating annotation file…")
                  : t("start.audacity", "Import an Audacity Label file")}
              </Button>
              <label
                css={css`
                  font-size: 14px;
                `}
              >
                {t("start.audacityTier", "Import label text into")}{" "}
                <select
                  value={labelTier}
                  disabled={busy !== undefined}
                  onChange={(e) => setLabelTier(e.currentTarget.value as LabelTextTier)}
                >
                  <option value="Transcription">
                    {t("start.tierTranscription", "Transcription")}
                  </option>
                  <option value="FreeTranslation">
                    {t("start.tierFreeTranslation", "Free Translation")}
                  </option>
                </select>
              </label>
              <input
                ref={audacityInput}
                type="file"
                accept=".txt"
                data-testid="start-audacity-file"
                hidden
                onChange={(e) => onFileChosen("audacity", labelTier, e.currentTarget)}
              />
            </span>
          </>
        )}

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
