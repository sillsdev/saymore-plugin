/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import { TranscriptionGrid } from "./TranscriptionGrid";
import { ManualSegmenterView } from "../segmenter/ManualSegmenterView";
import { StubButton, stubTitle } from "../shell/stub";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * The Annotations pane (reference screenshot 2): a green toolbar strip over
 * the transcription grid, flipping to the real manual segmenter in-place (and,
 * later, the oral annotation recorders) via "Segment…" / "Back to
 * transcriptions". Depends on {@link ProjectStore} only — this is the pane
 * lameta's tab embeds directly (see `App.tsx`) as well as what the standalone
 * harness wraps with its own tab chip. Drives itself off
 * `store.annotationsView` / `showGrid()` / `showSegmenter()` / `closeRecorder()`.
 */
export const AnnotationsPaneView = observer(function AnnotationsPaneView(props: {
  store: ProjectStore;
}) {
  const { store } = props;
  switch (store.annotationsView) {
    case "segmenter":
      return <SegmentMode store={store} />;
    case "recorder-careful":
    case "recorder-translation":
      // RecorderView lands in a later Track C commit; this keeps the pane
      // navigable in the meantime.
      return <RecorderPlaceholder store={store} />;
    case "grid":
    default:
      return <GridMode store={store} />;
  }
});

/** Segment mode: the real manual segmenter in-place, framed by the pane. */
const SegmentMode = observer(function SegmentMode(props: { store: ProjectStore }) {
  const { store } = props;
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
          onClick={() => store.showGrid()}
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
      {store.segmenter ? (
        <ManualSegmenterView store={store} height="auto" />
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
const GridMode = observer(function GridMode(props: { store: ProjectStore }) {
  const { store } = props;
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
          onClick={() => store.showSegmenter()}
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

      <TranscriptionGrid store={store} />
    </div>
  );
});

/**
 * Placeholder for `annotationsView === "recorder-careful" | "recorder-translation"`
 * until RecorderView lands (a later Track C commit) — keeps the pane navigable
 * (and the switch above exhaustive) for the surface Worker A's `openRecorder`
 * already exposes.
 */
const RecorderPlaceholder = observer(function RecorderPlaceholder(props: { store: ProjectStore }) {
  const { store } = props;
  return (
    <div
      css={css`
        border: 1px solid #b7d59b;
        font-family: ${LAMETA_UI_FONT};
        padding: 12px;
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
      <p>{t("recorder.comingSoon", "The recorder view is coming soon.")}</p>
    </div>
  );
});
