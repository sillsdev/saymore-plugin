import { hostApi } from "../plugin/hostApi";
import type { PluginHostApiV1 } from "../plugin/PluginApiTypes";
import type { ExportFile, SaveDialogSetup } from "./exportFormats";

/**
 * How an export left the plugin: `saved` with the chosen file name through
 * lameta's Save dialog, `cancelled` when the user closed that dialog, or
 * `downloaded` as a browser download where there is no host (the dev harness).
 */
export type ExportDelivery =
  | { kind: "saved"; fileName: string }
  | { kind: "cancelled" }
  | { kind: "downloaded"; fileName: string };

/**
 * The one place a text export leaves the plugin: lameta's Save dialog when the
 * host is connected, otherwise a browser download. Either way the file name is
 * SayMore's default.
 */
export function deliverExportFile(
  file: ExportFile,
  api: PluginHostApiV1 | undefined = hostApi(),
): Promise<ExportDelivery> {
  const bom = file.bom ? new Uint8Array([0xef, 0xbb, 0xbf]) : new Uint8Array(0);
  const text = new TextEncoder().encode(file.text);
  const bytes = new Uint8Array(bom.length + text.length);
  bytes.set(bom, 0);
  bytes.set(text, bom.length);
  return deliverExportBytes(file.fileName, bytes, file.mimeType, file.save, api);
}

/** Deliver a binary export (the audio exports) the same way as {@link deliverExportFile}. */
export async function deliverExportBytes(
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
  save: SaveDialogSetup,
  api: PluginHostApiV1 | undefined = hostApi(),
): Promise<ExportDelivery> {
  if (api) {
    const result = await api.saveFile(fileName, bytes, {
      filters: save.filters,
      rememberFolderKey: save.rememberFolderKey,
    });
    return result.saved
      ? { kind: "saved", fileName: result.fileName ?? fileName }
      : { kind: "cancelled" };
  }
  download(fileName, bytes, mimeType);
  return { kind: "downloaded", fileName };
}

function download(fileName: string, bytes: Uint8Array, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
