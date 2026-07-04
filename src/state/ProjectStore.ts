import { makeAutoObservable, runInAction } from "mobx";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { SessionFolder, annotationsEafName } from "../fs/SessionFolder";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { EnvelopeCache, type Envelope } from "../audio/EnvelopeCache";
import { computeEnvelope } from "../audio/envelope";
import { MediaElementPlaybackEngine } from "../audio/PlaybackEngine";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { SegmenterViewModel } from "./SegmenterViewModel";
import { autoSegmentToEaf, buildAutoSegmentedEafXml } from "../audio/autoSegmentToEaf";

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
  error: string | undefined = undefined;
  /** True in single-file mode: no session folder, save = download. */
  singleFileMode = false;

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

  private async load(adapter: FileSystemAdapter, singleFile: boolean): Promise<void> {
    this.reset();
    runInAction(() => {
      this.loading = true;
      this.singleFileMode = singleFile;
    });
    try {
      const session = await SessionFolder.open(adapter);
      if (!session) throw new Error("No media file found in the selected folder.");

      const mediaBytes = await adapter.readBytes(session.mediaFileName);
      const ext = extOf(session.mediaFileName);
      const envelope = await computeEnvelope(mediaBytes, ext);
      this.envelopeCache.set(session.mediaFileName, envelope);

      const url =
        typeof URL !== "undefined" && URL.createObjectURL
          ? URL.createObjectURL(new Blob([toArrayBuffer(mediaBytes)], { type: mimeForExt(ext) }))
          : undefined;

      const eafText = await session.loadEafText(adapter);

      runInAction(() => {
        this.adapter = adapter;
        this.mediaFileName = session.mediaFileName;
        this.mediaUrl = url;
        this.envelope = envelope;
      });

      if (eafText === undefined) {
        // State A: media with no `.eaf` — offer the Start Annotating methods.
        runInAction(() => {
          this.startAnnotatingMedia = session.mediaFileName;
          this.loading = false;
        });
        return;
      }

      await this.buildSegmenter(eafText);
      runInAction(() => {
        this.loading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.loading = false;
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
      this.startAnnotatingMedia = undefined;
    });
  }

  /**
   * Start Annotating → "Use manual segmentation tool" (standalone). Seed an empty
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
    this.segmenter?.dispose();
    if (this.mediaUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.mediaUrl);
    }
    this.adapter = undefined;
    this.mediaFileName = "";
    this.mediaUrl = undefined;
    this.envelope = undefined;
    this.document = undefined;
    this.segmenter = undefined;
    this.startAnnotatingMedia = undefined;
    this.autoSegmentProgress = 0;
    this.error = undefined;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
