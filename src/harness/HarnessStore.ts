import { makeAutoObservable, reaction, runInAction } from "mobx";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { BrowserDirectoryAdapter } from "../fs/BrowserDirectoryAdapter";
import type { ProjectStore } from "../state/ProjectStore";
import { annotationsEafName } from "../fs/SessionFolder";
import { IndexedDbAdapter } from "./IndexedDbAdapter";
import { ensureSampleSeeded, resetSampleSession } from "./sampleSession";
import { deriveSessionTree, type SessionTree } from "./sessionTree";
import { idbAvailable, idbGet, idbPut, META_STORE } from "./idb";
import {
  readHarnessUrlState,
  writeHarnessUrlState,
  type EafView,
  type Selection,
  type SessionSource,
} from "./harnessRouter";

const FOLDER_HANDLE_KEY = "folderHandle";

type Phase = "init" | "ready" | "needs-folder-reconnect" | "error";

/** Which of the OralAnnotations selection's tabs is showing (see OralAnnotationsTabView). */
export type OralTab = "careful" | "translation" | "combined";

/**
 * Drives the host simulator: owns the session source (bundled IndexedDB sample
 * or a connected disk folder), the derived file tree, the current selection and
 * view, and reuses the app's real {@link ProjectStore} to load the session
 * exactly as the embedded plugin would. All mutations mirror into the URL so a
 * refresh restores the same context.
 */
export class HarnessStore {
  readonly projectStore: ProjectStore;

  source: SessionSource = "sample";
  phase: Phase = "init";
  error: string | undefined;
  busy = false;

  adapter: FileSystemAdapter | undefined;

  files: string[] = [];
  selection: Selection | undefined;
  /** Active tab chip while `selection === "oral"` (the plugin defaults to Careful Speech). */
  oralTab: OralTab = "careful";

  /** Guards against React StrictMode's double-mount running init() twice. */
  private started = false;

  constructor(projectStore: ProjectStore) {
    this.projectStore = projectStore;
    makeAutoObservable(this, {
      projectStore: false,
      adapter: false,
    });
    // AnnotationsPaneView drives `annotationsView` straight on the ProjectStore
    // (grid/segmenter/recorder — see components/annotations), not through this
    // class, so mirror it into the URL here instead of via per-action
    // delegates (those went dead the moment the pane stopped calling back
    // through the harness).
    reaction(
      () => this.projectStore.annotationsView,
      () => this.syncUrl(),
    );
  }

  get tree(): SessionTree {
    return deriveSessionTree(this.files);
  }

  get mediaFileName(): string | undefined {
    return this.tree.mediaFileName;
  }

  get hasEaf(): boolean {
    return this.tree.eafName !== undefined;
  }

  get hasOral(): boolean {
    return this.tree.nodes.some((n) => n.kind === "oral");
  }

  /** Which view the Annotations pane shows — proxies the real ProjectStore field. */
  get eafView(): EafView {
    return this.projectStore.annotationsView;
  }

