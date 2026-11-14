// Build the SPA and zip it into one `.lmplug` per platform, each with its own ffmpeg:
//
//   saymore-audio-win-x64.lmplug   dist/ + bin/ffmpeg.exe
//   saymore-audio-mac.lmplug       dist/ + bin/ffmpeg (universal) for Apple Silicon and Intel
//
// Usage:
//   node scripts/package-plugin.mjs                 # vp build, then both packages
//   node scripts/package-plugin.mjs --target win    # only the Windows package (or: mac)
//   node scripts/package-plugin.mjs --no-build      # reuse an existing dist/
//
// The ffmpeg binaries are the ones the ffmpeg-ffprobe-static devDependency downloads from its
// GitHub release (the same build lameta ships). Only ffmpeg is bundled; lameta supplies ffprobe.
// For the live dev loop you don't need this at all: run `vp build --watch` and point lameta's
// "Developer plugin folder" at dist/.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { crc32, deflateRawSync } from "node:zlib";
import { PACKAGES, manifestForPackage } from "./packageManifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");
const cacheDir = join(repoRoot, "node_modules", ".cache", "saymore-packaging");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : "all";
const targets = targetArg === "all" ? ["win", "mac"] : [targetArg];
for (const t of targets) {
  if (!["win", "mac"].includes(t)) throw new Error(`Unknown --target ${t}; use win, mac or all.`);
}

const ffmpegPackageDir = dirname(require.resolve("ffmpeg-ffprobe-static/package.json"));
const releaseTag = JSON.parse(readFileSync(join(ffmpegPackageDir, "package.json"), "utf8"))[
  "ffmpeg-static"
]["binary-release-tag"];

/** The ffmpeg binary for one platform-arch, e.g. ("win32", "x64"); cached between runs. */
async function ffmpegBinary(platform, arch) {
  const ext = platform === "win32" ? ".exe" : "";
  const installed = join(ffmpegPackageDir, `ffmpeg${ext}`);
  if (process.platform === platform && process.arch === arch && existsSync(installed)) {
    return installed;
  }
  const cached = join(cacheDir, releaseTag, `ffmpeg-${platform}-${arch}${ext}`);
  if (existsSync(cached)) return cached;
  const url = `https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/${releaseTag}/ffmpeg-${platform}-${arch}`;
  console.log(`> download ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  return cached;
}

function haveLipo() {
  try {
    execFileSync("lipo", ["-info", process.execPath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ffmpegVersionLine(binary) {
  try {
    return execFileSync(binary, ["-version"], { encoding: "utf8" }).split(/\r?\n/)[0];
  } catch {
    return "ffmpeg 6.1.x";
  }
}

function thirdPartyNote(versionLine) {
  return `Third-party software in this package
=====================================

This package includes ffmpeg, in the bin/ folder, so the plugin can convert audio.

  Program:  FFmpeg (https://ffmpeg.org)
  Version:  ${versionLine}
  Build:    static GPLv3 build (configured with --enable-gpl --enable-version3), from the
            ffmpeg-ffprobe-static project, release ${releaseTag}:
            https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/tag/${releaseTag}
  License:  GNU General Public License version 3. The FFmpeg license text is in
            FFMPEG-LICENSE.txt in this package.
  Source:   FFmpeg source code: https://ffmpeg.org/download.html (the version above is the
            release tag n6.1.2). The build scripts and the origin of each binary:
            https://github.com/descriptinc/ffmpeg-ffprobe-static

ffmpeg runs as a separate program. The plugin's own code is MIT licensed (see the plugin's
repository, https://github.com/sillsdev/saymore-plugin).
`;
}

function licenseText() {
  for (const name of ["ffmpeg.exe.LICENSE", "ffmpeg.LICENSE"]) {
    const p = join(ffmpegPackageDir, name);
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`No ffmpeg license file in ${ffmpegPackageDir}`);
}

/** Stage dist/ plus the platform's binaries; returns the staging dir and the package definition. */
async function stage(target) {
  let pkg = PACKAGES[target];
  const stageDir = join(cacheDir, "stage", target);
  rmSync(stageDir, { recursive: true, force: true });
  cpSync(distDir, stageDir, { recursive: true });
  mkdirSync(join(stageDir, "bin"), { recursive: true });

  let versionBinary;
  if (target === "win") {
    const win = await ffmpegBinary("win32", "x64");
    copyFileSync(win, join(stageDir, "bin", "ffmpeg.exe"));
    versionBinary = process.platform === "win32" ? win : undefined;
  } else {
    const arm = await ffmpegBinary("darwin", "arm64");
    const x64 = await ffmpegBinary("darwin", "x64");
    if (haveLipo()) {
      const out = join(stageDir, "bin", "ffmpeg");
      execFileSync("lipo", ["-create", arm, x64, "-output", out]);
      chmodSync(out, 0o755);
      console.log("  mac: universal ffmpeg made with lipo");
    } else {
      pkg = PACKAGES.macSeparate;
      for (const [arch, src] of [
        ["arm64", arm],
        ["x64", x64],
      ]) {
        mkdirSync(join(stageDir, "bin", `darwin-${arch}`), { recursive: true });
        copyFileSync(src, join(stageDir, "bin", `darwin-${arch}`, "ffmpeg"));
      }
      console.log(
        "  mac: lipo not available, bundling bin/darwin-arm64/ffmpeg and bin/darwin-x64/ffmpeg",
      );
    }
  }

  const sourceManifest = readFileSync(join(repoRoot, "public", "plugin.json5"), "utf8");
  writeFileSync(join(stageDir, "plugin.json5"), manifestForPackage(sourceManifest, pkg));
  writeFileSync(join(stageDir, "FFMPEG-LICENSE.txt"), licenseText());
  const versionLine = versionBinary
    ? ffmpegVersionLine(versionBinary)
    : `FFmpeg n6.1.2 (build from ffmpeg-ffprobe-static ${releaseTag})`;
  writeFileSync(join(stageDir, "THIRD-PARTY.txt"), thirdPartyNote(versionLine));
  return { stageDir, pkg };
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Writes a zip with forward-slash names and unix modes (so bin/ffmpeg stays executable). */
function writeZip(outFile, baseDir) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const executable = (name) => name === "bin/ffmpeg" || /^bin\/[^/]+\/ffmpeg$/.test(name);
  for (const file of listFiles(baseDir)) {
    const name = relative(baseDir, file).split("\\").join("/");
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    chunks.push(header, nameBuf, packed);

    const mode = executable(name) ? 0o100755 : 0o100644;
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += header.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const count = central.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, end]));
}

if (!skipBuild) {
  console.log("> vp build");
  // `vp` resolves through the shell on Windows (it's a .cmd shim).
  execFileSync("vp", ["build"], { cwd: repoRoot, stdio: "inherit", shell: true });
}
if (!existsSync(join(distDir, "plugin.json5"))) {
  throw new Error(`No dist/plugin.json5. Run \`vp build\` first (or drop --no-build).`);
}

for (const target of targets) {
  const { stageDir, pkg } = await stage(target);
  const outFile = join(repoRoot, pkg.file);
  rmSync(outFile, { force: true });
  writeZip(outFile, stageDir);
  console.log(`Wrote ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}
