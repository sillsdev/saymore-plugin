**⚠️This is a Work in Progress**

# Saymore Audio Annotation Plugin for Lameta
A SayMore-compatible audio annotation SPA — Manual Segmenter, Auto Segmenter, and the Transcription / Free-Translation grid.

## Installing
1) Get the latest release on the github page.
2) In lameta, choose `File: Plugins`:
<img width="872" height="385" alt="image" src="https://github.com/user-attachments/assets/40518cc6-0b7f-4959-9bec-709fa8f3b060" />

# Developing

```sh
vp install    # install dependencies
vp dev        # a hot-reloaded simulation in a browser tab
vp build      # production build (Vite + Rolldown) → dist/
vp build:watch # keep `dist/` up to date. Use with lameta's Developer mode for plugins where it watches a folder.
vp test       # Vitest (node env by default; component specs opt into happy-dom)
vp check      # format (Oxfmt) + lint & type-check (Oxlint) — run before committing
```
