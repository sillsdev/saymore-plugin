import { makeAutoObservable, runInAction } from "mobx";
import type { FileSystemAdapter } from "../../fs/FileSystemAdapter";
import { oralAnnotationsFolderName, type OralAnnotationIndex } from "../../fs/OralAnnotationFiles";
import { annotationsEafName } from "../../fs/SessionFolder";
import type { AnnotationDocumentStore } from "../AnnotationDocumentStore";
import { combinedOralWavName, regenerateCombinedOralWav, type MediaDecoder } from "./combinedWav";

const ANNOTATION_WAV_RE = /_(?:Careful|Translation)\.wav$/i;

export interface OralAnnotationsViewerDeps {
  adapter: FileSystemAdapter;
  mediaFileName: string;
  document: AnnotationDocumentStore;
  oralIndex: OralAnnotationIndex;
  /** Full-PCM decode of the source media (ProjectStore supplies the WebAudio impl). */
  decodeMedia: MediaDecoder;
}

/** ASCII of `bytes[off..off+len)`. */
function readAscii(bytes: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && off + i < bytes.length; i++) s += String.fromCharCode(bytes[off + i]);
  return s;
}

/** Duration of a PCM WAV from its header (cheap — no full decode). 0 if unparseable. */
export function parseWavDurationSec(bytes: Uint8Array): number {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return 0;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataSize = 0;
  while (off + 8 <= bytes.length) {
    const id = readAscii(bytes, off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bits = view.getUint16(off + 22, true);
    } else if (id === "data") {
      dataSize = size;
    }
    off += 8 + size + (size & 1); // chunks are word-aligned
  }
  const bytesPerFrame = channels * (bits / 8);
  if (!sampleRate || !bytesPerFrame) return 0;
  return dataSize / bytesPerFrame / sampleRate;
}

/**
 * Drives the Oral Annotations viewer: the read-side of the combined
 * `<media>.oralAnnotations.wav`. On {@link load} it is staleness-aware
 * (improvement over SayMore, approved): if the combined file is missing or older
 * than the `.eaf` or any `_Annotations/*.wav`, it auto-regenerates (reusing the
 * merge-step {@link regenerateCombinedOralWav}) before loading; an explicit
 * {@link regenerate} backs the toolbar button. Exposes the bytes + duration for
 * the UI to decode into the three (Source/Careful/Translation) waveform rows.
 */
export class OralAnnotationsViewerModel {
  /** The combined-file bytes (undefined until loaded, or if nothing to generate). */
  bytes: Uint8Array | undefined = undefined;
  durationSec = 0;
  loading = false;
  isRegenerating = false;
  /** 0..1 while regenerating; undefined otherwise. */
  regenerateProgress: number | undefined = undefined;
  error: string | undefined = undefined;

  private readonly adapter: FileSystemAdapter;
  private readonly mediaFileName: string;
  private readonly document: AnnotationDocumentStore;
  private readonly oralIndex: OralAnnotationIndex;
  private readonly decodeMedia: MediaDecoder;

  constructor(deps: OralAnnotationsViewerDeps) {
    this.adapter = deps.adapter;
    this.mediaFileName = deps.mediaFileName;
    this.document = deps.document;
    this.oralIndex = deps.oralIndex;
    this.decodeMedia = deps.decodeMedia;
    makeAutoObservable<
      OralAnnotationsViewerModel,
      "adapter" | "mediaFileName" | "document" | "oralIndex" | "decodeMedia"
    >(this, {
      adapter: false,
      mediaFileName: false,
      document: false,
      oralIndex: false,
      decodeMedia: false,
    });
  }

  get combinedName(): string {
    return combinedOralWavName(this.mediaFileName);
  }

  /** Open the viewer: regenerate if stale/missing, then load the bytes. */
  async load(): Promise<void> {
    runInAction(() => {
      this.loading = true;
      this.error = undefined;
    });
    try {
      if (await this.isStale()) await this.runRegenerate();
      await this.readBytes();
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  /** Manual toolbar Regenerate: rebuild and reload. */
  async regenerate(): Promise<void> {
    try {
      await this.runRegenerate();
      await this.readBytes();
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
      });
    }
  }

  private async readBytes(): Promise<void> {
    const exists = await this.adapter.exists(this.combinedName);
    const bytes = exists ? await this.adapter.readBytes(this.combinedName) : undefined;
    runInAction(() => {
      this.bytes = bytes;
      this.durationSec = bytes ? parseWavDurationSec(bytes) : 0;
    });
  }

  private async runRegenerate(): Promise<void> {
    runInAction(() => {
      this.isRegenerating = true;
      this.regenerateProgress = 0;
    });
    try {
      const tiers = this.document.tiers;
      const segments = await Promise.all(
        tiers.segments.map(async (s, i) => ({
          range: s.range,
          ignored: tiers.isSegmentIgnored(i),
          careful: await this.oralIndex.readSegmentWav(s.range, "Careful"),
          translation: await this.oralIndex.readSegmentWav(s.range, "Translation"),
        })),
      );
      await regenerateCombinedOralWav({
        adapter: this.adapter,
        mediaFileName: this.mediaFileName,
        totalDurationSec: this.document.durationSec,
        segments,
        decodeMedia: this.decodeMedia,
        onProgress: (fraction) => {
          runInAction(() => {
            this.regenerateProgress = fraction;
          });
        },
      });
    } finally {
      runInAction(() => {
        this.isRegenerating = false;
        this.regenerateProgress = undefined;
      });
    }
  }

  /** Missing, or older than the eaf or any per-segment WAV → needs regeneration. */
  private async isStale(): Promise<boolean> {
    const combinedMs = await this.adapter.getModifiedMs(this.combinedName);
    if (combinedMs === undefined) return true;
    const eafMs = await this.adapter.getModifiedMs(annotationsEafName(this.mediaFileName));
    if (eafMs !== undefined && eafMs > combinedMs) return true;
    const prefix = `${oralAnnotationsFolderName(this.mediaFileName)}/`;
    for (const name of await this.adapter.list()) {
      if (name.startsWith(prefix) && ANNOTATION_WAV_RE.test(name)) {
        const ms = await this.adapter.getModifiedMs(name);
        if (ms !== undefined && ms > combinedMs) return true;
      }
    }
    return false;
  }

  dispose(): void {
    /* No timers or URLs owned here; UI owns the audio element + blob URL. */
  }
}
