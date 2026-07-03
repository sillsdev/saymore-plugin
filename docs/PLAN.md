# SayMore-Compatible Audio Annotation SPA — sub-package in lameta

## Execution status (2026-07-03, branch `transcribe`)

- ✅ Phase 0 scaffold + contracts + fixtures — commit `39ba80ca`
- ✅ F5 auto-segmenter core port + ported C# tests — commit `dc87446e`
- ✅ T1 Manual Segmenter vertical slice (seeds F1/F2/F3/F4 modules) — commit `a70656a1`; 138 specs green, driven in Chromium. Documented divergences-from-plan per actual SayMore source: Space is a toggle (not hold), zoom Ctrl+1/2/3 = +10%/reset/−10% steps, 100% = 80px/s, too-short = timed red warning.
- ✅ Plugin host API: `companions.*` etc. implemented on lameta `plugins` branch incl. our pfsx/psfx allowlist correction; lameta now nests annotation files SayMore-style (comms thread: `D:/saymore-plugin-agent-comms/`)
- ⏳ Remaining: transcription grid (T2), auto-segmenter dialog/apply (T3), hardening (Phase 4), plugin packaging, recorders (later phase)

## Context

SayMore (legacy WinForms, D:\saymore) survives only because of its audio transcription tools: Manual Segmentation, Auto Segmenter, the Transcription/Free-Translation grid, and the Careful Speech / Oral Translation recorders. lameta (React 17/Electron, this repo) has none of them — audio gets a bare `<audio>` element and `.eaf` files get an "Open in ELAN" link. A plugin design for lameta is underway with another agent (iframe/webview hosting). This work builds the tools themselves as a standalone React SPA in a sub-package of the lameta repo, developed against one audio file (or a real SayMore session folder), packaged into the plugin later.

**Decisions made with the user:**

- **Exact SayMore on-disk compatibility** — projects must round-trip between SayMore, ELAN, and this tool.
- **Scope now:** Manual Segmenter, Auto Segmenter, Transcription grid. **Recorders (Careful Speech / Oral Translation) and `.oralAnnotations.wav` generation are a later phase**, but the architecture must accommodate them, and _existing_ careful/translation WAVs must play in the grid and be renamed/deleted correctly on boundary edits.
- **Tooling:** Vite 5 / Vitest 3 / TS 5.5 to match lameta; yarn classic 1.22 (never npm); own package.json + lockfile (precedent: `sample-data-generator/`), no workspaces.
- **Isolation:** plugin will host in iframe/webview → SPA uses its own React 18, but keeps team conventions: Emotion `css` prop, MobX 6 + `observer`, colocated `*.spec.ts`.

## SayMore compatibility contract (from code exploration of D:\saymore\src\SayMore)

Reference files: `Transcription\Model\AnnotationFileHelper.cs` (EAF), `TierCollection.cs`, `TimeTier.cs` (rules + WAV naming), `Model\AutoSegmenter.cs` (algorithm), `UI\TextAnnotationGrid\TextAnnotationEditorGrid.cs` (grid UX), `SegmentingAndRecording\ManualSegmenterDlg.cs` + `SegmenterDlgBaseViewModel.cs` (segmenter UX).

