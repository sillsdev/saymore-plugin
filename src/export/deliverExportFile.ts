import type { ExportFile } from "./exportFormats";

/**
 * The one place an export leaves the plugin. The plugin host has no save-file
 * API, so the file goes out as a browser download named with SayMore's default
 * file name; a host call replaces this body when one exists.
 */
export async function deliverExportFile(file: ExportFile): Promise<void> {
  const blob = new Blob([file.bom ? "\uFEFF" : "", file.text], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Deliver a binary export (the audio exports) as a browser download. */
export async function deliverExportBytes(
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
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
