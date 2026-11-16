# e2e/lameta: the plugin inside a real lameta

The suite in `e2e/*.e2e.ts` runs the plugin in the browser harness (`vp dev`), with a fake
lameta. These specs run the built plugin inside a real, built lameta, so lameta's own plugin
host (its bridge, companion-file rules, `selectFile`, `ffmpeg.run`, the Save dialog) runs too.

## Running

```sh
pnpm run build                              # the plugin's dist/, which the tests install
pnpm -C <lameta checkout> run build         # lameta's dist/
LAMETA_DIR=<lameta checkout> pnpm run e2e:lameta
```

PowerShell: `$env:LAMETA_DIR='D:\lameta'; pnpm run e2e:lameta`.

Without `LAMETA_DIR` (or `LAMETA_EXE`), every spec skips.

| Variable     | Meaning                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `LAMETA_DIR` | A lameta checkout with its dependencies installed and its `dist/` built. Its Electron runs its `dist/`. |
| `LAMETA_EXE` | Instead, an installed lameta executable.                                                                |

## How a test runs

Each test (`lametaFixture.ts`) copies `fixture/SayMoreE2E` to a new folder under the
system temp folder (`saymore-plugin-lameta-e2e/<time>`), copies the plugin's `dist/` into
`<that folder>/userData/plugins/`, and starts lameta on the project's `.sprj` with lameta's
e2e settings: `E2E=true` keeps lameta's window off the primary display, and `E2ERoot` puts
its userData in the test's folder. The folders stay after the run, for inspection.

The plugin's tabs are iframes: `lameta.pluginFrame()` is the one that is showing.
`lameta.expectInPlugin()` waits for something in it, and when that never shows, the failure
includes what the tab shows instead, which is where an error from lameta's bridge appears.

## The fixture project

`fixture/SayMoreE2E` is a minimal lameta project. Its audio was generated with ffmpeg:
3.2 s of a 220 Hz tone in three bursts with pauses between them.

- `Sessions/Start`: `speech.mp3` and `speech.wav`, with no annotation files.
- `Sessions/Annotated`: `story.wav` with `story.wav.annotations.eaf` (two segments, 0 to 1 s
  and 1 to 2.5 s, with transcriptions and free translations) and oral annotation clips in
  `story.wav_Annotations/`.
