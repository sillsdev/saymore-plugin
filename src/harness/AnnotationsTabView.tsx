/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { TranscriptionGrid } from "./TranscriptionGrid";
import { ManualSegmenterView } from "../components/segmenter/ManualSegmenterView";
import { StubButton, stubTitle } from "./stub";

/**
 * The "Annotations" tab a SayMore `.eaf` selection shows (reference screenshot 2):
 * a green toolbar strip over the transcription grid. Only "Segment…" is wired —
 * it flips the tab into a **segment mode** that hosts the REAL manual segmenter
 * in-place (with a "Back to transcriptions" affordance), so we never leave the
 * simulator; the zoom dropdown, Oral Annotations Tools, Export and help are stubs.
 */
export const AnnotationsTabView = observer(function AnnotationsTabView(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  return (
    <div>
      <div
        css={css`
          display: inline-block;
          padding: 4px 14px;
          border: 1px solid #b7d59b;
          border-bottom: none;
          border-radius: 4px 4px 0 0;
          background: #eaf3e0;
          font-size: 13px;
          font-weight: 600;
          color: #33691e;
        `}
      >
        {t("annotations.tab", "Annotations")}
      </div>

      {harness.eafView === "segmenter" ? (
        <SegmentMode harness={harness} />
      ) : (
        <GridMode harness={harness} />
      )}
    </div>
  );
});

/** Segment mode: the real manual segmenter in-place, framed by the tab. */
const SegmentMode = observer(function SegmentMode(props: { harness: HarnessStore }) {
  const { harness } = props;
  return (
    <div
      css={css`
        border: 1px solid #b7d59b;
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
        <button
          type="button"
          onClick={() => harness.showGrid()}
          css={css`
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px;
            font-size: 13px;
            font-weight: 600;
            color: #33691e;
            background: #fff;
            border: 1px solid #b7d59b;
            border-radius: 3px;
            cursor: pointer;
          `}
        >
          ← {t("annotations.backToTranscriptions", "Back to transcriptions")}
        </button>
      </div>
      {harness.projectStore.segmenter ? (
        <ManualSegmenterView store={harness.projectStore} height="auto" />
      ) : (
        <p
          css={css`
            padding: 12px;
          `}
        >
          {t("harness.loading", "Loading…")}
        </p>
      )}
    </div>
  );
});

/** Grid mode: the green toolbar over the transcription grid. */
const GridMode = observer(function GridMode(props: { harness: HarnessStore }) {
  const { harness } = props;
  return (
    <div>
      <div
        css={css`
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 8px 10px;
          background: #cfe3b4;
          border: 1px solid #b7d59b;
        `}
      >
        <select
          disabled
          title={stubTitle(t("annotations.zoom", "Zoom"))}
          css={css`
            font-size: 13px;
            padding: 2px 4px;
            opacity: 0.65;
          `}
        >
          <option>70%</option>
        </select>
        <StubButton feature={t("annotations.oralTools", "Oral Annotations Tools")}>
          🗣 {t("annotations.oralTools", "Oral Annotations Tools")} ▾
        </StubButton>
        <button
          type="button"
          onClick={() => harness.showSegmenter()}
          css={css`
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            background: #2e7d32;
            border: 1px solid #2e7d32;
            border-radius: 3px;
            cursor: pointer;
          `}
        >
          ↔ {t("annotations.segment", "Segment…")}
        </button>
        <StubButton feature={t("annotations.export", "Export")}>
          {t("annotations.export", "Export")} ▾
        </StubButton>
        <StubButton feature={t("annotations.help", "Help")}>?</StubButton>
      </div>

      <TranscriptionGrid harness={harness} />
    </div>
  );
});
