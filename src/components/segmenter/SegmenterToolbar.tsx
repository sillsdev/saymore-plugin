/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { t } from "../../l10n";
import type { SegmenterViewModel } from "../../state/SegmenterViewModel";
import { ZOOM_PRESETS } from "../../model/SayMoreConstants";

/** SayMore's zoom combo choices (SegmenterDlgBase.cs), extended down to the 10% minimum. */
const ZOOM_CHOICES = ZOOM_PRESETS;

/** Match the original readout ("00.0 / 02.9"): seconds with one decimal. */
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return sec.toFixed(1).padStart(4, "0");
}

// ── Icons (approximating SayMore's toolstrip glyphs) ────────────────────────
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="#2e7d32" strokeWidth="1.6" />
    {/* Optically centered: the triangle's centroid (⅓ from its base, not its
        bounding-box center) sits at (8,8). Base x=6, apex x=12 → centroid x=8. */}
    <path d="M6 5 L6 11 L12 8 Z" fill="#2e7d32" />
  </svg>
);
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <rect x="3" y="3" width="10" height="10" fill="#c62828" />
  </svg>
);
const BoundaryIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="#607d8b"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M6 3 h4 M6 13 h4 M8 3 v10" />
  </svg>
);
const DeleteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" stroke="#78909c" strokeWidth="2" aria-hidden>
    <path d="M4 4 L12 12 M12 4 L4 12" />
  </svg>
);

/**
 * The manual-segmenter footer, laid out like SayMore's ManualSegmenterDlg:
 * a vertical stack of flat icon+label action buttons on the left, with the
 * segment count + time readout and the zoom dropdown on the right. Edits persist
 * continuously (no undo/redo/save buttons).
 */
export const SegmenterToolbar = observer(function SegmenterToolbar(props: {
  vm: SegmenterViewModel;
}) {
  const { vm } = props;
  const current = vm.isPlaying ? vm.playback.positionSec : vm.cursorSec;
  const zoomOptions = ZOOM_CHOICES.includes(vm.zoomPercent)
    ? ZOOM_CHOICES
    : [...ZOOM_CHOICES, vm.zoomPercent].sort((a, b) => a - b);

  return (
    <div
      css={css`
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 10px 12px;
        border-top: 1px solid #cfd8dc;
        background: #f0f0f0;
        font-size: 13px;
      `}
    >
      {/* Left: the three primary actions, stacked vertically. */}
      <div
        css={css`
          display: flex;
          flex-direction: column;
          gap: 2px;
        `}
      >
        <Button
          variant="text"
          startIcon={vm.isPlaying ? <StopIcon /> : <PlayIcon />}
          onClick={() => vm.togglePlay()}
          sx={actionSx}
        >
          {vm.isPlaying
            ? t("segmenter.stop", "Stop (press the SPACE BAR)")
            : t("segmenter.listen", "Listen (press the SPACE BAR)")}
        </Button>
        <Button
          variant="text"
          startIcon={<BoundaryIcon />}
          onClick={() => vm.addBoundaryAtCursor()}
          sx={actionSx}
        >
          {t("segmenter.addBoundary", "Add Segment Boundary (press ENTER)")}
        </Button>
        <Button
          variant="text"
          startIcon={<DeleteIcon />}
          disabled={vm.selectedBoundaryIndex < 0}
          onClick={() => vm.deleteSelectedBoundary()}
          sx={actionSx}
        >
          {t("segmenter.deleteBoundary", "Delete Selected Boundary (press DELETE)")}
        </Button>
      </div>

      <span
        css={css`
          flex: 1;
        `}
      />

      {/* Right: segment count + time on top, zoom below. */}
      <div
        css={css`
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          color: #455a64;
          white-space: nowrap;
        `}
      >
        <div
          css={css`
            display: flex;
            gap: 28px;
          `}
        >
          <span>
            {t("segmenter.segmentCount", "Segments: {count}", { count: vm.segmentCount })}
          </span>
          <span
            css={css`
              font-variant-numeric: tabular-nums;
            `}
          >
            {formatTime(current)} / {formatTime(vm.durationSec)}
          </span>
        </div>
        <label
          css={css`
            display: flex;
            align-items: center;
            gap: 6px;
          `}
        >
          {t("segmenter.zoom", "Zoom:")}
          <Select
            size="small"
            value={vm.zoomPercent}
            onChange={(e) => vm.setZoomPercent(Number(e.target.value))}
            title="Ctrl+1: In; Ctrl+2: 100%; Ctrl+3: Out"
            sx={{
              fontSize: 13,
              background: "#fff",
              "& .MuiSelect-select": { py: "2px", pl: "8px" },
            }}
          >
            {zoomOptions.map((p) => (
              <MenuItem key={p} value={p} sx={{ fontSize: 13 }}>
                {p}%
              </MenuItem>
            ))}
          </Select>
        </label>
      </div>
    </div>
  );
});

// Flat, left-aligned text button matching SayMore's toolstrip items.
const actionSx = {
  justifyContent: "flex-start",
  textTransform: "none",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 400,
  color: "#212121",
  px: 0.5,
  py: 0.5,
  minWidth: 0,
  lineHeight: 1.3,
  "& .MuiButton-startIcon": { mr: 1 },
  "&:hover": { background: "rgba(0,0,0,0.04)", color: "#000" },
} as const;
