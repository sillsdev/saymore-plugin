import { defineConfig, devices } from "@playwright/test";

/**
 * Real-Chromium e2e suite for the harness (`vp dev`). Runs against the bundled
 * IndexedDB sample session (see `e2e/helpers.ts`) — no session-folder / File
 * System Access picker involved, so it's fully headless-drivable.
 *
 * The fake-mic launch flags make `getUserMedia` yield a synthetic tone: the
 * real MicRecorder + AudioWorklet run for real against it, so the recorder
 * suite (`e2e/recorder.e2e.ts`) needs no mocking once it's un-gated.
 *
 * Spec files use the `*.e2e.ts` suffix (not `*.spec.ts`) so vitest's default
 * include glob (`**\/*.{test,spec}.*`) does not sweep them into `vp test` —
 * verified empirically; see e2e/README.md.
 */
const PORT = 5183;

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `vp dev --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
