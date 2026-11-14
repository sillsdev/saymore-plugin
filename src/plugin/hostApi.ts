import type { PluginHostApiV1 } from "./PluginApiTypes";

let connectedApi: PluginHostApiV1 | undefined;

/**
 * The lameta host API of this content tab, for the features that call it outside
 * the file adapter (exports, project settings). The shell sets it once the
 * handshake resolves; it stays undefined in the dev harness, where those
 * features fall back to browser downloads and `localStorage`.
 */
export function hostApi(): PluginHostApiV1 | undefined {
  return connectedApi;
}

export function setHostApi(api: PluginHostApiV1 | undefined): void {
  connectedApi = api;
}
