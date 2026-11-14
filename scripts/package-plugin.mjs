// Build the SPA and zip it into one `.lmplug` per platform, each with its own ffmpeg:
//
//   saymore-audio-win-x64.lmplug   dist/ + bin/win32-x64/ffmpeg.exe
//   saymore-audio-mac.lmplug       dist/ + bin/darwin-arm64/ffmpeg + bin/darwin-x64/ffmpeg
//
// Usage:
//   node scripts/package-plugin.mjs                 # vp build, then both packages
//   node scripts/package-plugin.mjs --target win    # only the Windows package (or: mac)
//   node scripts/package-plugin.mjs --no-build      # reuse an existing dist/
//
// The ffmpeg binaries come from a release of the ffmpeg-ffprobe-static project (the same build
// lameta ships), downloaded once and cached. Only ffmpeg is bundled; lameta supplies ffprobe.
// lameta makes the binary executable before it runs it, so the zip needs no Unix modes.
// For the live dev loop you don't need this at all: run `vp build --watch` and point lameta's
// "Developer plugin folder" at dist/.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PACKAGES, ffmpegPath, manifestForPackage } from "./packageManifest.mjs";

const RELEASE_TAG = "b6.1.2-rc.1";
const FFMPEG_VERSION = "n6.1.2";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");
const cacheDir = join(repoRoot, "node_modules", ".cache", "saymore-packaging");

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : "all";
const targets = targetArg === "all" ? Object.keys(PACKAGES) : [targetArg];
for (const t of targets) {
  if (!PACKAGES[t]) throw new Error(`Unknown --target ${t}; use win, mac or all.`);
}

/** The ffmpeg binary for one platform key, e.g. "win32-x64"; cached between runs. */
async function ffmpegBinary(platformKey) {
  const cached = join(cacheDir, RELEASE_TAG, `ffmpeg-${platformKey}`);
  if (existsSync(cached)) return cached;
  const url = `https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/${RELEASE_TAG}/ffmpeg-${platformKey}`;
  console.log(`> download ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  return cached;
}

const thirdPartyNote = `Third-party software in this package
=====================================

This package includes ffmpeg, in the bin/ folder, so the plugin can convert audio.

  Program:  FFmpeg (https://ffmpeg.org)
  Version:  FFmpeg ${FFMPEG_VERSION}
  Build:    static GPLv3 build (configured with --enable-gpl --enable-version3), from the
            ffmpeg-ffprobe-static project, release ${RELEASE_TAG}:
            https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/tag/${RELEASE_TAG}
  License:  GNU General Public License version 3. FFMPEG-LICENSE.md is FFmpeg's own
            account of its licensing, and COPYING.GPLv3 is the full license text.
  Source:   FFmpeg source code: https://ffmpeg.org/download.html (release tag
            ${FFMPEG_VERSION}). The build scripts and the origin of each binary:
            https://github.com/descriptinc/ffmpeg-ffprobe-static

ffmpeg runs as a separate program. The plugin's own code is MIT licensed (see the plugin's
repository, https://github.com/sillsdev/saymore-plugin).
`;

/** Stage dist/ plus the package's binaries and license files; returns the staging dir. */
async function stage(pkg, name) {
  const stageDir = join(cacheDir, "stage", name);
  rmSync(stageDir, { recursive: true, force: true });
  cpSync(distDir, stageDir, { recursive: true });

  const binaries = await Promise.all(pkg.platforms.map(ffmpegBinary));
  pkg.platforms.forEach((platformKey, i) => {
    const dest = join(stageDir, ffmpegPath(platformKey));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(binaries[i], dest);
  });

  const sourceManifest = readFileSync(join(repoRoot, "public", "plugin.json5"), "utf8");
  writeFileSync(join(stageDir, "plugin.json5"), manifestForPackage(sourceManifest, pkg));
  // FFmpeg's license files from its n6.1.2 tag, kept in this repo: the release that the binaries
  // come from has a license file for Windows and Linux only, and that file points to
  // COPYING.GPLv3 without containing it.
  const licenses = join(repoRoot, "licenses", "ffmpeg");
  copyFileSync(join(licenses, "LICENSE.md"), join(stageDir, "FFMPEG-LICENSE.md"));
  copyFileSync(join(licenses, "COPYING.GPLv3"), join(stageDir, "COPYING.GPLv3"));
  writeFileSync(join(stageDir, "THIRD-PARTY.txt"), thirdPartyNote);
  return stageDir;
}

/** Zips the contents of `dir` (not the folder itself) with forward-slash entry names. */
function zipFolder(outFile, dir) {
  const entries = readdirSync(dir);
  if (process.platform === "win32") {
    // Windows ships bsdtar as tar.exe; it writes spec-compliant forward-slash zip entries
    // (PowerShell's Compress-Archive writes backslashes, which strict unzippers reject). The
    // absolute System32 path avoids a GNU `tar` earlier on PATH (e.g. Git's), which has no zip.
    const bsdtar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    execFileSync(bsdtar, ["--format", "zip", "-c", "-f", outFile, "-C", dir, ...entries], {
      stdio: "inherit",
    });
  } else {
    execFileSync("zip", ["-r", "-q", outFile, ...entries], { cwd: dir, stdio: "inherit" });
  }
}

if (!skipBuild) {
  console.log("> vp build");
  // `vp` resolves through the shell on Windows (it's a .cmd shim).
  execFileSync("vp", ["build"], { cwd: repoRoot, stdio: "inherit", shell: true });
}
if (!existsSync(join(distDir, "plugin.json5"))) {
  throw new Error(`No dist/plugin.json5. Run \`vp build\` first (or drop --no-build).`);
}

for (const name of targets) {
  const pkg = PACKAGES[name];
  const stageDir = await stage(pkg, name);
  const outFile = join(repoRoot, pkg.file);
  rmSync(outFile, { force: true });
  zipFolder(outFile, stageDir);
  console.log(`Wrote ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}
