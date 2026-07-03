// VENDORED from lameta: src/plugins/PluginApiTypes.ts (plugin API v1).
//
// Keep this in sync with the host copy. It is intentionally dependency-free (no
// lameta/node imports) so it can one day be published as `@lameta/plugin-api`.
// The only local change from the canonical source is that it lives here under
// src/plugin/ and is imported by our vendored lametaPluginClient.ts.

/** The plugin API major versions that this build of lameta can host. */
export const LAMETA_PLUGIN_API_VERSIONS_SUPPORTED: number[] = [1];

/** Folder kinds a plugin might be shown in. */
export type PluginFolderType = "session" | "person" | "project" | "project documents";

/**
 * The one-time context lameta hands a plugin at startup (the `lameta:init` message).
 * Everything here is a plain, serializable value (no functions, no live objects).
 */
export interface PluginInitContext {
  /** The API major version lameta is speaking. Matches the plugin manifest's apiVersion. */
  apiVersion: number;
  plugin: {
    id: string;
    version: string;
    /** The manifest `permissions` the host granted this plugin, e.g. ["companionFiles"]. */
    grantedPermissions: string[];
  };
  file: {
    /** Absolute path on disk to the actual file (link files already resolved). */
    path: string;
    /** File name including extension, e.g. "ETR009_Careful.mp3". */
    name: string;
    /** Lowercase extension without the dot, e.g. "mp3". */
    extension: string;
    /** Best-guess mime type, e.g. "audio/mpeg". */
    mimeType: string;
    /** lameta's file-type classification, e.g. "Audio", "Video", "Image". */
    lametaType: string;
    /** A file:// URL usable directly in <audio>/<img>/<video> src attributes. */
    uri: string;
  };
  folder: {
    type: PluginFolderType;
    /** Absolute path to the folder that "owns" the file. Sidecars live under here. */
    directory: string;
  };
  ui: {
    /** lameta's current UI language code, e.g. "en", "es". */
    languageCode: string;
    /** lameta version string, for display / compatibility checks. */
    appVersion: string;
  };
}

/**
 * Scoped access to the selected file's SayMore-style companion files. Requires the
 * `companionFiles` manifest permission. All `relPath`s are relative to the selected
 * file's own directory and are validated by the host against an allowlist derived
 * from the selected file's name. On the wire these travel as dotted method strings
 * ("companions.list", "companions.readText", ...).
 */
export interface PluginCompanionsApiV1 {
  list(subdir?: string): Promise<{ name: string; size: number; mtimeMs: number }[]>;
  exists(relPath: string): Promise<boolean>;
  readText(relPath: string): Promise<string>;
  readBytes(relPath: string): Promise<ArrayBuffer>;
  writeText(relPath: string, contents: string): Promise<void>;
  writeBytes(relPath: string, data: ArrayBuffer): Promise<void>;
  rename(fromRelPath: string, toRelPath: string): Promise<void>;
  delete(relPath: string): Promise<void>;
  stat(relPath: string): Promise<{ size: number; mtimeMs: number } | null>;
}

/** The RPC surface a plugin can call on the host. */
export interface PluginHostApiV1 {
  getFileBytes(): Promise<ArrayBuffer>;
  readFileRange(offset: number, length: number): Promise<ArrayBuffer>;
  readSidecar(name?: string): Promise<string | null>;
  writeSidecar(contents: string, name?: string): Promise<void>;
  listSidecars(): Promise<string[]>;
  companions: PluginCompanionsApiV1;
}

// ---------------------------------------------------------------------------
// Wire protocol (postMessage envelopes). Kept here so both host and client agree.
// ---------------------------------------------------------------------------

export const PLUGIN_MESSAGE_PREFIX = "lameta:";

export interface PluginReadyMessage {
  type: "lameta:ready";
}

export interface PluginInitMessage {
  type: "lameta:init";
  context: PluginInitContext;
}

export interface PluginRequestMessage {
  type: "lameta:request";
  id: number;
  method: string;
  params: unknown[];
}

export interface PluginResponseMessage {
  type: "lameta:response";
  id: number;
  result?: unknown;
  error?: string;
}

export type PluginToHostMessage = PluginReadyMessage | PluginRequestMessage;
export type HostToPluginMessage = PluginInitMessage | PluginResponseMessage;
