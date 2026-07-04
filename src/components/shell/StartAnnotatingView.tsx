/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useState } from "react";
import { t } from "../../l10n";

/**
 * State A of the plugin tab: an Audio file is selected but no `<media>.annotations.eaf`
 * companion exists yet. SayMore's equivalent is the "Start Annotating" prompt with its
 * segmentation-method choice. We surface the two methods that work purely in the browser:
 *  - **Manual** (`onStart`): create the matching empty EAF and hand control to the manual
 *    segmenter, exactly as before.
 *  - **Auto** (`onAutoSegment`): run the auto-segmenter over the audio, write the resulting
 *    segments into a SayMore-compatible EAF, then open the segmenter showing them. It
 *    receives a progress callback (0→1) so we can show a bar while it works.
 *
 * The create/reveal work is supplied by the shell so this view stays presentational (the
 * wiring differs between the self-hosted flow and the host `selectFile` flow).
 */
export function StartAnnotatingView(props: {
  mediaFileName: string;
  onStart: () => Promise<void>;
  onAutoSegment: (onProgress: (fraction: number) => void) => Promise<void>;
}) {
  const { mediaFileName, onStart, onAutoSegment } = props;
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

  const buttonCss = css`
    display: block;
    width: 100%;
    padding: 10px 18px;
    margin-top: 0.75rem;
    font-size: 15px;
    border-radius: 4px;
    cursor: pointer;
    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  `;

  return (
    <div
      css={css`
        max-width: 40rem;
        margin: 4rem auto;
        padding: 0 1rem;
        font-family: system-ui, sans-serif;
        line-height: 1.5;
        text-align: center;
      `}
    >
      <p
        css={css`
          color: #546e7a;
          margin-bottom: 1.5rem;
        `}
      >
        {t("start.noAnnotations", "This audio file has no annotations yet.")}
        <br />
        <span
          css={css`
            font-size: 13px;
          `}
        >
          {mediaFileName}
        </span>
      </p>

      <button
        type="button"
        disabled={busy !== undefined}
        onClick={() => void run("auto", () => onAutoSegment(setProgress))}
        css={css`
          ${buttonCss};
          border: 1px solid #2e7d32;
          background: #2e7d32;
          color: #fff;
        `}
      >
        {busy === "auto"
          ? t("start.autoSegmenting", "Segmenting… {percent}%", {
              percent: Math.round(progress * 100),
            })
          : t("start.autoSegment", "Auto-segment")}
      </button>

      {busy === "auto" && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          css={css`
            margin-top: 0.5rem;
            height: 6px;
            border-radius: 3px;
            background: #c8e6c9;
            overflow: hidden;
          `}
        >
          <div
            css={css`
              height: 100%;
              width: ${Math.round(progress * 100)}%;
              background: #2e7d32;
              transition: width 0.15s linear;
            `}
          />
        </div>
      )}

      <button
        type="button"
        disabled={busy !== undefined}
        onClick={() => void run("manual", onStart)}
        css={css`
          ${buttonCss};
          border: 1px solid #90a4ae;
          background: #fff;
          color: #37474f;
        `}
      >
        {busy === "manual"
          ? t("start.creating", "Creating annotation file…")
          : t("start.useManualSegmenter", "Use manual segmentation tool")}
      </button>

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
