import { makeAutoObservable, runInAction } from "mobx";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { SessionFolder } from "../fs/SessionFolder";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { EnvelopeCache, type Envelope } from "../audio/EnvelopeCache";
import { computeEnvelope } from "../audio/envelope";
import { MediaElementPlaybackEngine } from "../audio/PlaybackEngine";
import { AnnotationDocumentStore } from "./AnnotationDocumentStore";
import { SegmenterViewModel } from "./SegmenterViewModel";

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
      const oralIndex = await OralAnnotationIndex.build(adapter, session.mediaFileName);

      const document = new AnnotationDocumentStore();
      document.init(session.mediaFileName, envelope.durationSec, eafText);

      const playback = new MediaElementPlaybackEngine(url ?? "");
      const segmenter = new SegmenterViewModel({
        document,
        playback,
        adapter: singleFile ? undefined : adapter,
        oralIndex
      });

      runInAction(() => {
        this.adapter = adapter;
        this.mediaFileName = session.mediaFileName;
        this.mediaUrl = url;
        this.envelope = envelope;
        this.document = document;
        this.segmenter = segmenter;
        this.loading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.loading = false;
      });
    }
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
    this.error = undefined;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
