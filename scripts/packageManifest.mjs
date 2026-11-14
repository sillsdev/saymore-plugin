// The per-platform packages and the manifest text each one carries. Kept apart from
// package-plugin.mjs so a unit test can import it without building anything.

export const PACKAGES = {
  win: { file: "saymore-audio-win-x64.lmplug", platforms: ["win32-x64"] },
  mac: { file: "saymore-audio-mac.lmplug", platforms: ["darwin-arm64", "darwin-x64"] },
};

/** Where a package keeps the ffmpeg for one platform key, e.g. "bin/darwin-arm64/ffmpeg". */
export function ffmpegPath(platformKey) {
  return `bin/${platformKey}/ffmpeg${platformKey.startsWith("win32-") ? ".exe" : ""}`;
}

const q = (s) => JSON.stringify(s);

/**
 * Adds `platforms` and `binaries` to the text of public/plugin.json5, keeping its comments.
 * They go just before the closing brace of the top-level object.
 */
export function manifestForPackage(sourceText, pkg) {
  const end = sourceText.lastIndexOf("}");
  if (end < 0) throw new Error("plugin.json5 has no closing brace");
  const head = sourceText.slice(0, end).replace(/\s+$/, "");
  const added = [
    "",
    "  // Added at packaging time: the platforms this package is for and the ffmpeg it carries.",
    `  platforms: [${pkg.platforms.map(q).join(", ")}],`,
    "  binaries: {",
    "    ffmpeg: {",
    ...pkg.platforms.map((p) => `      ${q(p)}: ${q(ffmpegPath(p))},`),
    "    },",
    "  },",
  ].join("\n");
  const separator = head.endsWith(",") || head.endsWith("{") ? "" : ",";
  return `${head}${separator}\n${added}\n${sourceText.slice(end)}`;
}
