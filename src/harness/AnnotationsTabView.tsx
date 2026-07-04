/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { TranscriptionGrid } from "./TranscriptionGrid";
import { ManualSegmenterView } from "../components/segmenter/ManualSegmenterView";
import { StubButton, stubTitle } from "./stub";
import { LAMETA_UI_FONT } from "../lametaTheme";

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
        font-family: ${LAMETA_UI_FONT};
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
          onClick={() => harness.showGrid()}
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
          {t("annotations.manualAudioSegmenter", "Manual Audio Segmenter")}
        </span>
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
        <Select
          disabled
          size="small"
          defaultValue="70%"
          title={stubTitle(t("annotations.zoom", "Zoom"))}
          sx={{
            fontSize: 13,
            background: "#fff",
            "& .MuiSelect-select": { py: "2px", pl: "8px" },
            "&.Mui-disabled": { opacity: 0.65 },
          }}
        >
          <MenuItem value="70%" sx={{ fontSize: 13 }}>
            70%
          </MenuItem>
        </Select>
        <StubButton feature={t("annotations.oralTools", "Oral Annotations Tools")}>
          🗣 {t("annotations.oralTools", "Oral Annotations Tools")} ▾
        </StubButton>
        <Button
          variant="contained"
          disableElevation
          onClick={() => harness.showSegmenter()}
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            gap: "4px",
            py: "3px",
            px: "10px",
            color: "#fff",
            background: "#2e7d32",
            "&:hover": { background: "#276b2a" },
          }}
        >
          ↔ {t("annotations.segment", "Segment…")}
        </Button>
        <StubButton feature={t("annotations.export", "Export")}>
          {t("annotations.export", "Export")} ▾
        </StubButton>
        <StubButton feature={t("annotations.help", "Help")}>?</StubButton>
      </div>

      <TranscriptionGrid harness={harness} />
    </div>
  );
});
