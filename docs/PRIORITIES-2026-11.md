# SayMore plugin: prioritized work, November 2026

Starting point (2026-11-14, `main` at d8c7f48): unit tests 354 passed / 1 skipped; e2e 21 passed /
3 `test.fixme`. lameta's `plugins` branch typechecks and its 109 plugin tests pass. The feature gap
against SayMore was inventoried from both codebases; this list orders what remains.

## Status at the end of the 2026-11-14 session (all uncommitted in this checkout)

Done: all of P0; P1 except per-column fonts and row thumbnails; P2 exports (including the Careful
Speech / Oral Translation audio export, whose mp3 step needs the host's ffmpeg) and all three
missing Start Annotating methods; P3 re-sync of the vendored API. Also fixed: undo after edits made
in another view, F2 pause/resume, the viewer's playing state, the media file chosen when a session
also holds `X_Original.mp3`, and real SayMore eafs that start with a UTF-8 byte order mark. The
e2e suite runs with no `test.fixme` left. lameta's `plugins` branch has uncommitted host fixes
(ffmpeg/ffprobe paths derived from the app path; the client kit resends `ready`).

## P0: bugs in what already exists

1. Oral annotation WAVs recorded in the plugin are named from unrounded boundary times while the
   eaf stores milliseconds, so after a reload the plugin no longer finds them (permanence checks,
   Regenerate and staleness detection skip them). Two e2e tests are `test.fixme`-gated on it.
2. Pressing re-record unmounts the button being held, so its release never arrives and the
   recorder stays in "recording". One e2e test is gated on it.
3. On load a waveform first draws unnormalized and then redraws normalized, because wavesurfer
   decodes the media itself and overwrites the precomputed peaks. That decode also defeats the
   design that keeps memory flat on hour-long files.

## P1: the transcription grid (the tool people spend their time in)

In order: ignored rows (greyed, "Ignored", not editable, toggle); Tab and Up/Down navigation that
skips ignored rows; autoplay 250ms after entering a row, looping up to 5 times, F2 replay/pause;
playback speed 10–100%; per-column Options menus to play Source / Careful Speech / Oral
Translation / Both; virtualized rows for 500+ segments.

Later in P1: reload when the eaf changes on disk (e.g. edited in ELAN); per-column fonts (needs a
decision on where project-wide settings live); waveform thumbnails per row.

## P2: getting data out and in

- Exports SayMore offers: SRT, Audacity labels, plain text, CSV, Toolbox, FLEx interlinear;
  later the Careful Speech / Oral Translation mp3 export.
- Start Annotating methods SayMore has and the plugin lacks: from an existing ELAN file, from an
  Audacity label file, and straight into Careful Speech.

## P3: integration and polish

- Re-sync the vendored `src/plugin/PluginApiTypes.ts` and `lametaPluginClient.ts` with lameta's
  `plugins` branch, then a live run of the built plugin inside lameta.
- Annotation completeness (`src/model/Completeness.ts`) shown somewhere useful, possibly fed to
  lameta's session status. Needs host API.
- Zoom/speed/default-method persistence, Help links.

## Questions for John (not decided)

- Should lameta gain a host API for saving an export to a user-chosen place, instead of a browser
  download?
- Where should project-wide settings such as column fonts live?
