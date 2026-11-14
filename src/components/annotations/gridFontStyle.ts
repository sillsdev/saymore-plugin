import type { GridFont } from "../../state/GridFonts";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/** Pixels per point at the CSS reference resolution. */
const PX_PER_PT = 96 / 72;
/** The grid's row height with the default 13px text. */
export const DEFAULT_ROW_HEIGHT = 34;

/** CSS for a grid text cell in `font`; the default grid font when there is none. */
export function gridFontStyle(font: GridFont | undefined): {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number;
  fontStyle?: string;
} {
  if (!font) return {};
  return {
    fontFamily: `${quoteFamily(font.family)}, ${LAMETA_UI_FONT}`,
    fontSize: `${font.sizePt}pt`,
    fontWeight: font.bold ? 700 : 400,
    fontStyle: font.italic ? "italic" : "normal",
  };
}

/** A family name as CSS needs it: quoted, with quotes and backslashes escaped. */
export function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * Every row has one height, so the virtual scrolling can work out which rows are
 * on screen; it grows with the larger column font so that text is not clipped.
 */
export function gridRowHeight(fonts: readonly (GridFont | undefined)[]): number {
  const largestPx = Math.max(0, ...fonts.map((f) => (f ? f.sizePt * PX_PER_PT : 0)));
  return Math.max(DEFAULT_ROW_HEIGHT, Math.ceil(largestPx * 1.3) + 12);
}
