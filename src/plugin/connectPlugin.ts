import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { connectToLameta } from "./lametaPluginClient";
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
  mediaFileName: string;
  /** lameta's UI language code, for a future l10n hookup. */
  languageCode: string;
}

/**
 * Perform the `lameta:ready`/`lameta:init` handshake and wrap the granted host API
 * in a {@link PluginHostAdapter}. The caller feeds the adapter to
 * `ProjectStore.openSession`, exactly as the dev harness does with a
 * BrowserDirectoryAdapter.
 */
export async function connectPluginAdapter(): Promise<PluginConnection> {
  const { context, api } = await connectToLameta();
  const adapter = new PluginHostAdapter(api, context.file.name);
  return {
    adapter,
    mediaFileName: context.file.name,
    languageCode: context.ui.languageCode,
  };
}
