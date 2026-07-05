/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
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
 * The Annotations pane over a `.eaf` selection. Navigation between the grid and
 * the segmenter is host-tab-level ("Transcription & Translation" vs "Segments"
 * — see tabProvider.ts; the harness mirrors them as chips), so this pane draws
 * no navigation of its own — it just renders whatever `store.annotationsView`
 * says. The oral-annotation recorders are NOT here: they live on the
 * `<media>.oralAnnotations.wav` selection's own tabs; the grid's "Setup Oral
 * Annotation" button creates that file when it doesn't exist yet.
 */
export const AnnotationsPaneView = observer(function AnnotationsPaneView(props: {
  store: ProjectStore;
  /**
   * "Setup Oral Annotation": create `<media>.oralAnnotations.wav` and select it
   * (host `selectFile` / harness tree selection) so its recorder tabs open.
   * The button only renders when this is provided AND the file doesn't exist.
   */
  onSetupOralAnnotations?: () => Promise<void>;
}) {
  const { store } = props;
  switch (store.annotationsView) {
    case "segmenter":
      return <SegmentMode store={store} />;
    case "grid":
    default:
      return <GridMode store={store} onSetupOralAnnotations={props.onSetupOralAnnotations} />;
  }
});

/** Segment mode: the real manual segmenter (the "Segments" tab / chip). */
const SegmentMode = observer(function SegmentMode(props: { store: ProjectStore }) {
  const { store } = props;
  return (
    <div
      css={css`
        border: 1px solid #b7d59b;
        font-family: ${LAMETA_UI_FONT};
      `}
    >
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
const GridMode = observer(function GridMode(props: {
  store: ProjectStore;
  onSetupOralAnnotations?: () => Promise<void>;
}) {
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
        {props.onSetupOralAnnotations && store.combinedWavExists === false && (
          <SetupOralAnnotationButton store={store} onSetup={props.onSetupOralAnnotations} />
        )}
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
 * "Setup Oral Annotation" — creates the combined `<media>.oralAnnotations.wav`
 * (source-only until recordings exist) and selects it, so its Careful Speech /
 * Oral Translation / Combined Audio tabs appear. Only rendered while the file
 * doesn't exist; once it does, the file's own tabs are the entry point.
 */
const SetupOralAnnotationButton = observer(function SetupOralAnnotationButton(props: {
  store: ProjectStore;
  onSetup: () => Promise<void>;
}) {
  const { store } = props;
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = store.combinedWavProgress !== undefined;
  return (
    <Button
      variant="outlined"
      disabled={store.document === undefined || busy}
      title={error}
      onClick={() => {
        setError(undefined);
        props.onSetup().catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }}
      sx={{
        textTransform: "none",
        fontFamily: "inherit",
        fontSize: 13,
        py: "3px",
        px: "8px",
        minWidth: 0,
        gap: "4px",
        color: error ? "#c62828" : "#37474f",
        background: "#fff",
        borderColor: "#90a4ae",
        "&:hover": { borderColor: "#607d8b", background: "#fff" },
        "&.Mui-disabled": { opacity: 0.65 },
      }}
    >
      🗣{" "}
      {busy
        ? t("annotations.settingUpOral", "Setting up… {percent}%", {
            percent: Math.round((store.combinedWavProgress ?? 0) * 100),
          })
        : t("annotations.setupOral", "Setup Oral Annotation")}
    </Button>
  );
});
