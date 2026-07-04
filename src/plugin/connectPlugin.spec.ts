import { describe, it, expect } from "vitest";
import { buildPluginConnection } from "./connectPlugin";
import type { PluginHostApiV1, PluginInitContext } from "./PluginApiTypes";

/** Minimal host API — buildPluginConnection only constructs the adapter, never calls it. */
const api = {} as PluginHostApiV1;

function context(name: string, extension: string, lametaType = "Audio"): PluginInitContext {
  return {
    apiVersion: 1,
    role: "tab",
    plugin: { id: "saymore", version: "0", grantedPermissions: ["companionFiles"] },
    file: {
      path: `/s/${name}`,
      name,
      extension,
      mimeType: "audio/x-wav",
      lametaType,
      uri: `file:///s/${name}`,
    },
    folder: { type: "session", directory: "/s" },
    ui: { languageCode: "en", appVersion: "test" },
  };
}

describe("buildPluginConnection selection kind + media derivation", () => {
  it("media file → kind 'media', media name is the file itself", () => {
    const conn = buildPluginConnection(context("ETR009.wav", "wav"), api);
    expect(conn.selectionKind).toBe("media");
    expect(conn.mediaFileName).toBe("ETR009.wav");
    expect(conn.selectedFileName).toBe("ETR009.wav");
  });

  it("an .eaf → kind 'eaf', media derived from the eaf", () => {
    const conn = buildPluginConnection(
      context("ETR009.wav.annotations.eaf", "eaf", "Unknown"),
      api,
    );
    expect(conn.selectionKind).toBe("eaf");
    expect(conn.mediaFileName).toBe("ETR009.wav");
  });

  it("a .oralAnnotations.wav → kind 'oralAnnotations', media = suffix stripped", () => {
    const conn = buildPluginConnection(context("ETR009.wav.oralAnnotations.wav", "wav"), api);
    expect(conn.selectionKind).toBe("oralAnnotations");
    expect(conn.mediaFileName).toBe("ETR009.wav");
    expect(conn.selectedFileName).toBe("ETR009.wav.oralAnnotations.wav");
  });

  it("recognizes the combined-file suffix case-insensitively", () => {
    const conn = buildPluginConnection(context("m.WAV.OralAnnotations.wav", "wav"), api);
    expect(conn.selectionKind).toBe("oralAnnotations");
    // Stripped by suffix length, preserving the media name's original casing.
    expect(conn.mediaFileName).toBe("m.WAV");
  });
});
