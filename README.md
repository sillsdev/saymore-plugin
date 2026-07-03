# saymore-plugin

A SayMore-compatible audio annotation SPA — Manual Segmenter, Auto Segmenter, and
the Transcription / Free-Translation grid — to be packaged as a lameta
file-handler plugin. Originally developed as a sub-package of the lameta repo,
now its own repository.

The authoritative spec (architecture, module layout, interface signatures,
milestones, risks, execution status) lives in [`docs/PLAN.md`](docs/PLAN.md).
This README covers only how to run and test the package.

## Ground rules

- **yarn classic only — never npm.**
- Own `package.json` + `yarn.lock`; no workspaces.
- Own React 18 (the plugin hosts this in an iframe/webview), but keeps lameta team
  conventions: Emotion `css` prop, MobX 6 + `observer`, colocated `*.spec.ts`.
- Vite 5 / Vitest 3 / TS 5.5 to match lameta.

## Scripts

```sh
yarn install
yarn dev      # Vite dev server — renders the shell
yarn build    # tsc --noEmit && vite build
yarn test     # vitest run (node env by default; component specs opt into happy-dom)
yarn lint     # eslint .
```

## Layout

```
src/
  main.tsx, App.tsx    # shell (hello-world in Phase 0; OpenScreen → tools later)
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

**Phase 0 (scaffold + contracts + fixtures) only.** The type-only contracts under
`src/` compile and have fake/spy implementations that all parallel Phase-1 tracks
code against; they are intentionally not yet functional. See the plan for the
milestone breakdown.

## Manual test protocol

(To be filled in as tools land — Phase 4.) The compatibility gate is: copy a real
SayMore session → edit in this SPA → reopen in SayMore **and** ELAN, verify
playback and that foreign tiers survive.
