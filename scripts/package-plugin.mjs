// Build the SPA and zip dist/ into a distributable `.lmplug` (a zip with a
// different extension; plugin.json5 lands at the archive root because it is copied
// there from public/ by the build). Usage:
//
//   node scripts/package-plugin.mjs            # vp build, then zip
//   node scripts/package-plugin.mjs --no-build # zip an existing dist/
//
// For the live dev loop you don't need this at all: run `vp build --watch` and
// point lameta's "Developer plugin folder" at dist/.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");
const manifest = join(distDir, "plugin.json5");
const outFile = join(repoRoot, "saymore-audio.lmplug");

const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  console.log("> vp build");
  // `vp` resolves through the shell on Windows (it's a .cmd shim).
  execFileSync("vp", ["build"], { cwd: repoRoot, stdio: "inherit", shell: true });
}

if (!existsSync(distDir)) {
  throw new Error(`No dist/ at ${distDir}. Run \`vp build\` first (or drop --no-build).`);
}
if (!existsSync(manifest)) {
  throw new Error(`dist/ has no plugin.json5 — is public/plugin.json5 present?`);
}

if (existsSync(outFile)) rmSync(outFile);

// Archive the dist/ entries with plugin.json5 at the root. We pass the top-level
// names explicitly (rather than a glob or ".") so entry names are clean, e.g.
// "plugin.json5" and "assets/index-*.js" — no "./" prefix, and forward slashes.
const entries = readdirSync(distDir);

if (process.platform === "win32") {
  // Windows ships bsdtar as tar.exe; it writes spec-compliant forward-slash zip
  // entries (PowerShell's Compress-Archive writes backslashes, which strict
  // unzippers reject). `--format zip` lets us emit straight to the .lmplug name.
  // Use the absolute System32 path so we don't accidentally pick up a GNU `tar`
  // earlier on PATH (e.g. Git's), which has no zip support.
  const bsdtar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  execFileSync(bsdtar, ["--format", "zip", "-c", "-f", outFile, "-C", distDir, ...entries], {
    stdio: "inherit",
  });
} else {
  // zip the dist/ entries (so plugin.json5 is at the root, not under dist/).
  execFileSync("zip", ["-r", "-q", outFile, ...entries], { cwd: distDir, stdio: "inherit" });
}

console.log(`\nWrote ${outFile} (${(statSync(outFile).size / 1024).toFixed(0)} KB)`);
