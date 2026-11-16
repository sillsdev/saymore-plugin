import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtureProject = join(here, "fixture", "SayMoreE2E");
const pluginDist = join(repoRoot, "dist");

/** A lameta checkout with a built dist/, or undefined when the suite should skip. */
const lametaDir = process.env.LAMETA_DIR ? resolve(process.env.LAMETA_DIR) : undefined;
/** Optionally, an installed lameta executable to run instead of the checkout's Electron. */
const lametaExe = process.env.LAMETA_EXE ? resolve(process.env.LAMETA_EXE) : undefined;

export const SKIP_REASON =
  "Set LAMETA_DIR to a lameta checkout with a built dist/ (or LAMETA_EXE to an installed lameta) to run the real-lameta e2e suite.";

/** One running lameta, on its own copy of the fixture project, with the plugin installed. */
export class Lameta {
  /** Renderer errors and console errors, from lameta's own window, for failure messages. */
  public readonly errors: string[] = [];

  constructor(
    public readonly app: ElectronApplication,
    public readonly page: Page,
    /** The temporary copy of the fixture project. */
    public readonly projectDir: string,
  ) {
    page.on("pageerror", (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.errors.push(`console: ${m.text()}`);
    });
  }

  sessionDir(session: string): string {
    return join(this.projectDir, "Sessions", session);
  }

  sessionFile(session: string, name: string): string {
    return join(this.sessionDir(session), name);
  }

  async goToSessions(): Promise<void> {
    await this.page.getByTestId("sessions-tab").click();
    await this.page.getByTestId("new-session-button").waitFor({ state: "visible" });
  }

  /** Select a session in the session list, then one of its files in the file list. */
  async selectFile(session: string, fileName: string): Promise<void> {
    await this.goToSessions();
    await this.page.getByRole("gridcell", { name: session, exact: true }).first().click();
    await this.fileRow(fileName).click();
  }

  /** The file list's cell for `fileName`. */
  fileRow(fileName: string): Locator {
    return this.page.getByRole("gridcell", { name: fileNameCell(fileName) }).first();
  }

  /** Wait until lameta's file list has `fileName` selected. */
  async expectSelected(fileName: string): Promise<void> {
    const row = this.page
      .locator(".rt-tr.selected")
      .filter({ has: this.page.getByRole("gridcell", { name: fileNameCell(fileName) }) });
    await expect(row).toHaveCount(1);
  }

  /** A tab in lameta's bottom pane (lameta's own, or one a plugin added). */
  tab(label: string): Locator {
    return this.page.getByRole("tab", { name: label, exact: true });
  }

  /** The content iframe of the plugin tab that is showing. */
  pluginFrame(): FrameLocator {
    return this.page.frameLocator('iframe[data-testid="plugin-frame"]');
  }

  /**
   * Wait for `locator` (inside the plugin frame) to show. When it does not, fail with what
   * the plugin tab shows instead, which is where an error from lameta's bridge appears.
   */
  async expectInPlugin(locator: Locator, timeout = 20_000): Promise<void> {
    try {
      await expect(locator).toBeVisible({ timeout });
    } catch (e) {
      const shown = await this.pluginFrame()
        .locator("body")
        .innerText({ timeout: 2_000 })
        .catch(() => "(the plugin frame could not be read)");
      throw new Error(
        `${(e as Error).message}\n\nThe plugin tab shows:\n${shown.trim()}\n\nlameta errors:\n${
          this.errors.join("\n") || "(none)"
        }`,
      );
    }
  }

  /** Make lameta's Save dialog choose `filePath` without showing a dialog. */
  async stubSaveDialog(filePath: string): Promise<void> {
    await this.app.evaluate(({ dialog }, chosen) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: chosen })) as never;
    }, filePath);
  }
}

/**
 * The accessible name of a file list cell. lameta lists a companion file (such as
 * `<media>.annotations.eaf`) under its media file, with a "└" before its name.
 */
function fileNameCell(fileName: string): RegExp {
  return new RegExp(`^└?${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/** The Electron executable and arguments that run the lameta under test. */
function launchCommand(sprj: string): { executablePath: string; args: string[]; cwd?: string } {
  if (lametaExe) return { executablePath: lametaExe, args: [sprj] };
  const dir = lametaDir!;
  const index = join(dir, "dist", "index.html");
  if (!existsSync(index))
    throw new Error(`${index} does not exist. Build lameta first: pnpm -C "${dir}" run build`);
  const executablePath = createRequire(join(dir, "package.json"))("electron") as string;
  return { executablePath, args: [dir, sprj], cwd: dir };
}

function checkPluginBuilt(): void {
  const manifest = join(pluginDist, "plugin.json5");
  if (!existsSync(manifest))
    throw new Error(`${manifest} does not exist. Build the plugin first: pnpm run build`);
  const builtAt = statSync(join(pluginDist, "index.html")).mtimeMs;
  const sourceAt = statSync(join(repoRoot, "src")).mtimeMs;
  if (sourceAt > builtAt)
    console.warn("The plugin's src/ folder changed after the last build; run `pnpm run build`.");
}

async function launchLameta(): Promise<Lameta> {
  checkPluginBuilt();
  const root = join(
    tmpdir(),
    "saymore-plugin-lameta-e2e",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const projectDir = join(root, "SayMoreE2E");
  cpSync(fixtureProject, projectDir, { recursive: true });
  // lameta reads installed plugins from <userData>/plugins, and E2ERoot puts userData here.
  const installed = join(root, "userData", "plugins", "saymore-audio");
  mkdirSync(installed, { recursive: true });
  cpSync(pluginDist, installed, { recursive: true });

  const sprj = join(projectDir, "SayMoreE2E.sprj");
  const { executablePath, args, cwd } = launchCommand(sprj);
  const app = await electron.launch({
    executablePath,
    args,
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      NODE_ENV: "test",
      VITE_NODE_ENV: "test",
      // E2E keeps lameta's window off the primary display and its settings in memory.
      E2E: "true",
      E2E_USER_SETTINGS_STORE_NAME: "none",
      E2ERoot: root,
    },
  });
  const page = await app.firstWindow();
  const lameta = new Lameta(app, page, projectDir);
  await dismissStartupDialogs(page);
  await page.getByTestId("project-tab").waitFor({ state: "visible", timeout: 30_000 });
  return lameta;
}

/** The registration dialog of a first run, and a packaged prerelease's warning. */
async function dismissStartupDialogs(page: Page): Promise<void> {
  const prerelease = page.getByTestId("prerelease-warning-dialog");
  const cancel = page.getByTestId("cancel");
  const project = page.getByTestId("project-tab");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await prerelease.isVisible()) await prerelease.locator("button").first().click();
    else if (await cancel.isVisible()) {
      await cancel.click();
      return;
    } else if (await project.isVisible()) {
      // The registration dialog can open a moment after the project shows.
      try {
        await cancel.waitFor({ state: "visible", timeout: 3_000 });
        await cancel.click();
      } catch {
        /* no registration dialog */
      }
      return;
    }
    await page.waitForTimeout(200);
  }
}

/** The bytes of a file as text, for asserting on what lameta and the plugin wrote. */
export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export const test = base.extend<{ lameta: Lameta }>({
  // eslint-disable-next-line no-empty-pattern
  lameta: async ({}, use) => {
    test.skip(!lametaDir && !lametaExe, SKIP_REASON);
    const lameta = await launchLameta();
    try {
      await use(lameta);
    } finally {
      await lameta.app.close().catch(() => undefined);
    }
  },
});

export { expect };
