import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import type { OralAnnotationIndex, OralAnnotationKind } from "../fs/OralAnnotationFiles";
import { oralAnnotationsFolderName } from "../fs/OralAnnotationFiles";
import { concatenateWavs, sortSegmentWavNames } from "./combineSegmentAudio";

/** ffmpeg output options of SayMore's "Extract audio to mono mp3 audio file (low quality)". */
export const MONO_MP3_FFMPEG_ARGS = ["-vn", "-codec:a", "libmp3lame", "-ac", "1"];

/** Runs the host's ffmpeg over companion `inputRelPath`, writing companion `outputRelPath`. */
export type RunFfmpeg = (spec: {
  inputRelPath: string;
  outputRelPath: string;
  args: string[];
}) => Promise<void>;

export interface AudioExportResult {
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
  /** True when no mp3 encoder was available and the bytes are the combined WAV. */
  fellBackToWav: boolean;
}

/** SayMore's default file name suffixes. */
export const AUDIO_EXPORT_SUFFIX: Record<OralAnnotationKind, string> = {
  Careful: "CarefulSpeech",
  Translation: "OralTranslation",
};

/** The clips of one kind combined into a single WAV. */
export async function combineSegmentAudio(
  adapter: FileSystemAdapter,
  index: OralAnnotationIndex,
  kind: OralAnnotationKind,
): Promise<Uint8Array> {
  const ordered = sortSegmentWavNames(index.namesOfKind(kind));
  const clips = [];
  for (const name of ordered) clips.push({ name, bytes: await adapter.readBytes(name) });
  return concatenateWavs(clips);
}

/**
 * SayMore's audio export: the combined clips as a mono mp3 when `runFfmpeg` is
 * given (through temporary companion files that are removed afterwards), else
 * as the combined WAV.
 */
export async function exportOralAudio(opts: {
  adapter: FileSystemAdapter;
  index: OralAnnotationIndex;
  kind: OralAnnotationKind;
  sessionId: string;
  mediaFileName: string;
  runFfmpeg?: RunFfmpeg;
}): Promise<AudioExportResult> {
  const { adapter, index, kind, sessionId, mediaFileName, runFfmpeg } = opts;
  const baseName = `${sessionId}_${AUDIO_EXPORT_SUFFIX[kind]}`;
  const wav = await combineSegmentAudio(adapter, index, kind);
  if (!runFfmpeg) {
    return { fileName: `${baseName}.wav`, bytes: wav, mimeType: "audio/wav", fellBackToWav: true };
  }
  const folder = oralAnnotationsFolderName(mediaFileName);
  const wavTemp = `${folder}/_export_${kind}.wav`;
  const mp3Temp = `${folder}/_export_${kind}.mp3`;
  try {
    await adapter.writeBytes(wavTemp, wav);
    await runFfmpeg({ inputRelPath: wavTemp, outputRelPath: mp3Temp, args: MONO_MP3_FFMPEG_ARGS });
    const bytes = await adapter.readBytes(mp3Temp);
    return { fileName: `${baseName}.mp3`, bytes, mimeType: "audio/mpeg", fellBackToWav: false };
  } finally {
    for (const temp of [wavTemp, mp3Temp]) {
      try {
        if (await adapter.exists(temp)) await adapter.delete(temp);
      } catch {
        /* a leftover temporary file is harmless */
      }
    }
  }
}
