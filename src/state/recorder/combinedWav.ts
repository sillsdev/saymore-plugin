import type { FileSystemAdapter } from "../../fs/FileSystemAdapter";
import { ORAL_ANNOTATIONS_WAV_SUFFIX } from "../../model/SayMoreConstants";
import type { OralAnnotationsSource, OralSegmentInput } from "../../audio/oralAnnotationsWav";
import { runGenerateOralAnnotationsWav } from "../../audio/oralAnnotationsWavClient";

/** Relative path of the combined file, e.g. `X.wav.oralAnnotations.wav`. */
export function combinedOralWavName(mediaFileName: string): string {
  return `${mediaFileName}${ORAL_ANNOTATIONS_WAV_SUFFIX}`;
}

/** Decode the source media bytes to per-channel Float32 (undefined if unavailable). */
export type MediaDecoder = (bytes: Uint8Array) => Promise<OralAnnotationsSource | undefined>;

export type OralWavGenerator = (
  source: OralAnnotationsSource,
  segments: OralSegmentInput[],
  totalDurationSec: number,
  onProgress?: (fraction: number) => void,
) => Promise<Uint8Array>;

export type CombinedWavOutcome = "written" | "skipped-no-annotations" | "skipped-no-source";

export interface RegenerateCombinedOralWavOptions {
  adapter: FileSystemAdapter;
  mediaFileName: string;
  totalDurationSec: number;
  segments: OralSegmentInput[];
  decodeMedia: MediaDecoder;
  /** Defaults to the worker-backed client (sync fallback in node/tests). */
  generate?: OralWavGenerator;
  onProgress?: (fraction: number) => void;
}

/**
 * Regenerate SayMore's combined `<media>.oralAnnotations.wav` on leaving the
 * recorder. Skips when no segment carries a Careful/Translation clip (SayMore
 * `CanGenerate` parity), decodes the source media once to Float32 channels, runs
 * B's generator (worker off-thread when available), and writes the result via
 * the adapter.
 *
 * KNOWN LIMITATION (intentionally not solved here): {@link MediaDecoder} does a
 * full-PCM decode of the entire media file; for hour-long recordings this is
 * memory-heavy. Streaming generation is a later optimization.
 */
export async function regenerateCombinedOralWav(
  opts: RegenerateCombinedOralWavOptions,
): Promise<CombinedWavOutcome> {
  const hasAnnotation = opts.segments.some((s) => s.careful || s.translation);
  if (!hasAnnotation) return "skipped-no-annotations";

  const mediaBytes = await opts.adapter.readBytes(opts.mediaFileName);
  const source = await opts.decodeMedia(mediaBytes);
  if (!source) return "skipped-no-source";

  const generate = opts.generate ?? runGenerateOralAnnotationsWav;
  const bytes = await generate(source, opts.segments, opts.totalDurationSec, opts.onProgress);
  await opts.adapter.writeBytes(combinedOralWavName(opts.mediaFileName), bytes);
  return "written";
}
