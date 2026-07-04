import type { SpaceBarMode } from "../../state/recorder/recorderTypes";

/**
 * Pure key → action map for the recorder's keyboard model. Kept separate from
 * {@link RecorderView} (which listens on `window`, not a focused React element —
 * see the iframe-safety note there) so the mapping is unit-testable standalone.
 * Callers should `preventDefault()` whenever this returns a defined action.
 */

export type RecorderKeyPhase = "down" | "up";

export type RecorderAction =
  | "listenDown"
  | "listenUp"
  | "speakDown"
  | "speakUp"
  | "replay"
  | "nudgeNewBoundaryLeft"
  | "nudgeNewBoundaryRight"
  | "abort"
  | "undo"
  | "redo";

export interface RecorderKeyModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
}

const NO_MODIFIERS: RecorderKeyModifiers = { ctrlKey: false, shiftKey: false };

export function recorderKeyAction(
  key: string,
  phase: RecorderKeyPhase,
  repeat: boolean,
  mode: SpaceBarMode,
  currentIsNew: boolean,
  modifiers: RecorderKeyModifiers = NO_MODIFIERS,
): RecorderAction | undefined {
  // Space is push-to-talk: Listen while listen-gating, Record once armed. Browsers
  // fire repeated keydowns while held — filter those so we don't re-trigger.
  if (key === " " || key === "Spacebar") {
    if (repeat) return undefined;
    if (mode === "Listen") return phase === "down" ? "listenDown" : "listenUp";
    if (mode === "Record") return phase === "down" ? "speakDown" : "speakUp";
    return undefined; // Done / Error: space does nothing
  }

  // Every other action fires on key-down only.
  if (phase === "up") return undefined;

  if (key === "b" || key === "B") return "replay";

  if (currentIsNew && (key === "ArrowLeft" || key === "ArrowRight")) {
    return key === "ArrowLeft" ? "nudgeNewBoundaryLeft" : "nudgeNewBoundaryRight";
  }

  if (key === "Escape") return "abort";

  if (modifiers.ctrlKey && (key === "z" || key === "Z")) {
    return modifiers.shiftKey ? "redo" : "undo";
  }
  if (modifiers.ctrlKey && (key === "y" || key === "Y")) return "redo";
  // SayMore also accepts plain Z (no modifier) as undo — the hover Undo
  // button's tooltip reads "Ctrl-Z or Z".
  if (key === "z" || key === "Z") return "undo";

  return undefined;
}
