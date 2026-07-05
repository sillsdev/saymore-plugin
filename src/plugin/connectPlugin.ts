import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { deriveMediaFromEaf } from "../fs/SessionFolder";
import { ORAL_ANNOTATIONS_WAV_SUFFIX } from "../model/SayMoreConstants";
import type { PluginHostApiV1, PluginInitContext } from "./PluginApiTypes";
import { PluginHostAdapter } from "./PluginHostAdapter";

/**
 * True when this SPA is running inside lameta's plugin iframe rather than as the
 * top-level dev page (`vp dev`) or a directly-opened build. lameta hosts the plugin
 * in an `<iframe>`, so `window.self !== window.top`; a cross-origin access throw
 * (also only possible when framed) counts as embedded too.
 */
export function isEmbeddedInHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * What the host selected, so the shell can route the pane:
 *  - "media"          — the media file itself (State A) → Start Annotating / segmenter-grid
 *  - "eaf"            — the `<media>.annotations.eaf` (State B) → the Annotations pane
 *  - "oralAnnotations" — the generated `<media>.oralAnnotations.wav` → the viewer
 */
export type SelectionKind = "media" | "eaf" | "oralAnnotations";

export interface PluginConnection {
  adapter: FileSystemAdapter;
  /** The raw host API, for calls the adapter doesn't cover (e.g. selectFile). */
  api: PluginHostApiV1;
  /** The selected file's name — the media, a `.eaf`, or a `.oralAnnotations.wav`. */
  selectedFileName: string;
  /** The real media file the session is anchored on (derived from the selection). */
  mediaFileName: string;
  /** Lowercase extension without the dot, e.g. "wav" or "eaf". */
  extension: string;
  /** lameta's file-type classification, e.g. "Audio". */
  lametaType: string;
  /** What kind of file was selected — App.tsx branches the pane on this. */
  selectionKind: SelectionKind;
  /**
   * Which provider-claimed tab this content iframe is rendering (`context.tab.id`,
   * e.g. "segments" or "careful-speech"); undefined on hosts that predate the
   * provider model. App.tsx routes the pane on `selectionKind` + this.
   */
  tabId: string | undefined;
  /** lameta's UI language code, for a future l10n hookup. */
  languageCode: string;
}

/**
 * Wrap a resolved `lameta:init` context + host API in a {@link PluginConnection} for a
 * **content tab** (role "tab"). The caller (the shell) does the `connectToLameta()`
 * handshake once, branches on `context.role`, and — for a tab — calls this to get an
 * adapter it feeds to `ProjectStore.openSession`, exactly as the dev harness does with a
 * BrowserDirectoryAdapter. (The hidden "tabProvider" instance never calls this; it has no
 * `file` and just answers `getTabs`.)
 */
export function buildPluginConnection(
  context: PluginInitContext,
  api: PluginHostApiV1,
): PluginConnection {
  const selectedFileName = context.file.name;
  const extension = context.file.extension.toLowerCase();
  // Anchor the session on the real MEDIA file, whatever kind was selected:
  //  - `.oralAnnotations.wav` (a `.wav`, so the extension alone is misleading): strip the
  //    suffix to recover the media; the combined file is read as a companion of it.
  //  - `.eaf` (State B): derive the media it annotates; companions are eaf-scoped by the host.
  //  - otherwise (State A): the media itself was selected.
  let selectionKind: SelectionKind;
  let mediaFileName: string;
  if (selectedFileName.toLowerCase().endsWith(ORAL_ANNOTATIONS_WAV_SUFFIX.toLowerCase())) {
    selectionKind = "oralAnnotations";
    mediaFileName = selectedFileName.slice(
      0,
      selectedFileName.length - ORAL_ANNOTATIONS_WAV_SUFFIX.length,
    );
  } else if (extension === "eaf") {
    selectionKind = "eaf";
    mediaFileName = deriveMediaFromEaf(selectedFileName);
  } else {
    selectionKind = "media";
    mediaFileName = selectedFileName;
  }
  const adapter = new PluginHostAdapter(api, mediaFileName, selectedFileName);
  return {
    adapter,
    api,
    selectedFileName,
    mediaFileName,
    extension,
    lametaType: context.file.lametaType,
    selectionKind,
    tabId: context.tab?.id,
    languageCode: context.ui.languageCode,
  };
}
