import { describe, expect, it } from "vitest";
import { defaultFlexWritingSystems } from "./flexDefaults";
import { createEafFromTemplate, loadEaf, serializeEaf } from "../model/eaf/EafDocument";
import { eafTemplateXml } from "../model/eaf/eafTemplate";

const last = { transcriptionWs: "fr", freeTranslationWs: "de" };

describe("defaultFlexWritingSystems", () => {
  it("prefers the tier languages", () => {
    expect(
      defaultFlexWritingSystems({ transcription: "tpi", freeTranslation: "es" }, last),
    ).toEqual({ transcriptionWs: "tpi", freeTranslationWs: "es" });
  });

  it("falls back per field to the last-used values", () => {
    expect(defaultFlexWritingSystems({ freeTranslation: "es" }, last)).toEqual({
      transcriptionWs: "fr",
      freeTranslationWs: "es",
    });
    expect(defaultFlexWritingSystems({}, last)).toEqual({
      transcriptionWs: "fr",
      freeTranslationWs: "de",
    });
  });

  it("falls back to en with nothing known", () => {
    expect(defaultFlexWritingSystems({}, undefined)).toEqual({
      transcriptionWs: "en",
      freeTranslationWs: "en",
    });
    expect(defaultFlexWritingSystems({ transcription: " " }, { transcriptionWs: "" })).toEqual({
      transcriptionWs: "en",
      freeTranslationWs: "en",
    });
  });

  it("skips ipa-ext, which is no FLEx writing system", () => {
    expect(defaultFlexWritingSystems({ transcription: "ipa-ext" }, last).transcriptionWs).toBe(
      "fr",
    );
  });
});

describe("EafDocument.tierLanguages", () => {
  it("reads the template's tier locales", () => {
    const doc = createEafFromTemplate(eafTemplateXml, "a.wav");
    expect(doc.tierLanguages()).toEqual({ transcription: "ipa-ext", freeTranslation: "en" });
  });

  it("prefers LANG_REF over DEFAULT_LOCALE", () => {
    const xml = serializeEaf(createEafFromTemplate(eafTemplateXml, "a.wav"))
      .replace('TIER_ID="Transcription"', 'LANG_REF="tpi" TIER_ID="Transcription"')
      .replace(
        'TIER_ID="Phrase Free Translation"',
        'LANG_REF="es" TIER_ID="Phrase Free Translation"',
      );
    expect(loadEaf(xml).tierLanguages()).toEqual({ transcription: "tpi", freeTranslation: "es" });
  });
});
