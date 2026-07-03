import { STANDARD_AUDIO_SUFFIX } from "../model/SayMoreConstants";

/**
 * Client-side mirror of the host's companion-file allowlist (see
 * `D:/lameta/plugins/docs/plugin-authoring.md` → "Companion files"). The host
 * validates every `companions.*` path too, but computing the same allowlist here
 * lets {@link PluginHostAdapter} throw an early, descriptive error instead of a
 * generic host rejection when a bug asks for a path outside the scope.
 *
 * Given the selected file `F` (with extension) and
 * `S = <F without extension>_StandardAudio.wav` (SayMore's PCM conversion of
 * non-WAV media), the allowed relative paths are exactly, for `B` in {F, S}:
 *
 *   B.annotations.eaf                 the ELAN annotation file
 *   B.annotations.pfsx                ELAN prefs (eaf extension replaced)
 *   B.annotations.psfx                same prefs under SayMore's transposed spelling
 *   B.oralAnnotations.wav             generated oral-annotations file
 *   B_Annotations/<name>.wav          per-segment recordings (one level, .wav only)
 *   S                                 the _StandardAudio.wav conversion itself
 *
 * `F` itself is NOT a companion — it is the selected file, read through
 * `getFileBytes()` — so it is deliberately absent from the allowed set.
 * Comparison is case-insensitive and accepts `\` or `/` separators.
 */
export interface CompanionAllowlist {
  /** The `..._Annotations` folder names (one per base) that may hold segment WAVs. */
  readonly annotationDirs: string[];
  /** Allowed top-level companion paths (exact, original casing) — for tests/inspection. */
  readonly topLevel: string[];
  /** True if `relPath` is an allowed companion (top-level or `<dir>/<name>.wav`). */
  isAllowed(relPath: string): boolean;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return dot > slash ? name.slice(0, dot) : name;
}

/** Normalise separators to `/` (companions are `/`-relative on our side). */
function normalize(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

/** The `_StandardAudio.wav` sibling name for a selected media file. */
export function standardAudioNameFor(selectedFileName: string): string {
  return stripExtension(selectedFileName) + STANDARD_AUDIO_SUFFIX;
}

export function computeCompanionAllowlist(selectedFileName: string): CompanionAllowlist {
  const standard = standardAudioNameFor(selectedFileName);
  // If the selected file already IS the standard-audio conversion, F and S
  // coincide and we only have one family.
  const bases =
    selectedFileName.toLowerCase() === standard.toLowerCase()
      ? [selectedFileName]
      : [selectedFileName, standard];

  const topLevel: string[] = [];
  const annotationDirs: string[] = [];
  for (const base of bases) {
    topLevel.push(
      `${base}.annotations.eaf`,
      `${base}.annotations.pfsx`,
      `${base}.annotations.psfx`,
      `${base}.oralAnnotations.wav`,
    );
    annotationDirs.push(`${base}_Annotations`);
  }
  // The _StandardAudio.wav conversion itself is a readable companion.
  if (bases.includes(standard)) topLevel.push(standard);

  const topLevelLower = new Set(topLevel.map((n) => n.toLowerCase()));
  const dirsLower = annotationDirs.map((d) => d.toLowerCase());

  function isAllowed(relPath: string): boolean {
    const norm = normalize(relPath);
    if (norm.length === 0) return false;
    if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) return false; // absolute
    if (norm.split("/").some((seg) => seg === "..")) return false;

    const lower = norm.toLowerCase();
    if (topLevelLower.has(lower)) return true;

    const slash = lower.indexOf("/");
    if (slash === -1) return false;
    const dir = lower.slice(0, slash);
    const rest = lower.slice(slash + 1);
    // Exactly one level deep, .wav only.
    return (
      dirsLower.includes(dir) && rest.length > 0 && !rest.includes("/") && rest.endsWith(".wav")
    );
  }

  return { annotationDirs, topLevel, isAllowed };
}
