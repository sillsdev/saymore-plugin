# Recorder-phase orchestration — coordinator resume record (2026-07-04, session 2)

**Wound down:** 2026-07-04 evening at John's request; resume ~next week. Companion to
`ORCHESTRATION-RESUME.md` (the earlier lameta-bring-up session record — still valid for the
lameta-side context). Coordinator: Claude Fable 5 (John's main session). Four workers in Orca
terminals on this repo, branch `main`, ONE SHARED CHECKOUT.

## What was built this session (all committed on `main`, reviewed by the coordinator)

**The Careful Speech / Oral Translation recorder, complete** (plan record:
`C:\Users\hatto\.claude\plans\plan-for-the-careful-zazzy-eclipse.md`):

- Track A (Opus): recorder contracts + `RecorderViewModel` (SpaceBarMode machine, listen-before-
  record gate exactly per C# — playback must REACH segment end; push-to-talk; <460ms discard;
  auto-advance; new-segment compound-undo flow; re-record backup/restore; erase; toggleIgnore;
  undo metadata; device recovery + Done/Error), `RecordingFileStore` (write-through overlay +
  serialized disk queue), merge wiring (real MicRecorder w/ fallback), combined-WAV regen on exit.
- Track B (Sonnet): `wavWriter`/`wavCodec` (+resampler), `MicRecorder` + **plain-JS self-contained
  AudioWorklet** (`recorderWorklet.js` — Vite/Rolldown does NOT process `audioWorklet.addModule`
  assets: no transpile, no import bundling, and `.ts` MIME-sniffs as `video/mp2t`; do not convert
  back), device switching (listDevices/setDevice), `generateOralAnnotationsWav` (faithful
  OralAnnotationFileGenerator.cs port) + worker/client.
- Track C (Sonnet): **Annotations pane moved harness→plugin** (`src/components/annotations/` —
  John: the toolbar belongs to the plugin; the lameta tab renders the whole pane), launch menu,
  `RecorderView` (2×2 aligned grid, real SayMore icons incl. the ear, hover Ignored/Undo,
  per-segment SVG play buttons, horizontal peak meter + device indicator w/ tooltip + icon-by-
  device-substring + in-app picker), playback cursors (shared `PlaybackCursor`, rAF+transform),
  Recording… spinner + live length, Oral Annotations viewer UI.
- Track D (Sonnet): **Playwright e2e** (`e2e/*.e2e.ts`, `pnpm run e2e`; fake-mic launch flags so
  the REAL MicRecorder records a synthetic tone). 19+ tests: harness/startAnnotating/segmenter/
  grid/recorder (byte-level re-record/erase/undo round-trip)/oralAnnotationPermanence — the
  **boundary DRAG works under Playwright** (headless CDP never could; the old deferred 1.25s
  rename-parity exercise is now an automated regression test).
- **Oral Annotations viewer** (new screen for `<media>.oralAnnotations.wav`): 3 stacked labeled
  channel rows, Play/Stop, spanning smooth cursor, click-to-seek, `pos / total` readout,
  staleness-aware AUTO-regen on open + manual Regenerate (MUI refresh glyph), harness tab chip,
  provider tab `oral-annotations` "Oral Annotations", embedded selection wired via
  `connectPlugin.selectionKind`.
- Two REAL pre-existing T1 bugs found by e2e and fixed: drag skipped the permanence confirm
  (BoundaryLayer), and the **autosave never flushed the oral-file rename journal** (fixed:
  eaf + WAV ops land in the same debounced flush via OralFileReconciler; save() is now
  finalize-on-exit only; incl. the rapid-nudge same-window coalescing follow-up).
- John decisions this session: provider tab renamed "Segments"→**"Annotations"**, opens
  **grid-first**; recorder opens with ZERO segments allowed; recorder state shown by **waveform
  opacity (ignored 30% / normal 70% / current 100%), NO background fills** (last C commit of the
  session); source-row waveform is BLUE; play buttons are SVG.

## Multi-agent mechanics learned (IMPORTANT for resume)

- One checkout = ONE SHARED GIT INDEX. Mandatory protocol: `git add <files>` + `git commit -m msg
-- <your paths>` atomically; NEVER bare `git commit`/`-a`; verify `git show --stat HEAD`; NO
  reset/amend/rebase without a coordinator freeze (two independent soft-resets collided once).
  Memory: `shared-index-commit-protocol`.
- Comms: every message via BOTH `orca orchestration send` AND `orca terminal send --enter`
  (single-paragraph). Coordinator polls its inbox via a background monitor. Terminal handles are
  runtime-scoped — STALE after Orca restart; next session spawns fresh workers.

## Remaining / next session

**FIX FIRST — two real bugs found by the final e2e pass (fixme-gated in the e2e files with full
in-file diagnoses; from Worker D's wind-down report):**

1. **WAV-naming float vs eaf ms-rounding mismatch** — new recordings name their WAVs from the
   segment's LIVE unrounded boundary float, but the eaf persists ms-rounded TIME_VALUEs; after any
   reload the OralAnnotationIndex csFloat-token match fails, so permanence/Regenerate/staleness
   silently break for same-session-recorded segments (regenerateCombinedOralWav silently skips).
   Fix: derive names from the ms-rounded (eaf-persisted) boundary values — owner: state/recorder
   naming or fs/OralAnnotationFiles comparison. Gated tests: oralAnnotationsViewer.e2e.ts (2).
2. **ecbdd52 regression: re-record button unmounts mid-gesture** — the cell swaps to the
   Recording… spinner state the instant `isRecording` flips, unmounting the pressed re-record
   button; its pointerup is orphaned and the VM sticks in "recording" forever. Fix in
   AnnotationCellsLayer.tsx (keep the pressed control mounted through the gesture, or route the
   release through a window-level listener). Gated test: recorder.e2e.ts (1).
   **Smoke-test workaround until fixed: avoid mouse re-record, or press Esc to abort if stuck.**

3. **John's real-mic smoke test** of the recorder + viewer in the harness (`vp dev`, Chromium).
4. **lameta live integration check**: `vp build` → Developer-plugin-folder; verify mic permission
   in the plugin iframe, the "Annotations" + "Oral Annotations" tabs (host tab-provider RUNTIME
   wiring must exist on the lameta side — see ORCHESTRATION-RESUME.md remaining item 1).
5. SayMore cross-check (optional, John): record in plugin → open the session in real SayMore.
6. Backlog unchanged from PLAN.md: full T2 grid UX, T3 in-segmenter auto-segment dialog, Phase-4
   hardening, exports.

## Verification state at wind-down (HEAD fdbe68e + this doc) — READ THIS FIRST

- `vp test` **345 passed / 1 skipped** — unit suite fully green.
- `pnpm run e2e`: **17–18 passed / 4–5 FAILED / 3 fixme-skipped** on a FRESH dev server.
  **The last commit of the session (`ecbdd52`, the opacity redesign of the recorder rows) broke
  ~5 e2e tests** (viewer chip/rows, viewer Play-cursor, click-to-seek, recorder armed-record,
  too-short) in addition to the proven re-record-unmount regression it caused. Worker D reported
  21-passed at fdbe68e, but Playwright's `reuseExistingServer: true` most likely reused a dev
  server started BEFORE ecbdd52 — i.e. D certified stale code. Failures reproduce serially
  (`--workers=1`), so it is not flakiness. One observed symptom: a setup step expecting
  "Segments: 2" sees "Segments: 1" (error contexts under `test-results/`).
- **Next session step 0: fix the ecbdd52 e2e regressions** (start from the re-record-unmount
  diagnosis in recorder.e2e.ts + the error-context files; suspect the cell/overlay re-render
  structure the opacity redesign introduced), THEN the two fixme-gated bugs below.
- Process note for whoever runs e2e: restart the dev server after pulling (or set
  `reuseExistingServer: false` locally) — a reused stale server silently certifies old code.
  Everything committed on `main`; no uncommitted work from any track.
