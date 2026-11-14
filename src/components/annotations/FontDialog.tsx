/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { t } from "../../l10n";
import type { GridFont } from "../../state/GridFonts";
import { gridFontStyle, quoteFamily } from "./gridFontStyle";

/** SIL fonts that language projects commonly have installed. */
export const SIL_FONTS: readonly string[] = [
  "Andika",
  "Charis SIL",
  "Doulos SIL",
  "Gentium Plus",
  "Gentium Book Plus",
  "Scheherazade New",
  "Abyssinica SIL",
  "Padauk",
];

/** The sizes Windows' font dialog lists, which SayMore's Fonts dialog is. */
export const FONT_SIZES_PT: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
];

const DEFAULT_SIZE_PT = 10;

/**
 * Whether the browser renders `family` from an installed font: text in that family
 * measures differently from text in the generic fallbacks. Undefined where the
 * browser cannot measure text (no canvas).
 */
export function isFontInstalled(family: string): boolean | undefined {
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    return undefined;
  }
  if (!context) return undefined;
  const sample = "mmmmmmmmmmlliWwQ@ʃŋ";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    context.font = `72px ${generic}`;
    const fallback = context.measureText(sample).width;
    context.font = `72px ${quoteFamily(family)}, ${generic}`;
    return context.measureText(sample).width !== fallback;
  });
}

/** The SIL fonts this browser can see, or all of them where it cannot tell. */
export function installedSilFonts(): string[] {
  return SIL_FONTS.filter((family) => isFontInstalled(family) !== false);
}

/**
 * SayMore's "Fonts..." dialog for one grid column: family (typed, or picked from
 * the SIL fonts this machine has), size and style, with a sample. "Default" goes
 * back to the grid's own font.
 */
export function FontDialog(props: {
  open: boolean;
  columnLabel: string;
  font: GridFont | undefined;
  onCancel: () => void;
  onChoose: (font: GridFont | undefined) => void;
}) {
  const [family, setFamily] = useState("");
  const [sizePt, setSizePt] = useState(DEFAULT_SIZE_PT);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    if (!props.open) return;
    setFamily(props.font?.family ?? "");
    setSizePt(props.font?.sizePt ?? DEFAULT_SIZE_PT);
    setBold(props.font?.bold ?? false);
    setItalic(props.font?.italic ?? false);
    setChoices(installedSilFonts());
  }, [props.open, props.font]);

  const chosen: GridFont | undefined =
    family.trim() === ""
      ? undefined
      : {
          family: family.trim(),
          sizePt,
          ...(bold ? { bold: true } : {}),
          ...(italic ? { italic: true } : {}),
        };

  return (
    <Dialog open={props.open} onClose={props.onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16 }}>
        {t("grid.fonts.title", "{column} Font", { column: props.columnLabel })}
      </DialogTitle>
      <DialogContent
        css={css`
          display: flex;
          flex-direction: column;
          gap: 14px;
        `}
      >
        <Autocomplete
          freeSolo
          options={choices}
          inputValue={family}
          onInputChange={(_e, value) => setFamily(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              margin="dense"
              size="small"
              label={t("grid.fonts.family", "Font")}
              placeholder={t("grid.fonts.defaultFamily", "Default")}
            />
          )}
        />
        <TextField
          select
          size="small"
          label={t("grid.fonts.size", "Size")}
          value={sizePt}
          onChange={(e) => setSizePt(Number(e.target.value))}
        >
          {FONT_SIZES_PT.map((size) => (
            <MenuItem key={size} value={size}>
              {size}
            </MenuItem>
          ))}
        </TextField>
        <div>
          <FormControlLabel
            control={<Checkbox checked={bold} onChange={(e) => setBold(e.target.checked)} />}
            label={t("grid.fonts.bold", "Bold")}
          />
          <FormControlLabel
            control={<Checkbox checked={italic} onChange={(e) => setItalic(e.target.checked)} />}
            label={t("grid.fonts.italic", "Italic")}
          />
        </div>
        <div
          data-testid="font-sample"
          style={gridFontStyle(chosen)}
          css={css`
            border: 1px solid #cfd8dc;
            padding: 8px;
            min-height: 2.5em;
            overflow: hidden;
            white-space: nowrap;
          `}
        >
          AaBbYyZz ɓɗŋ
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => props.onChoose(undefined)} sx={{ mr: "auto" }}>
          {t("grid.fonts.default", "Default")}
        </Button>
        <Button onClick={props.onCancel}>{t("common.cancel", "Cancel")}</Button>
        <Button variant="contained" onClick={() => props.onChoose(chosen)}>
          {t("common.ok", "OK")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
