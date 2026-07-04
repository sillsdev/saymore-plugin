# e2e — Playwright suite

Real-Chromium end-to-end tests against the dev harness (`vp dev`). Complements
`vp test` (Vitest, unit/component level) — this suite drives the actual app in
a browser: real waveform rendering, real `<audio>` playback, real IndexedDB
persistence, and real `getUserMedia` mic capture (via the fake-device flags
below).

## Running

```sh
pnpm run e2e          # headless, all specs
pnpm run e2e:ui       # Playwright's UI mode (watch/debug)
pnpm exec playwright test e2e/segmenter.e2e.ts   # one file
```

`playwright.config.ts` starts `vp dev --port 5183 --strictPort` for you
(`reuseExistingServer: true`, so a `vp dev` you already have running on that
port is reused rather than restarted) and points Chromium at it.

## Fixture / reset strategy

Every test gets a fresh, isolated Playwright browser context (the default
`page` fixture), which means a brand-new IndexedDB — the app re-seeds the
bundled sample (`test-data/media/ETR009_Tiny.mp3`) from scratch on first load.
**Tests never need to reset state between each other.** Use the `resetSample`
helper only when a single test needs to get back to a pristine session
mid-test (e.g. after creating an eaf, to exercise the "no eaf yet" screen
again without a second browser context).

`e2e/helpers.ts` has the shared bits:

- `openSample(page, { sel, view })` — navigate to the harness on the sample
  session, optionally deep-linking a selection/view.
- `fileTreeRow(page, name)` — the file-tree row locator (Audio/Annotations).
- `resetSample(page)` — click "Reset sample".
- `readIdbFileBytes` / `readIdbFileText` / `listIdbFileNames` — read the app's
  real persisted state straight out of IndexedDB (the same store
  `IndexedDbAdapter` uses), so assertions check what actually got written
  (the `.eaf` XML, a recorded WAV) rather than pixel-hunting the rendered UI.
- `holdKey(page, key, ms)` — press-and-hold a key (SPACE for listen/record).

## Fake microphone

`playwright.config.ts` launches Chromium with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and grants
the `microphone` permission by default. `getUserMedia` then yields a synthetic
tone instead of prompting for/reading a real mic — the real `MicRecorder` +
AudioWorklet capture path runs for real against it, so `recorder.e2e.ts` is
fully automatable (no mocking needed).

## Why `.e2e.ts`, not `.spec.ts`

Spec files use the `*.e2e.ts` suffix rather than `*.spec.ts`. Verified
empirically: Vitest's default `include` glob (`**/*.{test,spec}.*`) has no
carve-out for an `e2e/` directory, so naming these `*.spec.ts` makes `vp test`
sweep them up too and fail immediately (`Playwright Test did not expect
test() to be called here` — two different `test()` globals colliding). The
`.e2e.ts` suffix sidesteps this without touching `vite.config.ts`;
`playwright.config.ts` sets `testMatch: /.*\.e2e\.ts/` to match.

## Suite layout

- `harness.e2e.ts` — smoke: sample loads, file-tree selection navigates,
  deep-link URL restore.
- `startAnnotating.e2e.ts` — the "no eaf yet" screen: manual vs. auto-segment,
  reset.
- `segmenter.e2e.ts` — Enter-at-cursor, Tab-select, arrow-nudge, undo, Back,
  and a real mouse-drag on a boundary — all asserted against the persisted
  `.eaf`, not pixel positions.
- `grid.e2e.ts` — editing Transcription/Free Translation cells persists
  through a reload; per-row play doesn't throw.
- `recorder.e2e.ts` — the oral-annotation recorder (Careful Speech / Oral
  Translation): armed listen → push-to-talk record → annotated cell, a
  too-short press, re-record/erase/undo, Oral Translation, and combined-WAV
  regen on exit — driven with real push-to-talk (`holdKey`) against the real
  `MicRecorder` + fake mic tone, asserted via the persisted `_Annotations/`
  WAVs, not pixels.
- `oralAnnotationPermanence.e2e.ts` — dragging a boundary whose segment
  already has an oral-annotation WAV: the SayMore "permanence" confirm
  (`window.confirm`, auto-accepted) and the csFloat WAV rename that follows.
