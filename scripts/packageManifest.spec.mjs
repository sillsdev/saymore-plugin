import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PACKAGES, manifestForPackage } from "./packageManifest.mjs";

const source = readFileSync(new URL("../public/plugin.json5", import.meta.url), "utf8");

// Evaluates JSON5 text well enough for this file: object literal with comments.
const parse = (text) => new Function(`return (${text});`)();

describe("manifestForPackage", () => {
  it("adds platforms and binaries for the Windows package and keeps the rest", () => {
    const manifest = parse(manifestForPackage(source, PACKAGES.win));
    expect(manifest.platforms).toEqual(["win32-x64"]);
    expect(manifest.binaries).toEqual({ ffmpeg: { "win32-x64": "bin/ffmpeg.exe" } });
    expect(manifest.id).toBe(parse(source).id);
    expect(manifest.permissions).toContain("ffmpeg");
  });

  it("points both Mac architectures at one universal binary", () => {
    const manifest = parse(manifestForPackage(source, PACKAGES.mac));
    expect(manifest.platforms).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(manifest.binaries.ffmpeg).toEqual({
      "darwin-arm64": "bin/ffmpeg",
      "darwin-x64": "bin/ffmpeg",
    });
  });

  it("gives each Mac architecture its own file when the binaries are separate", () => {
    const manifest = parse(manifestForPackage(source, PACKAGES.macSeparate));
    expect(manifest.binaries.ffmpeg["darwin-arm64"]).toBe("bin/darwin-arm64/ffmpeg");
    expect(manifest.binaries.ffmpeg["darwin-x64"]).toBe("bin/darwin-x64/ffmpeg");
  });

  it("lists a binary for every platform it claims", () => {
    for (const pkg of Object.values(PACKAGES)) {
      const manifest = parse(manifestForPackage(source, pkg));
      expect(Object.keys(manifest.binaries.ffmpeg).sort()).toEqual([...manifest.platforms].sort());
    }
  });
});