- **EAF file** `<mediafilename>.annotations.eaf` (media's own extension retained, e.g. `X.wav.annotations.eaf`). HEADER: `MEDIA_DESCRIPTOR` with `MEDIA_URL` = filename only (+ second descriptor with `EXTRACTED_FROM` for video-derived audio); `PROPERTY lastUsedAnnotationId`. `TIME_ORDER`: `TIME_SLOT ts{n}`, `TIME_VALUE` = integer ms (round(sec×1000)); tolerate missing TIME_VALUE via interpolation (ELAN "regular annotations"). Tier `Transcription` (ALIGNABLE_ANNOTATION `a{n}`); tier `Phrase Free Translation` with `PARENT_REF="Transcription"`, REF_ANNOTATION + ANNOTATION_REF (symbolic association). Case-insensitive TIER_ID match. New files seeded from `D:\saymore\DistFiles\annotationTemplate.etf`. Segments past media duration trimmed on save. Foreign tiers must survive save (SayMore edits the existing DOM).
- **Ignore flag** = transcription text `%ignore%` (read legacy `%junk%`). No XML attribute.
- **Oral annotation WAVs** in sibling folder `<mediafilepath>_Annotations/`, named `{start}_to_{end}_Careful.wav` / `_Translation.wav` where start/end are C# `float` seconds formatted by current-culture `string.Format` (`TimeTier.cs:123-134`). Moving a boundary renames these; deleting a segment deletes them. File presence = "has annotation". Boundary adjacent to such a WAV is "permanent" (confirm before move/delete).
- **Rules:** min segment length **460ms** (insert/drag/nudge clamped); on segmenter OK, if last boundary within 5s of end → extend to end (gap < min) or add trailing ignored segment, then backfill empty text segments; split inserts empty text (or `%ignore%` when splitting ignored); delete joins adjacent text. Segment identity is positional index across the three tiers. Completeness: transcription = all segments non-empty; translation = all non-ignored non-empty.
- **Auto segmenter** (port faithfully; tests at `D:\saymore\src\SayMoreTests\Transcription\Model\AutoSegmenterTests.cs`): params min 1000ms / max 10000ms / preferred pause 250ms / clamping 4e-6. Aggregate 1 sample/ms; ideal = midpoint(min,max); search ±(ideal+pause−min); raw score = Σ(|max|+|min|) per channel; adjusted = triangular-weighted neighborhood × (i·clamp+1)² distance penalty; pick minimum; early-exit below running average.
- **UX/keys:** Segmenter — Space hold-to-listen/stop, Enter add boundary, Delete remove selected, drag to move, ←/→ nudge ±5ms then auto-replay last 1000ms after 600ms, Ctrl+1/2/3 zoom (100–1000%), hover segment → play + Ignore, red flash on too-short. Grid — 3 columns (waveform thumbnail+play / Transcription / Free Translation), enter cell → autoplay after 250ms looping ≤5×, F2 replay/pause, Tab/Shift+Tab wrap skipping col 0, ↑/↓ skip ignored rows, ignored rows greyed "Ignored" non-editable, per-column font + playback-source Options menu (Source/Careful/Both; Source/Translation/Both), speed 10–100%, save EAF on cell change, reload on external EAF change.

## New sub-package: `audio-annotation/`

Root-level folder `D:\lameta\transcribe\audio-annotation\` with `package.json` (name `lameta-audio-annotation`, private), own `yarn.lock`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` (strict; `jsxImportSource: "@emotion/react"`), `eslint.config.mjs`, `README.md`, `test-data/`.

Deps: react/react-dom ^18.3, mobx ^6.13, mobx-react-lite ^4, @emotion/react+styled ^11.13, **wavesurfer.js ^7** (waveform render + media-element transport — user decision), @xmldom/xmldom (deterministic XML in node+browser; already a lameta dep), @tanstack/react-virtual (grid). Dev: vite ^5.3.4, vitest ^3.2.4, @vitejs/plugin-react ^4.3.1, typescript 5.5.3, happy-dom, @testing-library/react, @types/wicg-file-system-access. Scripts: `dev`, `build` (tsc --noEmit && vite build), `test`, `lint`. Vite config: `base: "./"` (iframe/file:// friendly), `worker: { format: "es" }`.

**Localization:** no Lingui initially — all UI strings go through a tiny `src/l10n.ts` `t(id, default)` wrapper with stable IDs so Lingui (or host message-passing) retrofits mechanically later.

**Root-repo edits (only two, land in Phase 0):**

- `vitest.config.js:22` — add `exclude: ["audio-annotation/**", "**/node_modules/**"]` (current `include: ["./**/*.spec.ts"]` would sweep the nested specs into root's happy-dom/setup environment).
- `eslint.config.mjs:8` — `ignores: ["dist", "locale/", "audio-annotation/"]`.
- No changes needed to root tsconfig (include limited to src/test), .gitignore (unanchored `node_modules`/`dist` already match), or CI (`.github/workflows/main.yml` never enters subdirs).

## Architecture

```
src/
  main.tsx, App.tsx            # shell: OpenScreen → Segmenter | Grid tools
  l10n.ts
  model/
    TimeRange.ts, AnnotationSegment.ts
    TierCollection.ts          # MobX: TimeTier "Source" + TextTiers "Transcription"/"Phrase Free Translation" in positional lockstep
    BoundaryRules.ts           # pure: insert/move/delete outcomes, 460ms clamps, permanence, split/join text, OK-time rules
    IgnoreMarkers.ts, Completeness.ts
    eaf/EafDocument.ts         # DOM-preserving parse/serialize (mirror AnnotationFileHelper.cs)
    eaf/eafTemplate.ts         # embedded annotationTemplate.etf content
  audio/
    envelope.ts                # 1-sample-per-ms min/max envelope (mirror AudioFileHelper.GetSamples): WAV → stream-parse PCM directly (no Web Audio, no full decode); compressed → decodeAudioData once, envelope, discard PCM. Shared by wavesurfer `peaks`, thumbnails, autosegmenter
    EnvelopeCache.ts           # per-channel envelope + sampleRate + duration (PCM is NOT retained)
    PlaybackEngine.ts          # wraps HTMLMediaElement(s): sub-range play with rAF stop-at-end, playbackRate 0.1–1.0, maxLoops, playSequence() for "Both" (careful/translation WAVs = small files → object URLs → own Audio elements); MobX position/isPlaying
    autoSegmenter.ts           # pure port; SampleSource seam mirrors C# IWaveStreamReader so NUnit tests port directly (input = the ms envelope)
    autoSegmenter.worker.ts
  fs/
    FileSystemAdapter.ts       # THE seam: list/read/write/rename/delete/getModifiedMs/watch? — relative to session folder
    BrowserDirectoryAdapter.ts # File System Access API (rename = copy+delete; Chromium-only, fine for dev)
    InMemoryAdapter.ts         # single-dropped-file mode + tests
    SessionFolder.ts           # find media (prefer *_StandardAudio.wav), .annotations.eaf, _Annotations/
    OralAnnotationFiles.ts     # {start}_to_{end}_Careful.wav naming, OralAnnotationIndex (permanence checks, applyOps, readSegmentWav)
    csFloat.ts                 # C#-float formatting parity (see Risks)
  state/
    ProjectStore.ts            # adapter + media Blob/URL + EnvelopeCache + OralAnnotationIndex + document store
    AnnotationDocumentStore.ts # source of truth: tiers, version/savedVersion dirty tracking, debounced autosave, external-change poll
    UndoStack.ts               # command pattern {apply, revert, fileOps}; recorders reuse later
    SegmenterViewModel.ts, GridViewModel.ts, PlaybackOptions.ts
  components/
    waveform/WaveformSurface.tsx  # wraps a wavesurfer v7 instance (MediaElement backend, precomputed peaks, minPxPerSec zoom); exposes a renderer-agnostic API (secondsToPx, scroll/zoom events, cursor) so the renderer stays swappable
    waveform/BoundaryLayer.tsx, SegmentShading.tsx  # custom overlay synced to WaveformSurface scroll/zoom: boundary lines, drag/select/hover, ignored shading, per-segment buttons; pure hit-test fns
    waveform/useViewport.ts
    segmenter/ManualSegmenterView.tsx, SegmenterToolbar.tsx, AutoSegmentDialog.tsx
    grid/TranscriptionGrid.tsx, GridRow.tsx, SegmentThumbnail.tsx, ColumnOptionsMenu.tsx, FontSettings.tsx
    shell/OpenScreen.tsx
  harness/                     # dev-only debug panels
```

**Waveform: wavesurfer.js v7 + custom interaction overlay (user decision).** wavesurfer (MediaElement backend) owns waveform rendering, zoom (`minPxPerSec`; SayMore 100% ≈ 96px/sec, range ×1–×10), scroll, playback cursor, and transport incl. `playbackRate`. We do NOT use its Regions plugin — SayMore's model is contiguous boundary-partitioned segments, so all interactions (clamped boundary drag, selection, ±5ms nudge + delayed replay, permanence confirms, ignored shading, hover Play/Ignore buttons) live in our own absolutely-positioned overlay synced to wavesurfer's scroll/zoom events, with pure unit-testable hit-test/clamp functions. wavesurfer is fed **precomputed peaks** from our envelope cache plus explicit `duration`, so it never decodes the media itself (flat memory on hour-long files). Grid thumbnails are tiny custom canvases sliced from the same envelope cache (a wavesurfer instance per row would be too heavy). Components depend only on the `WaveformSurface` wrapper API, so if high-zoom chunked-canvas performance disappoints on long files, the renderer can be swapped for a viewport-windowed custom canvas without touching the overlay or tools.

**Playback: HTMLMediaElement only (user decision).** Source media plays via wavesurfer's media element (streamed from a Blob/file URL — no PCM in memory); segment-range playback stops via rAF monitoring (~5–20ms precision; SayMore's MPlayer playback was not sample-accurate either). Careful/translation per-segment WAVs are small — object URLs on dedicated Audio elements, sequenced by `PlaybackEngine.playSequence` for the "Both" column options. Grid speed control = native `playbackRate` (pitch preserved by default).

**Deferred file ops (recorder-ready undo).** Boundary edits mutate only the in-memory model and journal `FileOp`s (`rename`/`delete` inside `_Annotations/`); undo pops commands+ops with zero disk churn. On save, the journal is coalesced (net original→final renames; intermediate drag positions never touch disk) and applied via `OralAnnotationIndex.applyOps` before writing the EAF. This mirrors SayMore's stage-in-temp-commit-on-OK design and is exactly what the recorders will need.

**External change watch:** poll `getModifiedMs` every 2s while focused + on window focus (record own writes' mtime to self-filter); use `adapter.watch` when the Electron bridge provides it. Not dirty → silent reload (SayMore behavior); dirty → banner Reload/Keep.

## Execution order: sequential foundation, then parallel tracks

The dependency graph forks after a short foundation **if the shared contracts are pinned first**. Each track below lists its owned directories (disjoint — safe for parallel agents/worktrees) and its verification gate.

### Phase 0 — Scaffold + contracts (SEQUENTIAL — everything depends on this; keep it small, ~a day)

One effort, done first, merged before anything else starts:

1. Package scaffold: `audio-annotation/` with package.json, vite/vitest/tsconfig/eslint configs, `yarn install`, hello-world `App.tsx`, CI-neutrality check.
2. The two root-repo one-liners (vitest exclude, eslint ignore) — must land before any nested `*.spec.ts` exists.
3. **Contracts**: type-only definitions + fakes that all tracks code against — `fs/FileSystemAdapter.ts` (interface) + `fs/InMemoryAdapter.ts`, `audio/EnvelopeCache.ts` (shape), `audio/PlaybackEngine.ts` (interface + spy impl), `model/TimeRange.ts`/`AnnotationSegment.ts`, `model/eaf/EafDocument.ts` (function signatures, unimplemented), `components/waveform/WaveformSurface.tsx` (wrapper API: secondsToPx, scroll/zoom events, cursor — implementation stubbed), `state/` store skeletons, `l10n.ts`.
4. **Fixtures**: copy into `test-data/` a real SayMore-produced session folder (media + `.annotations.eaf` + `_Annotations/` WAVs), an ELAN-authored EAF with foreign tiers/missing TIME_VALUEs, `annotationTemplate.etf` from `D:\saymore\DistFiles\`, and generate the C#-float parity table (throwaway C# script) — every parallel track needs these.

_Gate:_ `yarn dev` renders shell; `yarn test`/`yarn lint` pass in sub-package AND at root; contracts compile; fixtures committed.

### Phase 1 — Foundation tracks (PARALLEL ×4, all depend only on Phase 0)

- **F1 Model & EAF** — owns `src/model/**`. EafDocument load/save (DOM-preserving, id continuity, interpolation, trimming, template seeding), TierCollection, BoundaryRules (460ms clamps, split/join, permanence, OK-time rules), IgnoreMarkers, Completeness. Pure TS + fixtures; no UI, no FS. _Gate:_ round-trip specs vs real SayMore EAF + foreign-tier preservation; edited fixture opens cleanly in SayMore and ELAN (manual).
- **F2 Audio engine** — owns `src/audio/**` except autosegmenter. envelope.ts (stream-parsed WAV PCM; decodeAudioData fallback), EnvelopeCache impl, PlaybackEngine impl (media element, rAF stop-at-end, rate, loops, playSequence). _Gate:_ envelope specs (bucketing parity math, WAV header cases); manual harness page plays sub-ranges at various rates.
- **F3 FS & filename compat** — owns `src/fs/**`. BrowserDirectoryAdapter (rename=copy+delete), SessionFolder discovery (prefer `_StandardAudio.wav`), csFloat (parity table from Phase 0), OralAnnotationFiles + OralAnnotationIndex (naming, permanence lookup, applyOps, readSegmentWav, `,`-decimal read tolerance). _Gate:_ csFloat parity specs green; InMemoryAdapter op specs; manual smoke vs a real `_Annotations` folder via directory picker.
- **F4 Waveform & shell** — owns `src/components/waveform/**`, `src/components/shell/**`, `src/harness/**`, `App.tsx`. WaveformSurface over wavesurfer v7 (precomputed-peaks + duration, MediaElement backend, minPxPerSec zoom mapping, scroll/cursor events), useViewport, OpenScreen (file drop + directory picker). Uses fake envelope data until F2 merges. _Gate:_ **the 60-min-file perf gate** — hour-long WAV at 1000% zoom scrolls acceptably (this is the go/no-go on wavesurfer; if it fails, swap renderer behind WaveformSurface before Phase 3 builds on it).
- **(F5 Auto-segmenter core — can also start here)** — owns `src/audio/autoSegmenter*.ts`. The pure port + worker + ported C# tests need only the SampleSource seam and envelope shape from Phase 0; only its _dialog and apply-step_ wait for Phase 2. _Gate:_ all ported AutoSegmenterTests pass.

### Phase 2 — Integration spine (SEQUENTIAL, short — merges F1–F4)

One effort: ProjectStore + AnnotationDocumentStore (dirty/version, debounced autosave, external-change poll), UndoStack + deferred FileOp journal with coalescing, wiring OpenScreen → session load → waveform with boundaries rendered from a real `.annotations.eaf`. _Gate:_ open a real SayMore session end-to-end; edit nothing; close; file untouched. This is deliberately one pair of hands — it's where the seams meet and parallel edits would collide.

### Phase 3 — Tool tracks (PARALLEL ×3, all depend on Phase 2)

- **T1 Manual Segmenter** — owns `src/components/segmenter/**` (minus AutoSegmentDialog), `state/SegmenterViewModel.ts`, BoundaryLayer/SegmentShading overlay components. Full interaction set: Enter/Delete/drag/nudge+delayed-replay/zoom keys/hover Play+Ignore/too-short flash/segment count, undo, FileOp journal commit, permanence confirm dialog. _Gate:_ BoundaryRules-driven interaction specs; manual — edit a session with `_Annotations`, reopen in SayMore, every careful segment still plays.
- **T2 Transcription Grid** — owns `src/components/grid/**`, `state/GridViewModel.ts`, `state/PlaybackOptions.ts`. Virtualized 3-column grid, envelope-slice thumbnails, cell editing + autosave, 250ms autoplay/≤5 loops/F2, Tab/arrow nav skipping col 0 and ignored rows, ignored-row rendering, per-column fonts + Options playback menus (incl. careful/translation WAVs via readSegmentWav + playSequence), speed control, external-change reload banner. _Gate:_ component specs (happy-dom, PlaybackEngine spy); manual — Careful/Both options play correct files from a real session.
- **T3 Auto Segmenter UI** — owns `AutoSegmentDialog.tsx` + the apply step. Params dialog (1000/10000/250/4e-6 defaults), worker invocation with progress, post-OK rules via BoundaryRules (5s end handling, trailing `%ignore%`, text backfill), entry from the StartAnnotating flow. Small — can be picked up by whichever track finishes first. _Gate:_ manual run on real audio; boundaries in pauses, all segments within [min,max].

Tool tracks share only Phase-2 store APIs; their component/state files are disjoint. Agree that any needed store change is a PR against the spine, not an in-track edit.

### Phase 4 — Compat hardening + polish (SEQUENTIAL — needs all tools)

Completeness indicators in shell tabs, `%junk%` read-compat, `EXTRACTED_FROM` video-sourced EAFs, non-WAV decode warning, error boundaries, export menu stubs, README manual-test protocol. _Gate:_ full manual protocol on ≥2 real SayMore sessions (one with oral annotations), verified in SayMore **and** ELAN; all specs green.

**Later phases (designed-for, not built now):** Careful Speech + Oral Translation recorders (reuse WaveformSurface/UndoStack/OralAnnotationFiles; add MediaRecorder→wavWriter.ts, peak meter, SpaceBarMode state machine), `.oralAnnotations.wav` multichannel generation, exports (SRT/Audacity/CSV/FLExText/Toolbox), Lingui wiring, plugin integration.

**Plugin integration (context — API now IMPLEMENTED host-side):** lameta's plugin system (`D:/lameta/plugins/docs/plugin-authoring.md`) hosts file-handler plugins as iframes with a versioned postMessage API; `context.file.uri` → media element playback, `getFileBytes()`/`readFileRange()` → envelope, eager-persistence lifecycle → our debounced autosave. Our requested additions (comms thread in `D:/saymore-plugin-agent-comms/`) were implemented on the lameta `plugins` branch: permission-gated `api.companions.*` (list/exists/readText/readBytes/writeText/writeBytes/rename/delete/stat — atomic writes, real rename, scoped to the SayMore companion allowlist incl. the `_StandardAudio.wav` family), documented write-completion-on-teardown guarantee (reconcile by re-reading the EAF on init), mic plumbing for the recorder phase, and `readFileRange` for chunked envelope computation. EAF external change = stat-polling (no host events). One correction requested (2026-07-03 reply2): ELAN pref file allowlist pattern must be extension-REPLACED `F.annotations.pfsx` + `F.annotations.psfx` (SayMore's ChangeExtension + its `.psfx` typo constant), not `F.annotations.eaf.psfx`. Our `FileSystemAdapter` maps 1:1 onto `companions.*` (validate allowlist client-side, throw early); plugin integration is one postMessage-backed adapter + vendored client kit from `D:/lameta/plugins/src/plugins/client/lametaPluginClient.ts` — no other code changes.

## Testing

Vitest, node env by default (`// @vitest-environment happy-dom` per component spec). Fixture corpus in `test-data/`: real SayMore-produced EAF + session folder, ELAN-authored EAF with foreign tiers and missing TIME_VALUEs, synthetic minimal cases. Key suites: EAF round-trip (XPath-level assertions on ts/a numbering, PARENT_REF, lastUsedAnnotationId), autosegmenter (ported C# tests), BoundaryRules matrix, csFloat parity table, FileOp coalescing, grid keyboard nav. Manual protocol in README: copy real session → edit in SPA → reopen in SayMore and ELAN, verify playback + foreign tiers.

## Risks

1. **C# float filename parity (top compat risk).** SayMore uses current-culture `string.Format("{0}_to_{1}…", floatStart, floatEnd)` (`TimeTier.cs:123-134` — verified). Mitigations: `csFloat.ts` = `Math.fround` + shortest `toPrecision(1..9)` string that round-trips to the same float32, validated against a parity table generated once by a throwaway C# script (fixture in test-data); on rename, reuse the unchanged endpoint's literal text from the existing filename; scanner accepts both `.` and `,` decimals (comma-locale sessions), always writes `.`.
2. **EAF round-trip breakers**: never renumber existing annotation ids (continue from lastUsedAnnotationId), DOM-preserving save keeps foreign tiers, golden-file diff vs SayMore output, manual SayMore/ELAN open at each phase gate.
3. **File System Access API is Chromium-only** — accepted for dev harness; plugin phase uses the Electron bridge. Non-Chromium gets single-file in-memory mode.
4. **Envelope decode ≠ NAudio** for compressed formats (browser codec vs NAudio/ffmpeg) → autosegmenter output on real compressed audio is "equivalent", not bit-identical; algorithm parity proven by ported synthetic tests. WAVs avoid the issue entirely (we stream-parse PCM ourselves at native rate). Plugin phase keeps ffmpeg `_StandardAudio.wav` conversion (ffmpeg already bundled in lameta), matching SayMore's PCM-WAV-only annotation rule.
5. **wavesurfer v7 high-zoom performance on long files** (it renders full-width chunked canvases; 1hr at 1000% ≈ 3.5M px). Mitigation: all components program against the `WaveformSurface` wrapper, so the renderer can be swapped for a viewport-windowed custom canvas later without touching interactions. The F4 track's 60-min perf gate validates this before Phase 3 builds on it.
6. **Segment-stop precision with HTMLMediaElement** (~5–20ms rAF slop) affects boundary-nudge replay and grid segment loops. Accepted trade-off (user decision); if a specific interaction feels sloppy, small windows (e.g. the 1000ms nudge replay) can be decoded on demand via Web Audio without changing the architecture.
7. Confirm the 460ms default from `D:\saymore\src\SayMore\Properties\Settings.settings` when writing BoundaryRules; keep all SayMore constants named in one module.
