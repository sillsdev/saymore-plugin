import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { deriveMediaFromEaf } from "../fs/SessionFolder";
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

export interface PluginConnection {
  adapter: FileSystemAdapter;
  /** The raw host API, for calls the adapter doesn't cover (e.g. selectFile). */
  api: PluginHostApiV1;
  /** The selected file's name — may be the media (State A) or a `.eaf` (State B). */
  selectedFileName: string;
  /** Lowercase extension without the dot, e.g. "wav" or "eaf". */
  extension: string;
  /** lameta's file-type classification, e.g. "Audio". */
  lametaType: string;
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
  // State B: an `.eaf` is selected — anchor the session on the media it annotates and
  // read the media (+ its `_Annotations/`) through the host's eaf-scoped companions.
  // State A: the media itself is selected — the adapter reads it via getFileBytes().
  const mediaFileName =
    extension === "eaf" ? deriveMediaFromEaf(selectedFileName) : selectedFileName;
  const adapter = new PluginHostAdapter(api, mediaFileName, selectedFileName);
  return {
    adapter,
    api,
    selectedFileName,
    extension,
    lametaType: context.file.lametaType,
    languageCode: context.ui.languageCode,
  };
}
