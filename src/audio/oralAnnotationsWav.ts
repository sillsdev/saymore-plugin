import type { TimeRange } from "../model/TimeRange";
import { decodeWav, resampleLinear } from "./wavCodec";
import { floatToPcm16 } from "./wavWriter";

/**
 * Faithful port of SayMore's combined-annotation-file layout
 * (`D:\saymore\src\SayMore\Transcription\Model\OralAnnotationFileGenerator.cs`,
 * `InterleaveSegments`/`WriteAudioStreamToChannel`).
 *
 * Output channel layout is `[...sourceChannels, careful, translation]` at the
 * source's sample rate. Per (non-ignored) segment, three time blocks are
 * written back-to-back — never simultaneously — with the other channels
 * silent during each:
 *  1. the segment's source audio (careful/translation channels zeroed)
 *  2. the careful clip, if any (source + translation channels zeroed)
 *  3. the translation clip, if any (source + careful channels zeroed)
 * Ignored segments contribute nothing. If the raw segment list's last entry
 * ends before `totalDurationSec` (mirrors C#'s `TimeTier.IsFullySegmented`),
 * a trailing source-only block covers the unsegmented remainder.
 */

export interface OralAnnotationsSource {
  readonly channels: Float32Array[];
  readonly sampleRate: number;
}

export interface OralSegmentInput {
  readonly range: TimeRange;
  readonly ignored: boolean;
  /** Mono PCM WAV bytes (as produced by wavWriter's encodeWavPcm16Mono), any sample rate. */
  readonly careful?: Uint8Array;
  readonly translation?: Uint8Array;
}

type BlockDescriptor =
  | { readonly kind: "source"; readonly startIndex: number; readonly length: number }
  | { readonly kind: "careful"; readonly samples: Float32Array }
  | { readonly kind: "translation"; readonly samples: Float32Array };

/** Decode a mono annotation clip and resample it to the source's sample rate. */
function decodeAndResampleClip(bytes: Uint8Array, targetRate: number): Float32Array {
  const decoded = decodeWav(bytes);
  const mono = decoded.channels[0] ?? new Float32Array(0);
  return decoded.sampleRate === targetRate
    ? mono
    : resampleLinear(mono, decoded.sampleRate, targetRate);
}

function buildBlockDescriptors(
  source: OralAnnotationsSource,
  segments: OralSegmentInput[],
  totalDurationSec: number,
): BlockDescriptor[] {
  const sourceRate = source.sampleRate;
  const sourceLength = source.channels[0]?.length ?? 0;
  const toSampleIndex = (sec: number): number =>
    Math.max(0, Math.min(sourceLength, Math.round(sec * sourceRate)));

  const descriptors: BlockDescriptor[] = [];

  for (const segment of segments) {
    if (segment.ignored) continue;

    const startIndex = toSampleIndex(segment.range.start);
    const endIndex = toSampleIndex(segment.range.end);
    if (endIndex > startIndex) {
      descriptors.push({ kind: "source", startIndex, length: endIndex - startIndex });
    }
    if (segment.careful) {
      descriptors.push({
        kind: "careful",
        samples: decodeAndResampleClip(segment.careful, sourceRate),
      });
    }
    if (segment.translation) {
      descriptors.push({
        kind: "translation",
        samples: decodeAndResampleClip(segment.translation, sourceRate),
      });
    }
  }

  // Mirrors TimeTier.EndOfLastSegment: the raw (unfiltered-by-ignore) list's
  // last entry, not the last non-ignored one.
  const lastSegmentEnd = segments.length > 0 ? segments[segments.length - 1].range.end : 0;
  if (lastSegmentEnd < totalDurationSec) {
    const startIndex = toSampleIndex(lastSegmentEnd);
    const endIndex = toSampleIndex(totalDurationSec);
    if (endIndex > startIndex) {
      descriptors.push({ kind: "source", startIndex, length: endIndex - startIndex });
    }
  }

  return descriptors;
}

/** Encode already-interleaved Float32 samples ([-1, 1]) as a multichannel 16-bit PCM WAV. */
function encodeInterleavedPcm16(
  interleaved: Float32Array,
  numChannels: number,
  sampleRate: number,
): Uint8Array {
  const bytesPerFrame = numChannels * 2;
  const dataBytes = interleaved.length * 2;
  const byteRate = sampleRate * bytesPerFrame;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < interleaved.length; i++) {
    view.setInt16(44 + i * 2, floatToPcm16(interleaved[i]), true);
  }
  return new Uint8Array(buffer);
}

/**
 * Generate SayMore's combined `<media>.oralAnnotations.wav`: `(sourceChannels + 2)`
 * channels, 16-bit PCM, at `source.sampleRate`. See the module doc for the
 * block layout.
 */
export function generateOralAnnotationsWav(
  source: OralAnnotationsSource,
  segments: OralSegmentInput[],
  totalDurationSec: number,
): Uint8Array {
  const numSourceChannels = source.channels.length;
  const numOutputChannels = numSourceChannels + 2;
  const carefulChannel = numSourceChannels;
  const translationChannel = numSourceChannels + 1;

  const descriptors = buildBlockDescriptors(source, segments, totalDurationSec);

  let totalFrames = 0;
  for (const d of descriptors) {
    totalFrames += d.kind === "source" ? d.length : d.samples.length;
  }

  // Float32Array is zero-initialized, matching the C# writer's explicit
  // zero-writes for whichever channels aren't active in a given block.
  const interleaved = new Float32Array(totalFrames * numOutputChannels);
  let frameCursor = 0;

  for (const d of descriptors) {
    if (d.kind === "source") {
      for (let i = 0; i < d.length; i++) {
        const base = (frameCursor + i) * numOutputChannels;
        const srcIndex = d.startIndex + i;
        for (let c = 0; c < numSourceChannels; c++) {
          interleaved[base + c] = source.channels[c][srcIndex];
        }
      }
      frameCursor += d.length;
    } else {
      const targetChannel = d.kind === "careful" ? carefulChannel : translationChannel;
      for (let i = 0; i < d.samples.length; i++) {
        interleaved[(frameCursor + i) * numOutputChannels + targetChannel] = d.samples[i];
      }
      frameCursor += d.samples.length;
    }
  }

  return encodeInterleavedPcm16(interleaved, numOutputChannels, source.sampleRate);
}

// --- Web Worker message protocol (see oralAnnotationsWav.worker.ts) ---------

export interface OralAnnotationsWavRequest {
  readonly source: OralAnnotationsSource;
  readonly segments: OralSegmentInput[];
  readonly totalDurationSec: number;
}

export interface OralAnnotationsWavProgressMessage {
  readonly type: "progress";
  readonly fraction: number;
}

export interface OralAnnotationsWavResultMessage {
  readonly type: "result";
  readonly bytes: Uint8Array;
}

export type OralAnnotationsWavResponse =
  | OralAnnotationsWavProgressMessage
  | OralAnnotationsWavResultMessage;
