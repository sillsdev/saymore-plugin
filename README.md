**⚠️This is a Work in Progress**

# saymore-plugin

A SayMore-compatible audio annotation SPA — Manual Segmenter, Auto Segmenter, and

the Transcription / Free-Translation grid — to be packaged as a lameta

file-handler plugin. Originally developed as a sub-package of the lameta repo,

now its own repository.

The authoritative spec (architecture, module layout, interface signatures,

milestones, risks, execution status) lives in [`docs/PLAN.md`](docs/PLAN.md).

This README covers only how to run and test the package.

## Ground rules

- **Vite+ (`vp`) + pnpm — never npm or yarn.** Run `vp install` after pulling. See

  [`AGENTS.md`](AGENTS.md).
- Own `package.json` + `pnpm-lock.yaml`. `pnpm-workspace.yaml` exists only to hold

  the Vite+ catalog that pins tooling versions; there are no sub-packages.
- Own React 18 (the plugin hosts this in an iframe/webview), but keeps lameta team

  conventions: Emotion `css` prop, MobX 6 + `observer`, colocated `*.spec.ts`.
- Built on Vite+ (Vite 8 / Rolldown / Vitest 4 / Oxlint / Oxfmt) with the TS 6

  preview compiler.

## Scripts

```sh
vp install    # install deps (pnpm under the hood)
vp dev        # Vite dev server — renders the shell
vp build      # production build (Vite + Rolldown) → dist/
vp preview    # serve the production build locally
vp test       # Vitest (node env by default; component specs opt into happy-dom)
vp check      # format (Oxfmt) + lint & type-check (Oxlint) — run before committing
```

## Layout

```
src/
  main.tsx, App.tsx    # shell: plugin-iframe or OpenScreen → Manual Segmenter
  plugin/              # lameta plugin client kit + PluginHostAdapter + manifest glue
  l10n.ts              # t(id, default) seam; no Lingui yet
  model/               # TimeRange, AnnotationSegment, EAF doc, BoundaryRules, ...
  audio/               # envelope, EnvelopeCache, PlaybackEngine, autoSegmenter
  fs/                  # FileSystemAdapter seam + InMemory / BrowserDirectory adapters
  state/               # ProjectStore, AnnotationDocumentStore, view models
  components/          # waveform surface + overlay, segmenter, grid, shell
  harness/             # dev-only debug panels
test-data/             # fixtures — see test-data/README.md
```

## Status

**Working Manual Segmenter vertical slice + auto-segmenter core.** In the dev

harness (`vp dev`) you can drop a WAV or open a SayMore session folder (Chromium

only — File System Access API), see the waveform, segment with SayMore parity, and

write a valid `.annotations.eaf`. The Auto Segmenter has a faithful algorithm port

(no dialog yet); the Transcription grid is not built yet. The package can also be

built and run **inside lameta as a file-handler plugin** (see below). See

[`docs/PLAN.md`](docs/PLAN.md) for the full milestone breakdown and remaining phases.

## Packaging as a lameta plugin

The SPA doubles as a lameta file-handler plugin: when embedded in lameta's plugin

iframe it connects over `postMessage`, wraps the host file API in a

`PluginHostAdapter` (`src/plugin/`), and opens the selected file's session — the

same `ProjectStore` the dev harness uses. `public/plugin.json5` is the manifest

(one **Audio** tab, `companionFiles` permission); Vite copies it to the build root,

so `dist/` is itself a ready-to-use plugin folder.

```sh
vp build              # → dist/ (index.html + assets + plugin.json5)
vp run package        # build, then zip dist/ → saymore-audio.lmplug
```

**Live dev loop:** run `vp build --watch`, then in lameta turn on Developer mode →

File → Plugins… → *Developer plugin folder* and point it at this repo's `dist/`.

lameta reloads the open tab whenever the build re-emits. Install a finished

`.lmplug` via File → Plugins… → *Install plugin…*.

## Manual test protocol

(To be filled in as tools land — Phase 4.) The compatibility gate is: copy a real

SayMore session → edit in this SPA → reopen in SayMore **and** ELAN, verify

playback and that foreign tiers survive.