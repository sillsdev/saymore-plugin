import type { AnnotationsView } from "../state/ProjectStore";

/**
 * The host simulator's context lives in the URL query string so a refresh (or a
 * shared link) lands back in the same place: which session source, which file is
 * selected, and which view is showing. Deliberately tiny — no router library.
 *
 *   ?src=sample|folder & sel=audio|eaf & view=grid|segmenter|recorder-careful|recorder-translation
 */
export type SessionSource = "sample" | "folder";
export type Selection = "audio" | "eaf";
/** Same shape as `ProjectStore.annotationsView` — the harness round-trips it through the URL. */
export type EafView = AnnotationsView;

const EAF_VIEWS: readonly EafView[] = [
  "grid",
  "segmenter",
  "recorder-careful",
  "recorder-translation",
];

export interface HarnessUrlState {
  src: SessionSource;
  sel: Selection | undefined;
  view: EafView;
}

/** True when the legacy standalone OpenScreen was explicitly requested (`?open`). */
export function wantsOpenScreen(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("open");
}

export function readHarnessUrlState(): HarnessUrlState {
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const src = params.get("src") === "folder" ? "folder" : "sample";
  const selParam = params.get("sel");
  const sel: Selection | undefined =
    selParam === "audio" || selParam === "eaf" ? selParam : undefined;
  const viewParam = params.get("view");
  const view: EafView = (EAF_VIEWS as readonly string[]).includes(viewParam ?? "")
    ? (viewParam as EafView)
    : "grid";
  return { src, sel, view };
}

export function writeHarnessUrlState(state: HarnessUrlState): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const params = new URLSearchParams();
  params.set("src", state.src);
  if (state.sel) params.set("sel", state.sel);
  if (state.sel === "eaf") params.set("view", state.view);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? "?" + query : ""}`;
  window.history.replaceState(null, "", url);
}
