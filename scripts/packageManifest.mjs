// The per-platform packages and the manifest text each one carries. Kept apart from
// package-plugin.mjs so a unit test can import it without building anything.

export const PACKAGES = {
  win: {
    file: "saymore-audio-win-x64.lmplug",
    platforms: ["win32-x64"],
    ffmpegPaths: { "win32-x64": "bin/ffmpeg.exe" },
  },
  // One universal binary for both Macs, made with lipo.
  mac: {
    file: "saymore-audio-mac.lmplug",
    platforms: ["darwin-arm64", "darwin-x64"],
    ffmpegPaths: { "darwin-arm64": "bin/ffmpeg", "darwin-x64": "bin/ffmpeg" },
  },
  // Where lipo is unavailable (e.g. building on Windows), each Mac architecture gets its own file.
  macSeparate: {
    file: "saymore-audio-mac.lmplug",
    platforms: ["darwin-arm64", "darwin-x64"],
    ffmpegPaths: {
      "darwin-arm64": "bin/darwin-arm64/ffmpeg",
      "darwin-x64": "bin/darwin-x64/ffmpeg",
    },
  },
};

const q = (s) => JSON.stringify(s);

/**
 * Adds `platforms` and `binaries` to the text of public/plugin.json5, keeping its comments.
 * They go just before the closing brace of the top-level object.
 */
export function manifestForPackage(sourceText, pkg) {
  const end = sourceText.lastIndexOf("}");
  if (end < 0) throw new Error("plugin.json5 has no closing brace");
  const head = sourceText.slice(0, end).replace(/\s+$/, "");
  const entries = Object.entries(pkg.ffmpegPaths)
    .map(([platform, path]) => `      ${q(platform)}: ${q(path)},`)
    .join("\n");
  const added = [
    "",
    "  // Added at packaging time: the platforms this package is for and the ffmpeg it carries.",
    `  platforms: [${pkg.platforms.map(q).join(", ")}],`,
    "  binaries: {",
    "    ffmpeg: {",
    entries,
    "    },",
    "  },",
  ].join("\n");
  const separator = head.endsWith(",") || head.endsWith("{") ? "" : ",";
  return `${head}${separator}\n${added}\n${sourceText.slice(end)}`;
}
