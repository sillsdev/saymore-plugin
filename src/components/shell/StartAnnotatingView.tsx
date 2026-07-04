/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useState } from "react";
import { t } from "../../l10n";

/**
 * State A of the plugin tab: an Audio file is selected but no `<media>.annotations.eaf`
 * companion exists yet. SayMore's equivalent is the "Start Annotating" prompt. We show a
 * single button that creates the matching EAF (SayMore-compatible, seeded from the
 * annotation template) and hands control to the manual segmenter.
 *
 * The actual "create + reveal the segmenter" work is `onStart`, supplied by the shell so
 * this view stays presentational (and so the create/select wiring can differ between the
 * self-hosted flow and the host `selectFile` flow without touching the UI).
 */
export function StartAnnotatingView(props: {
  mediaFileName: string;
  onStart: () => Promise<void>;
}) {
  const { mediaFileName, onStart } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await onStart();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
    // On success the shell swaps this view out, so we intentionally leave `busy` set.
  }

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
        disabled={busy}
        onClick={() => void handleClick()}
        css={css`
          padding: 10px 18px;
          font-size: 15px;
          border: 1px solid #2e7d32;
          border-radius: 4px;
          background: #2e7d32;
          color: #fff;
          cursor: pointer;
          &:disabled {
            opacity: 0.6;
            cursor: default;
          }
        `}
      >
        {busy
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
