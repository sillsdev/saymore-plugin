# Handoff: saymore-plugin (SayMore-compatible audio annotation SPA → lameta plugin)

**How to use this:** start Claude Code in `D:\saymore-plugin` and say
"read docs/HANDOFF.md and docs/PLAN.md, then continue".

## What this project is

Reimplementation of SayMore's audio annotation tools (Manual Segmenter, Auto Segmenter,
Transcription/Free-Translation grid; recorders later) as a React SPA with **exact SayMore on-disk
compatibility**, to be packaged as a lameta file-handler plugin (iframe + postMessage).
`docs/PLAN.md` is the authoritative spec — architecture, contracts, SayMore compat rules,
execution status, and remaining phases. Read it before doing anything.

## Current state (2026-07-03)

- Working Manual Segmenter vertical slice: `vp dev` → drop a WAV or pick a session folder
  (Chromium only — File System Access API) → waveform → SayMore-parity segmenting → valid
  `.annotations.eaf`. Try `test-data/session/` (real fixture incl. `_Annotations` WAVs — moving
  the boundary at 1.25s triggers the oral-annotation permanence flow).
- Auto-segmenter core: faithful port of SayMore's algorithm + SayMore's own tests
  (`src/audio/autoSegmenter*`). No UI/dialog yet.
- 139 specs green under the new toolchain; `vp build`, `vp check` clean (verified 2026-07-03).
- Git: `2077d81` (Vite+ migration) on top of `d9ad439` (import from lameta). Uncommitted: the
  maintainer's README edit (theirs — don't revert), possibly this handoff.

## Toolchain — THIS REPO IS DIFFERENT FROM LAMETA

- **Vite+ (`vp`) + pnpm. NEVER npm or yarn here.** `vp install`, `vp dev`, `vp test`,
  `vp check` (Oxfmt + Oxlint — run before committing), `vp build`. See `AGENTS.md`.
  Vite 8 / Rolldown / Vitest 4 / TS 6 preview. `pnpm-workspace.yaml` only holds the Vite+ catalog.
- The lameta repos (`D:\lameta\*`) remain **yarn classic only** — don't mix the two rules up.
- Nit: a stale `yarn.lock` from the pre-migration import is still tracked; safe to delete.
- Nit: README's "Status" section says "Phase 0 only" — stale (slice + auto-segmenter landed).

## History / origins (context, no action needed)

Developed originally as `audio-annotation/` inside `D:\lameta\transcribe` (lameta worktree, branch
`transcribe`, commits `39ba80ca`, `dc87446e`, `a70656a1`) by parallel Claude agents in Orca
terminals. Everything was copied here (verified: file-complete including post-commit working-tree
fixes like `editPositionSec`; remaining old-vs-new diffs are Oxfmt formatting only; old
`eslint.config.mjs` intentionally replaced by Oxlint). The lameta copy is now abandoned in place —
when the maintainer wants it cleaned, also revert lameta's root `vitest.config.js` exclude and
`eslint.config.mjs` ignore one-liners.

## Key external references

- **SayMore source (read-only reference for parity):** `D:\saymore\src\SayMore\` — esp.
  `Transcription\Model\AnnotationFileHelper.cs` (EAF), `TimeTier.cs`/`TierCollection.cs` (rules +
  `{start}_to_{end}_Careful.wav` naming, culture-sensitive C# float formatting — see
  `src/fs/csFloat.ts` + `test-data/csfloat/`), `UI\TextAnnotationGrid\TextAnnotationEditorGrid.cs`
  (grid UX for T2), `ManualSegmenterDlg.cs`. SayMore user docs (decompiled CHM) can be regenerated:
  `hh.exe -decompile <outdir> "D:\saymore\docs\SayMore.chm"`.
- **Plugin host:** `D:/lameta/plugins/docs/plugin-authoring.md`. The host API we need is
  IMPLEMENTED on the lameta `plugins` branch: permission-gated `api.companions.*`
  (list/exists/readText/readBytes/writeText/writeBytes/rename/delete/stat, scoped to the SayMore
  companion allowlist incl. `.pfsx`/`.psfx` extension-replaced forms), `readFileRange`, documented
  write-completion-on-teardown guarantee, mic plumbing. Client kit to vendor:
  `D:/lameta/plugins/src/plugins/client/lametaPluginClient.ts`.
- **Agent comms with the plugin-system agent:** `D:\saymore-plugin-agent-comms\` — drop a dated
  `.md` file there to reach them; they watch the directory. Full thread history there.

## Next steps (in rough priority; confirm with the maintainer)

1. **Plugin packaging (the fastest visible win):** `plugin.json5` (one tab matching `Audio`,
   `permissions: ["companionFiles"]`), `PluginHostAdapter implements FileSystemAdapter` over
   `companions.*` (validate the allowlist client-side, throw early), vendor the client kit,
   `vp build` output + manifest → `.lmplug` zip; iterate via lameta's Developer-plugin-folder
   watch loop. The `FileSystemAdapter` seam (`src/fs/FileSystemAdapter.ts`) was designed to make
   this a one-adapter job.
2. **T2 Transcription grid** (plan Phase 3): virtualized 3-col grid, per-column playback options
   incl. existing careful/translation WAVs via `OralAnnotationIndex.readSegmentWav`.
3. **T3 Auto-segmenter dialog + apply step** (small).
4. **Phase 4 hardening:** `%junk%` read-compat, `EXTRACTED_FROM` video EAFs, external-change
   reload, full manual protocol vs real SayMore + ELAN.
5. Later phase: careful-speech/oral-translation recorders + `.oralAnnotations.wav` generation.

## Working conventions the maintainer expects

- Attribution: anything posted under the maintainer's name (PRs, comments, agent-comms docs) starts with
  `[<friendly model name>]`.
- Python on this machine is `py`, never `python`.
- Multi-agent orchestration happens via Orca CLI (`orca` — on PATH in PowerShell, NOT in Git
  Bash). Pattern that works: `orca terminal create --worktree path:<repo> --command "claude
  --model <model>"`, wait for tui-idle, then send a SHORT pointer prompt to a task-brief file
  (long pasted prompts get truncated by the TUI). Give concurrent same-worktree agents disjoint
  file-ownership lists and "git add only your own paths".
- The maintainer reviews plans interactively — discuss architectural decisions with trade-offs before
  building; they chose: wavesurfer v7 + custom overlay (no Regions), HTMLMediaElement-only playback,
  MobX 6, DOM-preserving EAF edits, exact SayMore file compat, recorders deferred.
