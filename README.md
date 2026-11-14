**⚠️This is a Work in Progress**

# Saymore Audio Annotation Plugin for Lameta
A SayMore-compatible audio annotation — ELAN-compatible written and oral transcription and translation.

<img width="698" height="328" alt="image" src="https://github.com/user-attachments/assets/b2972faa-f6c2-480c-a82d-8881d46b5d9b" />

---

<img width="689" height="438" alt="image" src="https://github.com/user-attachments/assets/00c2fb59-29cf-4ccb-86c7-033d536916c3" />

## Installing
1) Get the latest release on the github page and download the file for your computer:
   - Windows: `saymore-audio-win-x64.lmplug`
   - Mac (Apple Silicon and Intel): `saymore-audio-mac.lmplug`
   Each file includes its own copy of ffmpeg, so nothing else needs installing.
2) In lameta, choose `File: Plugins`:
<img width="872" height="385" alt="image" src="https://github.com/user-attachments/assets/40518cc6-0b7f-4959-9bec-709fa8f3b060" />

# Developing

```sh
vp install    # install dependencies
vp dev        # a hot-reloaded simulation in a browser tab
vp build      # production build (Vite + Rolldown) → dist/
vp build --watch # keep `dist/` up to date. Use with lameta's Developer mode for plugins where it watches a folder.
vp test    
vp check      # format, lint, type-check
```

## Building the packages

`pnpm run package` builds both files (`package:win` or `package:mac` for one). Each is the built plugin plus ffmpeg for that platform, with the manifest's `platforms` and `binaries` filled in, FFmpeg's license files (`FFMPEG-LICENSE.md` and `COPYING.GPLv3`, kept in `licenses/ffmpeg/`) and `THIRD-PARTY.txt`. The ffmpeg binaries, one per platform under `bin/<platform>/`, come from a release of the `ffmpeg-ffprobe-static` project (a GPLv3 build), downloaded on the first run and cached in `node_modules/.cache`; ffprobe is not included.
