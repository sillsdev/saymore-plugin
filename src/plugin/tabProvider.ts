import { t } from "../l10n";
import { annotationsEafName } from "../fs/SessionFolder";
import type { PluginCompanionsApiV1, TabDescriptor, TabProviderQuery } from "./PluginApiTypes";

/** Inputs the pure tab policy needs about the currently-selected file. */
export interface TabQuery {
  /** Lowercase extension without the dot, e.g. "wav", "eaf". */
  extension: string;
  /** lameta's file-type classification, e.g. "Audio". */
  lametaType: string;
  /** Whether `<media>.annotations.eaf` currently exists (resolved LIVE per query). */
  hasAnnotationsEaf: boolean;
}

/**
 * SayMore's tab policy — the single source of truth the provider returns to the host on
 * EVERY selection (query-per-selection, uncached; the answer is state-dependent):
 *
 *  - a `.eaf` is selected            → one "Segments" tab (the manual segmenter), default
 *  - an Audio file with no `.eaf` yet → one "SayMore: Start Annotating" tab (the button)
 *  - an Audio file that already has an `.eaf` → NO tab (annotate via the `.eaf`'s own tab)
 *  - anything else                   → no tabs
 *
 * Pure + synchronous so it's trivially testable; `hasAnnotationsEaf` is resolved by the
 * caller (see {@link resolveSaymoreTabs}).
 */
export function computeTabs(query: TabQuery): TabDescriptor[] {
  if (query.extension === "eaf") {
    return [{ id: "segments", label: t("tab.segments", "Segments"), claimDefault: true }];
  }
  if (query.lametaType === "Audio") {
    return query.hasAnnotationsEaf
      ? []
      : [{ id: "start", label: t("tab.startAnnotating", "SayMore: Start Annotating") }];
  }
  return [];
}

/**
 * The provider responder: resolve the live companion state for the queried file and apply
 * {@link computeTabs}. Only the audio-without-decision path touches the host — it checks
 * `<media>.annotations.eaf` via `companions.exists` (scoped by the host to the queried file
 * for the duration of the query), so the answer is always current.
 */
export async function resolveSaymoreTabs(
  query: TabProviderQuery,
  companions: Pick<PluginCompanionsApiV1, "exists">,
): Promise<TabDescriptor[]> {
  const extension = query.file.extension.toLowerCase();
  const { lametaType, name } = query.file;

  let hasAnnotationsEaf = false;
  if (extension !== "eaf" && lametaType === "Audio") {
    try {
      hasAnnotationsEaf = await companions.exists(annotationsEafName(name));
    } catch {
      hasAnnotationsEaf = false;
    }
  }
  return computeTabs({ extension, lametaType, hasAnnotationsEaf });
}
