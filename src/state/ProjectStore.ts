import { makeAutoObservable, runInAction } from "mobx";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { SessionFolder, annotationsEafName } from "../fs/SessionFolder";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { EnvelopeCache, type Envelope } from "../audio/EnvelopeCache";
import { computeEnvelope } from "../audio/envelope";
import { MediaElementPlaybackEngine, createAudioElement } from "../audio/PlaybackEngine";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { SegmenterViewModel } from "./SegmenterViewModel";
import { RecorderViewModel } from "./recorder/RecorderViewModel";
import { RecordingFileStore } from "./recorder/RecordingFileStore";
import { combinedOralWavName, regenerateCombinedOralWav } from "./recorder/combinedWav";
import { OralAnnotationsViewerModel } from "./recorder/OralAnnotationsViewerModel";
import type { RecorderKind } from "./recorder/recorderTypes";
import { SpyRecorder, type RecorderService } from "../audio/recording/Recorder";
import { MicRecorder } from "../audio/recording/MicRecorder";
import type { OralAnnotationsSource } from "../audio/oralAnnotationsWav";
import { autoSegmentToEaf, buildAutoSegmentedEafXml } from "../audio/autoSegmentToEaf";

/** Which view the Annotations pane shows (plugin + harness UI; Track C consumes). */
export type AnnotationsView = "grid" | "segmenter" | "recorder-careful" | "recorder-translation";

/**
 * Which step of {@link ProjectStore.load} is in flight. Drives the connecting/loading
 * notice so it names the *actual* wait (reading the whole media file, then decoding it
 * to build the waveform) instead of the misleading blanket "Connecting to lameta…".
 */
export type LoadPhase = "idle" | "reading" | "decoding" | "annotations";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
    case ".oga":
      return "audio/ogg";
    case ".m4a":
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

/**
 * Top-level session store: owns the FileSystemAdapter seam, the media object
 * URL, the EnvelopeCache, the oral-annotation index, the AnnotationDocumentStore
 * and the SegmenterViewModel. `openSession` discovers/loads a real session
 * folder; `openSingleFile` wraps one dropped file in an InMemoryAdapter.
 */
export class ProjectStore {
  readonly envelopeCache = new EnvelopeCache();

  adapter: FileSystemAdapter | undefined = undefined;
  mediaFileName = "";
  mediaUrl: string | undefined = undefined;
  envelope: Envelope | undefined = undefined;
  document: AnnotationDocumentStore | undefined = undefined;
  segmenter: SegmenterViewModel | undefined = undefined;

  /** Shared oral-annotation index (segmenter + recorder use the same instance). */
  oralIndex: OralAnnotationIndex | undefined = undefined;

  /** Which view the Annotations pane currently shows. */
  annotationsView: AnnotationsView = "segmenter";
  /** The active recorder (the Careful Speech / Oral Translation tabs). */
  recorder: RecorderViewModel | undefined = undefined;
  /** Combined-WAV generation progress (0..1) while Setup Oral Annotation runs; else undefined. */
  combinedWavProgress: number | undefined = undefined;
  /**
   * Whether `<media>.oralAnnotations.wav` exists (checked at session load,
   * flipped by {@link setupOralAnnotations}). Drives the grid's "Setup Oral
   * Annotation" button — shown only while this is exactly `false`.
   */
  combinedWavExists: boolean | undefined = undefined;
  /** The Oral Annotations viewer, when the combined `.oralAnnotations.wav` is open. */
  oralViewer: OralAnnotationsViewerModel | undefined = undefined;

  /**
   * State A (standalone): media is loaded (envelope ready) but has no `.eaf` yet
   * — show the Start Annotating screen. Set to the media file name; cleared once
   * a segmentation method builds the segmenter. (The embedded flow reaches State A
   * before load and drives its own reveal, so it doesn't use this.)
   */
  startAnnotatingMedia: string | undefined = undefined;
  /** Auto-segment progress fraction (0→1) while the Start Annotating screen runs it. */
  autoSegmentProgress = 0;

  loading = false;
  /** The in-flight {@link load} step, for an honest loading notice (see {@link LoadPhase}). */
  loadPhase: LoadPhase = "idle";
  error: string | undefined = undefined;
  /** True in single-file mode: no session folder, save = download. */
  singleFileMode = false;

  /**
   * Bumped by every {@link load}/{@link reset} so the background envelope decode (which
   * outlives `load`'s promise) can tell whether it's still the current session before it
   * writes results back — a stale decode from a superseded load must not clobber state.
   */
  private loadSeq = 0;

