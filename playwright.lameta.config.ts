import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests that run the built plugin inside a real, built lameta (see
 * e2e/lameta/README.md). Separate from playwright.config.ts, whose suite runs the
 * plugin in the browser harness with a fake lameta.
 *
 * LAMETA_DIR must name a lameta checkout whose `dist/` is built (`pnpm run build`
 * there). Without it, every spec skips. Each test starts its own lameta on a fresh
 * copy of the fixture project, so the tests run one at a time.
 *
 * Spec files end in `.lameta.ts` so that neither playwright.config.ts (`*.e2e.ts`)
 * nor Vitest (`*.spec.*`, `*.test.*`) picks them up.
 */
export default defineConfig({
  testDir: "e2e/lameta",
  testMatch: /.*\.lameta\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