  // ── bootstrap ──────────────────────────────────────────────────────────────
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const url = readHarnessUrlState();
    runInAction(() => {
      this.source = url.src;
    });
    try {
      if (url.src === "folder") {
        // A connected folder needs a fresh permission grant after reload; defer
        // to a user gesture (the Reconnect button) rather than failing here.
        const ok = await this.tryReconnectFolder();
        if (!ok) {
          runInAction(() => {
            this.phase = "needs-folder-reconnect";
          });
          return;
        }
      } else {
        await this.startSample(false);
      }
      await this.restoreSelection(url.sel, url.view);
      runInAction(() => {
        this.phase = "ready";
      });
    } catch (e) {
      runInAction(() => {
        this.phase = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
    }
  }

  private async restoreSelection(sel: Selection | undefined, view: EafView): Promise<void> {
    if (sel === "eaf" && this.hasEaf) {
      await this.selectEaf();
      this.applyView(view);
    } else if (sel === "audio" || (sel === "eaf" && !this.hasEaf)) {
      await this.selectAudio();
    }
    this.syncUrl();
  }

  /** Drive `ProjectStore.annotationsView` to a URL-restored value. */
  private applyView(view: EafView): void {
    if (view === "segmenter") this.projectStore.showSegmenter();
    else this.projectStore.showGrid();
  }

  // ── session sources ──────────────────────────────────────────────────────
  private async startSample(reset: boolean): Promise<void> {
    if (!idbAvailable()) throw new Error("This browser has no IndexedDB; sample session needs it.");
    const adapter = new IndexedDbAdapter();
    if (reset) await resetSampleSession(adapter);
    else await ensureSampleSeeded(adapter);
    runInAction(() => {
      this.adapter = adapter;
      this.source = "sample";
    });
    await this.refreshTree();
  }

  async connectFolder(): Promise<void> {
    const picked = await window.showDirectoryPicker({ mode: "readwrite" });
    if (idbAvailable()) await idbPut(META_STORE, FOLDER_HANDLE_KEY, picked);
    runInAction(() => {
      this.adapter = new BrowserDirectoryAdapter(picked);
      this.source = "folder";
      this.phase = "ready";
      this.selection = undefined;
    });
    await this.refreshTree();
    await this.selectAudio();
  }

  /** Reload path: re-open the saved handle and re-request permission (one click). */
  async reconnectFolder(): Promise<void> {
    const ok = await this.tryReconnectFolder(/*request*/ true);
    if (!ok) throw new Error("Folder permission was not granted.");
    runInAction(() => {
      this.phase = "ready";
    });
    const url = readHarnessUrlState();
    await this.restoreSelection(url.sel, url.view);
  }

  private async tryReconnectFolder(request = false): Promise<boolean> {
    if (!idbAvailable()) return false;
    const handle = await idbGet<FileSystemDirectoryHandle>(META_STORE, FOLDER_HANDLE_KEY);
    if (!handle) return false;
    const query = (await (
      handle as unknown as {
        queryPermission(d: { mode: string }): Promise<PermissionState>;
      }
    ).queryPermission({ mode: "readwrite" })) as PermissionState;
    let state = query;
    if (state !== "granted" && request) {
      state = (await (
        handle as unknown as {
          requestPermission(d: { mode: string }): Promise<PermissionState>;
        }
      ).requestPermission({ mode: "readwrite" })) as PermissionState;
    }
    if (state !== "granted") return false;
    runInAction(() => {
      this.adapter = new BrowserDirectoryAdapter(handle);
      this.source = "folder";
    });
    await this.refreshTree();
    return true;
  }

  /** Reset returns to a pristine bundled sample (drops any created eaf / edits). */
  async reset(): Promise<void> {
    await this.startSample(true);
    runInAction(() => {
      this.selection = undefined;
    });
    await this.selectAudio();
  }

  private async refreshTree(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const files = await adapter.list();
    runInAction(() => {
      this.files = files;
    });
  }

  // ── selection ──────────────────────────────────────────────────────────────
  async selectAudio(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    runInAction(() => {
      this.selection = "audio";
      this.busy = true;
    });
    // No eaf yet → drive the ProjectStore to State A (Start Annotating). If an eaf
    // already exists we show an informational note instead (see HostSimulator).
    if (!this.hasEaf) {
      await this.projectStore.openSession(adapter);
    }
    runInAction(() => {
      this.busy = false;
    });
    this.syncUrl();
  }

  async selectEaf(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter || !this.hasEaf) return;
    runInAction(() => {
      this.selection = "eaf";
      this.busy = true;
    });
    await this.projectStore.openSession(adapter);
    runInAction(() => {
      // Mirror the plugin's default tab for an eaf (see tabProvider.ts): the
      // grid once segments exist, the segmenter while the eaf is still empty.
      this.applyDefaultEafView();
      this.busy = false;
    });
    this.syncUrl();
  }

  /** The provider's live default for an eaf: Segments while empty, else the grid. */
  private applyDefaultEafView(): void {
    if ((this.projectStore.document?.segments.length ?? 0) === 0) {
      this.projectStore.showSegmenter();
    } else {
      this.projectStore.showGrid();
    }
  }

  /**
   * Select the OralAnnotations tree node: load the session (if not already),
   * then open the selection's default tab — Careful Speech, the tab the
   * plugin's provider marks `claimDefault` (see tabProvider.ts).
   */
  async selectOral(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter || !this.hasOral) return;
    runInAction(() => {
      this.selection = "oral";
      this.busy = true;
    });
    if (!this.projectStore.document) {
      await this.projectStore.openSession(adapter);
    }
    runInAction(() => {
      this.setOralTab("careful");
      this.busy = false;
    });
    this.syncUrl();
  }

  /** Switch the OralAnnotations selection's tab chip: a recorder (hot mic) or the viewer. */
  setOralTab(tab: OralTab): void {
    this.oralTab = tab;
    if (tab === "combined") this.projectStore.openOralAnnotationsViewer();
    else this.projectStore.openRecorder(tab === "careful" ? "Careful" : "Translation");
  }

  /** After the SayMore-tab buttons create the eaf: mirror lameta's rescan +
   * selectFile — the tree gains the Annotations row, selection jumps to it, and
   * the provider's live default tab opens (Segments for a fresh manual eaf,
   * the grid for an auto-segmented one). */
  async onEafCreated(): Promise<void> {
    await this.refreshTree();
    runInAction(() => {
      this.selection = "eaf";
      this.applyDefaultEafView();
    });
    this.syncUrl();
  }

  /** Grid toolbar "Setup Oral Annotation": create the combined WAV, then mirror
   * lameta's rescan + selectFile — the OralAnnotations row appears and its
   * default (Careful Speech) tab opens. */
  async setupOralAnnotations(): Promise<void> {
    await this.projectStore.setupOralAnnotations();
    await this.refreshTree();
    await this.selectOral();
  }

  // ── Start Annotating actions (wrap ProjectStore + jump to the new eaf) ──────
  async runManual(): Promise<void> {
    await this.projectStore.startAnnotatingManual();
    await this.onEafCreated();
  }

  async runAuto(onProgress: (fraction: number) => void): Promise<void> {
    await this.projectStore.autoSegment(onProgress);
    await this.onEafCreated();
  }

  get eafName(): string | undefined {
    return this.mediaFileName ? annotationsEafName(this.mediaFileName) : undefined;
  }

  private syncUrl(): void {
    writeHarnessUrlState({ src: this.source, sel: this.selection, view: this.eafView });
  }
}