  /**
   * One shared source-media `<audio>` element for the session, handed to the segmenter's
   * and recorder's playback engines. Created empty at load time so those views build (and
   * their tabs render) immediately; its `src` is attached once the media bytes finish
   * reading in the background. The store owns it (both engines wrap it un-owned), so it's
   * cleaned up in {@link reset}.
   */
  private sourceMediaEl: HTMLMediaElement | undefined = undefined;

  constructor() {
    makeAutoObservable(this, { envelopeCache: false });
  }

  /** Open a real session folder (BrowserDirectoryAdapter or InMemoryAdapter). */
  async openSession(adapter: FileSystemAdapter): Promise<void> {
    await this.load(adapter, false);
  }

  /** Single dropped file: wrap it in an in-memory adapter (save downloads). */
  async openSingleFile(fileName: string, bytes: Uint8Array): Promise<void> {
    const adapter = new InMemoryAdapter();
    adapter.seed(fileName, bytes);
    await this.load(adapter, true);
  }

  /**
   * Open a session progressively so the UI appears before the expensive media decode:
   *
   *  - **A1** — parse the (small) `.eaf` and reveal the transcription grid. Its rows are
   *    editable immediately; the waveform and playback aren't up yet.
   *  - **A2** — read the media bytes → an object URL (playback) + the oral index + the
   *    segmenter. None of this needs the decoded waveform, so play / Edit Segments and the
   *    oral recorder/viewer flows (which only need `document` + `oralIndex`) light up here.
   *    `openSession`'s promise resolves at the end of A2, so callers that then open a
   *    recorder/viewer still find everything they need.
   *  - **B** — the costly `decodeAudioData`/PCM scan, in the background (see
   *    {@link decodeEnvelopeInBackground}); the waveform fills in when it lands.
   *
   * `durationSec` stays 0 until B so {@link WaveformSurface} never spins up a redundant
   * decode of its own from `mediaUrl` (it no-ops while duration ≤ 0), then fills in with the
   * precomputed peaks the moment the envelope arrives.
   */
  private async load(adapter: FileSystemAdapter, singleFile: boolean): Promise<void> {
    this.reset();
    const seq = ++this.loadSeq;
    runInAction(() => {
      this.loading = true;
      this.loadPhase = "annotations";
      this.singleFileMode = singleFile;
    });
    try {
      const session = await SessionFolder.open(adapter);
      if (!session) throw new Error("No media file found in the selected folder.");
      const mediaFileName = session.mediaFileName;
      const ext = extOf(mediaFileName);

      const eafText = await session.loadEafText(adapter);
      if (this.loadSeq !== seq) return;

      if (eafText === undefined) {
        // State A (standalone/harness): media with no `.eaf`. The Start Annotating
        // "Auto-segment" method needs the envelope, so this path still reads + decodes up
        // front before offering the buttons (the embedded flow reaches State A in App.tsx,
        // before load()).
        runInAction(() => {
          this.loadPhase = "reading";
        });
        const mediaBytes = await adapter.readBytes(mediaFileName);
        if (this.loadSeq !== seq) return;
        const url = makeObjectUrl(mediaBytes, ext);
        runInAction(() => {
          this.loadPhase = "decoding";
        });
        const envelope = await computeEnvelope(mediaBytes, ext);
        if (this.loadSeq !== seq) return;
        this.envelopeCache.set(mediaFileName, envelope);
        runInAction(() => {
          this.adapter = adapter;
          this.mediaFileName = mediaFileName;
          this.mediaUrl = url;
          this.envelope = envelope;
          this.startAnnotatingMedia = mediaFileName;
          this.loading = false;
          this.loadPhase = "idle";
        });
        return;
      }

      // A1 — reveal the grid from the `.eaf` alone.
      const document = new AnnotationDocumentStore();
      document.init(mediaFileName, 0, eafText); // durationSec filled in by stage B
      runInAction(() => {
        this.adapter = adapter;
        this.mediaFileName = mediaFileName;
        this.document = document;
        this.startAnnotatingMedia = undefined;
        // Grid-first: opening a session lands on the transcription grid (John's decision).
        this.annotationsView = "grid";
        this.loadPhase = "reading";
      });

      // A2 — oral index + segmenter over a still-empty shared media element. None of this
      // touches the source media bytes, so the segmenter (and, via the caller, the oral
      // recorder/viewer) builds and its tab renders BEFORE the media read — which for a big
      // file is the slow part. `openSession` resolves at the end of A2.
      const oralIndex = await OralAnnotationIndex.build(adapter, mediaFileName);
      if (this.loadSeq !== seq) return;
      const combinedWavExists = await adapter.exists(combinedOralWavName(mediaFileName));
      if (this.loadSeq !== seq) return;
      const sourceMediaEl = createAudioElement("");
      const playback = new MediaElementPlaybackEngine(sourceMediaEl);
      const segmenter = new SegmenterViewModel({
        document,
        playback,
        adapter: singleFile ? undefined : adapter,
        oralIndex,
      });
      runInAction(() => {
        this.sourceMediaEl = sourceMediaEl;
        this.oralIndex = oralIndex;
        this.combinedWavExists = combinedWavExists;
        this.segmenter = segmenter;
        this.loading = false;
        this.loadPhase = "reading";
      });

      // B — read the media bytes (attach the source for playback) then decode the waveform,
      // all in the background; `openSession` has already resolved.
      void this.loadMediaInBackground(seq, adapter, mediaFileName, ext, document, sourceMediaEl);
    } catch (e) {
      if (this.loadSeq !== seq) return;
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.loading = false;
        this.loadPhase = "idle";
      });
    }
  }

  /**
   * Stage B of {@link load}: read the (whole) media file over the host bridge — the real
   * cost of opening a session — then decode its waveform envelope, all after the shell is
   * already on screen. Attaches the source URL to the shared media element (playback becomes
   * live) and publishes the envelope + real `durationSec` (the waveform fills in). Bails if a
   * newer load has superseded this one; a failure leaves the (usable) shell up.
   */
  private async loadMediaInBackground(
    seq: number,
    adapter: FileSystemAdapter,
    mediaFileName: string,
    ext: string,
    document: AnnotationDocumentStore,
    sourceMediaEl: HTMLMediaElement,
  ): Promise<void> {
    try {
      const mediaBytes = await adapter.readBytes(mediaFileName);
      if (this.loadSeq !== seq) return;
      const url = makeObjectUrl(mediaBytes, ext);
      runInAction(() => {
        if (url) sourceMediaEl.src = url;
        this.mediaUrl = url;
        this.loadPhase = "decoding";
      });

      const envelope = await computeEnvelope(mediaBytes, ext);
      if (this.loadSeq !== seq) return;
      this.envelopeCache.set(mediaFileName, envelope);
      runInAction(() => {
        this.envelope = envelope;
        document.durationSec = envelope.durationSec;
        this.loadPhase = "idle";
      });
    } catch {
      if (this.loadSeq !== seq) return;
      // Leave the (usable) shell up; the waveform view simply shows nothing to draw.
      runInAction(() => {
        this.loadPhase = "idle";
      });
    }
  }

  /**
   * Build the segmenter (State B) from an EAF's text over the already-loaded
   * media (adapter/envelope/url set by {@link load}). Shared by the initial load
   * and by the Start Annotating methods once they've written an `.eaf`.
   */
  private async buildSegmenter(eafText: string | undefined): Promise<void> {
    const adapter = this.adapter;
    const envelope = this.envelope;
    if (!adapter || !envelope) throw new Error("ProjectStore: media not loaded.");

    const oralIndex = await OralAnnotationIndex.build(adapter, this.mediaFileName);
    const combinedWavExists = await adapter.exists(combinedOralWavName(this.mediaFileName));

    const document = new AnnotationDocumentStore();
    document.init(this.mediaFileName, envelope.durationSec, eafText);

    const playback = new MediaElementPlaybackEngine(this.mediaUrl ?? "");
    const segmenter = new SegmenterViewModel({
      document,
      playback,
      adapter: this.singleFileMode ? undefined : adapter,
      oralIndex,
    });

    runInAction(() => {
      this.document = document;
      this.segmenter = segmenter;
      this.oralIndex = oralIndex;
      this.combinedWavExists = combinedWavExists;
      this.startAnnotatingMedia = undefined;
      // Grid-first: opening a session lands on the transcription grid (John's
      // decision). The segmenter/recorders are reached from the grid's toolbar.
      this.annotationsView = "grid";
    });
  }

  // ── Annotations-pane view (grid / segmenter / recorder) ─────────────────────
  /** Show the transcription grid. Disposes any active recorder. */
  showGrid(): void {
    this.disposeRecorder();
    this.annotationsView = "grid";
  }

  /** Show the manual segmenter. Disposes any active recorder. */
  showSegmenter(): void {
    this.disposeRecorder();
    this.annotationsView = "segmenter";
  }

  /**
   * Open the Careful Speech / Oral Translation recorder over the current
   * session. Builds the RecordingFileStore (overlay pre-warmed from disk) and a
   * {@link RecorderViewModel} with its own MediaElementPlaybackEngine and the
   * shared oralIndex/document. The real MicRecorder is wired in at the merge
   * step; until then a {@link SpyRecorder} placeholder keeps the surface
   * functional (and specs/CI running). The view flips once the store is ready.
   */
  openRecorder(kind: RecorderKind): void {
    if (!this.document || !this.oralIndex) return;
    // Recorder and Oral Annotations viewer are mutually exclusive panes over the
    // same combined-file state; the viewer regenerates a stale combined file on
    // its next open, so no regen is owed here.
    this.disposeOralViewer();
    this.disposeRecorder();
    void this.buildRecorder(kind);
  }

  private async buildRecorder(kind: RecorderKind): Promise<void> {
    const document = this.document;
    const oralIndex = this.oralIndex;
    if (!document || !oralIndex) return;
    const store = await RecordingFileStore.build(this.adapter, oralIndex, this.mediaFileName);
    // Share the session's source-media element (its `src` attaches when the background read
    // finishes) so the recorder tab renders now instead of waiting on the media read.
    const playback = new MediaElementPlaybackEngine(
      this.sourceMediaEl ?? this.mediaUrl ?? "",
    );
    const vm = new RecorderViewModel({
      kind,
      document,
      playback,
      recorder: makeRecorderService(),
      store,
      adapter: this.singleFileMode ? undefined : this.adapter,
    });
    runInAction(() => {
      this.recorder = vm;
      this.annotationsView = kind === "Careful" ? "recorder-careful" : "recorder-translation";
    });
    // Acquire the hot mic; failure surfaces as the VM's Error mode (never a crash).
    void vm.openDevice();
  }

  /**
   * "Setup Oral Annotation": create the combined `<media>.oralAnnotations.wav`
   * so its Careful Speech / Oral Translation / Combined Audio tabs exist. With
   * no recordings yet this writes a source-only file (silent annotation
   * channels); any recordings already on disk are included. Later freshness is
   * owned by the viewer's staleness check (there is no regenerate-on-recorder-
   * exit — recorder tabs have no exit). Returns the file's relative name so the
   * caller can select it (host `selectFile` / harness tree selection).
   */
  async setupOralAnnotations(): Promise<string> {
    const adapter = this.adapter;
    const document = this.document;
    const oralIndex = this.oralIndex;
    if (!adapter || !document || !oralIndex || this.singleFileMode) {
      throw new Error("ProjectStore: no session loaded.");
    }
    runInAction(() => {
      this.combinedWavProgress = 0;
    });
    try {
      const tiers = document.tiers;
      const segments = await Promise.all(
        tiers.segments.map(async (s, i) => ({
          range: s.range,
          ignored: tiers.isSegmentIgnored(i),
          careful: await oralIndex.readSegmentWav(s.range, "Careful"),
          translation: await oralIndex.readSegmentWav(s.range, "Translation"),
        })),
      );
      await regenerateCombinedOralWav({
        adapter,
        mediaFileName: this.mediaFileName,
        totalDurationSec: document.durationSec,
        segments,
        allowEmpty: true,
        decodeMedia: (bytes) => this.decodeMediaToSource(bytes),
        onProgress: (fraction) => {
          runInAction(() => {
            this.combinedWavProgress = fraction;
          });
        },
      });
      runInAction(() => {
        this.combinedWavExists = true;
      });
      return combinedOralWavName(this.mediaFileName);
    } finally {
      runInAction(() => {
        this.combinedWavProgress = undefined;
      });
    }
  }

  /** Full-PCM decode of the source media via WebAudio (undefined in non-DOM envs). */
  private async decodeMediaToSource(bytes: Uint8Array): Promise<OralAnnotationsSource | undefined> {
    const Ctx =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctx) return undefined;
    const ctx = new Ctx();
    try {
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await ctx.decodeAudioData(ab as ArrayBuffer);
      const channels: Float32Array[] = [];
      for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
      return { channels, sampleRate: decoded.sampleRate };
    } catch {
      return undefined;
    } finally {
      void ctx.close().catch(() => {});
    }
  }

  private disposeRecorder(): void {
    this.recorder?.dispose();
    this.recorder = undefined;
  }

  /**
   * Open the Oral Annotations viewer for the combined `<media>.oralAnnotations.wav`
   * (plugin: the file's tab; harness: the OralAnnotations tree node). Builds the
   * viewer model and kicks off its staleness-aware load (auto-regenerates when the
   * combined file is missing or older than the eaf / per-segment WAVs).
   */
  openOralAnnotationsViewer(): void {
    const document = this.document;
    const oralIndex = this.oralIndex;
    const adapter = this.adapter;
    if (!document || !oralIndex || !adapter) return;
    this.disposeRecorder();
    this.oralViewer?.dispose();
    const viewer = new OralAnnotationsViewerModel({
      adapter,
      mediaFileName: this.mediaFileName,
      document,
      oralIndex,
      decodeMedia: (bytes) => this.decodeMediaToSource(bytes),
    });
    this.oralViewer = viewer;
    void viewer.load();
  }

  private disposeOralViewer(): void {
    this.oralViewer?.dispose();
    this.oralViewer = undefined;
  }

  /**
   * SayMore tab → "Manually segment" (standalone). Seed an empty
   * SayMore-compatible `.eaf` beside the media (unless one exists), then open the
   * segmenter on it.
   */
  async startAnnotatingManual(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) throw new Error("ProjectStore: no media loaded.");
    const eafRel = annotationsEafName(this.mediaFileName);
    if (!(await adapter.exists(eafRel))) {
      await adapter.writeText(eafRel, buildAutoSegmentedEafXml(this.mediaFileName, []));
    }
    await this.buildSegmenter(await adapter.readText(eafRel));
  }

  /**
   * Start Annotating → "Auto-segment" (standalone). Run the auto-segmenter over
   * the loaded audio, write the resulting SayMore-parity `.eaf`, then open the
   * segmenter showing the segments. `onProgress` also mirrors into
   * {@link autoSegmentProgress} for observers that prefer the store.
   */
  async autoSegment(onProgress?: (fraction: number) => void): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) throw new Error("ProjectStore: no media loaded.");
    runInAction(() => {
      this.autoSegmentProgress = 0;
    });
    const { eafRel } = await autoSegmentToEaf({
      adapter,
      mediaFileName: this.mediaFileName,
      envelope: this.envelope,
      onProgress: (fraction) => {
        runInAction(() => {
          this.autoSegmentProgress = fraction;
        });
        onProgress?.(fraction);
      },
    });
    await this.buildSegmenter(await adapter.readText(eafRel));
  }

  private reset(): void {
    // Abandon any background envelope decode still running for the previous session.
    this.loadSeq++;
    this.disposeRecorder();
    this.disposeOralViewer();
    this.segmenter?.dispose();
    // The shared source element is owned here (the playback engines wrap it un-owned), so
    // release it ourselves before revoking its object URL.
    if (this.sourceMediaEl) {
      try {
        this.sourceMediaEl.pause();
        this.sourceMediaEl.removeAttribute("src");
      } catch {
        /* element may be detached */
      }
      this.sourceMediaEl = undefined;
    }
    if (this.mediaUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.mediaUrl);
    }
    this.adapter = undefined;
    this.mediaFileName = "";
    this.mediaUrl = undefined;
    this.envelope = undefined;
    this.document = undefined;
    this.segmenter = undefined;
    this.oralIndex = undefined;
    this.combinedWavExists = undefined;
    this.annotationsView = "segmenter";
    this.startAnnotatingMedia = undefined;
    this.autoSegmentProgress = 0;
    this.loadPhase = "idle";
    this.error = undefined;
  }
}

/**
 * The real {@link MicRecorder} when the environment can capture audio, else the
 * scriptable {@link SpyRecorder} so node specs, CI, and non-mic hosts keep the
 * recorder functional (the merge-step fallback).
 */
function makeRecorderService(): RecorderService {
  const hasMic = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  return hasMic ? new MicRecorder() : new SpyRecorder();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** A playback object URL for the media bytes (undefined in non-DOM envs, e.g. node specs). */
function makeObjectUrl(bytes: Uint8Array, ext: string): string | undefined {
  return typeof URL !== "undefined" && URL.createObjectURL
    ? URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: mimeForExt(ext) }))
    : undefined;
}
