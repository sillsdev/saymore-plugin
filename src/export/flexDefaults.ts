export interface FlexWritingSystems {
  transcriptionWs: string;
  freeTranslationWs: string;
}

/** A tier DEFAULT_LOCALE that SayMore's template uses for IPA, which FLEx has no writing system for. */
const NOT_A_FLEX_WRITING_SYSTEM = new Set(["ipa-ext"]);

function usable(code: string | undefined): string | undefined {
  const trimmed = code?.trim();
  return trimmed && !NOT_A_FLEX_WRITING_SYSTEM.has(trimmed.toLowerCase()) ? trimmed : undefined;
}

/**
 * Each writing system defaults to the language its tier declares, then to the last one
 * exported, then to "en".
 */
export function defaultFlexWritingSystems(
  tierLanguages: { transcription?: string; freeTranslation?: string },
  lastUsed: Partial<FlexWritingSystems> | undefined,
): FlexWritingSystems {
  return {
    transcriptionWs:
      usable(tierLanguages.transcription) ?? usable(lastUsed?.transcriptionWs) ?? "en",
    freeTranslationWs:
      usable(tierLanguages.freeTranslation) ?? usable(lastUsed?.freeTranslationWs) ?? "en",
  };
}
