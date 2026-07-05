import { t } from "../l10n";
import { annotationsEafName } from "../fs/SessionFolder";
import { ORAL_ANNOTATIONS_WAV_SUFFIX } from "../model/SayMoreConstants";
import type { PluginCompanionsApiV1, TabDescriptor, TabProviderQuery } from "./PluginApiTypes";

/** Inputs the pure tab policy needs about the currently-selected file. */
export interface TabQuery {
  /** Lowercase extension without the dot, e.g. "wav", "eaf". */
  extension: string;
  /** lameta's file-type classification, e.g. "Audio". */
  lametaType: string;
  /** Whether `<media>.annotations.eaf` currently exists (resolved LIVE per query). */
  hasAnnotationsEaf: boolean;
  /** Whether the file is a generated `<media>.oralAnnotations.wav` (by name). */
  isOralAnnotations: boolean;
  /**
   * For a selected `.eaf`: whether it has any segments yet (resolved LIVE per
   * query). An empty eaf defaults to the "Segments" tab — there is nothing to
   * transcribe until boundaries exist, and it is what makes "Manually segment"
   * land in the segmenter after `selectFile`.
   */
  eafHasSegments: boolean;
}

/**
 * SayMore's tab policy — the single source of truth the provider returns to the host on
 * EVERY selection (query-per-selection, uncached; the answer is state-dependent):
 *
 *  - a `<media>.oralAnnotations.wav`  → "Careful Speech" (default) + "Oral Translation"
 *    (the two recorders) + "Combined Audio" (the 3-channel viewer)
 *  - a `.eaf` is selected            → "Transcription & Translation" (the grid) +
 *    "Segments" (the manual segmenter); the grid is default once segments exist,
 *    the segmenter while the eaf is still empty
 *  - an Audio/Video file with no `.eaf` yet → one "Start Annotating" tab (a WAV goes straight
 *    to the setup buttons; any other type is offered file-conversion first, see App.tsx)
 *  - an Audio file that already has an `.eaf` → NO tab (annotate via the `.eaf`'s own tab)
 *  - anything else                   → no tabs
 *
 * Pure + synchronous so it's trivially testable; `hasAnnotationsEaf` is resolved by the
 * caller (see {@link resolveSaymoreTabs}).
 */
export function computeTabs(query: TabQuery): TabDescriptor[] {
  if (query.isOralAnnotations) {
    return [
      {
        id: "careful-speech",
        label: t("tab.carefulSpeech", "Careful Speech"),
        claimDefault: true,
      },
      { id: "oral-translation", label: t("tab.oralTranslation", "Oral Translation") },
      { id: "combined-audio", label: t("tab.combinedAudio", "Combined Audio") },
    ];
  }
  if (query.extension === "eaf") {
    return [
      {
        id: "transcription-translation",
        label: t("tab.transcriptionTranslation", "Transcription & Translation"),
        claimDefault: query.eafHasSegments,
      },
      {
        id: "segments",
        label: t("tab.segments", "Segments"),
        claimDefault: !query.eafHasSegments,
      },
    ];
  }
  if (query.lametaType === "Audio" || query.lametaType === "Video") {
    return query.hasAnnotationsEaf
      ? []
      : [{ id: "start", label: t("tab.start", "Start Annotating") }];
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
  companions: Pick<PluginCompanionsApiV1, "exists" | "readText">,
): Promise<TabDescriptor[]> {
  const extension = query.file.extension.toLowerCase();
  const { lametaType, name } = query.file;
  const isOralAnnotations = name.toLowerCase().endsWith(ORAL_ANNOTATIONS_WAV_SUFFIX.toLowerCase());

  let hasAnnotationsEaf = false;
  if (
    !isOralAnnotations &&
    extension !== "eaf" &&
    (lametaType === "Audio" || lametaType === "Video")
  ) {
    try {
      hasAnnotationsEaf = await companions.exists(annotationsEafName(name));
    } catch {
      hasAnnotationsEaf = false;
    }
  }

  // A selected eaf: peek at its content (it is within its own first-dot-stem
  // companion scope) to pick the default tab. On any failure fall back to
  // "has segments" — the grid default.
  let eafHasSegments = true;
  if (!isOralAnnotations && extension === "eaf") {
    try {
      eafHasSegments = /<ALIGNABLE_ANNOTATION\b/.test(await companions.readText(name));
    } catch {
      eafHasSegments = true;
    }
  }

  return computeTabs({
    extension,
    lametaType,
    hasAnnotationsEaf,
    isOralAnnotations,
    eafHasSegments,
  });
}
