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
 * The Annotations pane over a `.eaf` selection. There is a single host tab now
 * ("Transcription & Translation" — see tabProvider.ts); navigation between the
 * grid and the manual segmenter is in-pane: the grid toolbar's "Edit Segments"
 * button opens the segmenter, and the segmenter's "Back" button returns to the
 * grid. This pane renders whatever `store.annotationsView` says. The
 * oral-annotation recorders are NOT here: they live on the
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
  /**
   * Grid height. Defaults to `100vh` — the full frame lameta hands the iframe —
   * so the pane matches the host's height and scrolls its rows internally rather
   * than overflowing (which made lameta wrap us in a page-level scrollbar). The
   * host simulator passes a bounded height so the grid sits inside its page.
   */
  height?: string;
}) {
  const { store } = props;
  switch (store.annotationsView) {
    case "segmenter":
      return <SegmentMode store={store} />;
    case "grid":
    default:
      return (
        <GridMode
          store={store}
          onSetupOralAnnotations={props.onSetupOralAnnotations}
          height={props.height ?? "100vh"}
        />
      );
  }
});

/** Segment mode: the real manual segmenter, reached from the grid's "Edit
 * Segments" button. A "Back" button in the upper left returns to the grid. */
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
          border-bottom: 1px solid #eceff1;
        `}
      >
        <Button
          variant="text"
          onClick={() => store.showGrid()}
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            fontSize: 14,
            py: "3px",
            px: "8px",
            minWidth: 0,
            gap: "6px",
            color: "#37474f",
            "&:hover": { background: "rgba(55,71,79,0.08)" },
          }}
        >
          <span css={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
            ←
          </span>
          {t("annotations.back", "Back")}
        </Button>
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

/** The "Edit Segments" glyph (c:/downloads/segment.svg): a waveform with an
 * orange segment-boundary line. The waveform inherits the button text color. */
function SegmentIcon() {
  return (
    <svg
      width="16"
      height="17"
      viewBox="0 0 20 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M20 10L18 11L17 12L16 11L15 14L14 11L13 19L12 11H10.8725H10H8.85327H8L7 20L6 11L5 17L4 11L3 12L2 11L0 10L2 9L3 8L4 9L5 3L6 9L7 0L8 9H9.09082H10L11 8.93682L12 9L13 1L14 9L15 6L16 9L17 8L18 9L20 10Z"
        fill="currentColor"
      />
      <line x1="9.9505" y1="0" x2="9.9505" y2="20.251" stroke="#E69664" />
    </svg>
  );
}

/** Grid mode: the toolbar over the transcription grid. The pane fills the height
 * lameta gives the iframe (`height`, default `100vh`) as a flex column that never
 * overflows; the fixed toolbar stays put while {@link TranscriptionGrid} scrolls
 * its own rows under a sticky header. */
const GridMode = observer(function GridMode(props: {
  store: ProjectStore;
  onSetupOralAnnotations?: () => Promise<void>;
  height: string;
}) {
  const { store } = props;
  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        height: ${props.height};
        overflow: hidden;
      `}
    >
      <div
        css={css`
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 8px 10px;
          font-family: ${LAMETA_UI_FONT};
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
        <Button
          variant="outlined"
          disabled={store.segmenter === undefined}
          onClick={() => store.showSegmenter()}
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            fontSize: 13,
            py: "3px",
            px: "8px",
            minWidth: 0,
            gap: "4px",
            color: "#37474f",
            background: "#fff",
            borderColor: "#90a4ae",
            "&:hover": { borderColor: "#607d8b", background: "#fff" },
            "&.Mui-disabled": { opacity: 0.65 },
          }}
        >
          <SegmentIcon />
          {t("annotations.editSegments", "Edit Segments")}
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
  // Needs the real media duration (document.durationSec), which only lands with the
  // envelope (stage B of ProjectStore.load) — until then generating the combined WAV would
  // use a 0-length source.
  return (
    <Button
      variant="outlined"
      disabled={store.document === undefined || store.envelope === undefined || busy}
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
