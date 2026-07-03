import type { ChannelEnvelope, Envelope } from "./EnvelopeCache";

/**
 * Builds the 1-sample-per-millisecond min/max {@link Envelope} that feeds
 * wavesurfer `peaks`, the grid thumbnails, and the auto-segmenter (plan
 * decision: compute this once, discard raw PCM).
 *
 * Two paths:
 *  - **WAV** → {@link computeEnvelopeFromWav}: we stream-parse the RIFF/WAVE PCM
 *    ourselves at the file's native sample rate (no Web Audio, no full decode,
 *    no resample). This is exact and works in node/tests.
 *  - **Compressed** (mp3/m4a/ogg/…) → a single `AudioContext.decodeAudioData`,
 *    from which we build the envelope and throw the PCM away. Browser-only.
 */

interface WavFormat {
  /** 1 = PCM int, 3 = IEEE float (after resolving WAVE_FORMAT_EXTENSIBLE). */
  formatCode: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Bytes per frame (all channels): numChannels * bitsPerSample / 8. */
  blockAlign: number;
}

interface WavData {
  format: WavFormat;
  /** Byte offset of the first sample within the underlying buffer. */
  dataOffset: number;
  /** Length of the `data` chunk in bytes. */
  dataLength: number;
}

function dataViewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Parse the RIFF/WAVE container: locate the `fmt ` and `data` chunks. */
function parseWavHeader(bytes: Uint8Array): WavData {
  const view = dataViewOf(bytes);
  if (view.byteLength < 12) {
    throw new Error("Not a WAV file: too short for a RIFF header.");
  }
  const riff = readFourCC(view, 0);
  const wave = readFourCC(view, 8);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Not a WAV file: expected 'RIFF'/'WAVE' but found '${riff}'/'${wave}'.`);
  }

  let format: WavFormat | undefined;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk the chunk list. Each chunk is [id:4][size:4LE][data:size], padded to
  // an even byte boundary.
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      let formatCode = view.getUint16(body, true);
      const numChannels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE (0xFFFE): the real format lives in the first two
      // bytes of the SubFormat GUID at body + 24.
      if (formatCode === 0xfffe && size >= 40) {
        formatCode = view.getUint16(body + 24, true);
      }
      format = {
        formatCode,
        numChannels,
        sampleRate,
        bitsPerSample,
        blockAlign: blockAlign || (numChannels * bitsPerSample) / 8,
      };
    } else if (id === "data") {
      dataOffset = body;
      // A streamed/odd file can report a size that overruns the buffer; clamp.
      dataLength = Math.min(size, view.byteLength - body);
    }

    // Advance (chunks are word-aligned).
    offset = body + size + (size & 1);
  }

  if (!format) throw new Error("WAV file has no 'fmt ' chunk.");
  if (dataOffset < 0) throw new Error("WAV file has no 'data' chunk.");
  return { format, dataOffset, dataLength };
}

/**
 * Returns a per-sample reader that yields a value normalized to [-1, 1] for the
 * given WAV format, or throws for unsupported bit depths / encodings.
 */
function makeSampleReader(view: DataView, format: WavFormat): (byteOffset: number) => number {
  const { formatCode, bitsPerSample } = format;

  if (formatCode === 1) {
    // Integer PCM.
    switch (bitsPerSample) {
      case 8:
        // 8-bit WAV PCM is UNSIGNED, midpoint 128.
        return (o) => (view.getUint8(o) - 128) / 128;
      case 16:
        return (o) => view.getInt16(o, true) / 32768;
      case 24:
        return (o) => {
          const b0 = view.getUint8(o);
          const b1 = view.getUint8(o + 1);
          const b2 = view.getUint8(o + 2);
          let v = b0 | (b1 << 8) | (b2 << 16);
          if (v & 0x800000) v -= 0x1000000; // sign-extend
          return v / 8388608;
        };
      case 32:
        return (o) => view.getInt32(o, true) / 2147483648;
      default:
        throw new Error(`Unsupported PCM bit depth: ${bitsPerSample}-bit (supported: 8/16/24/32).`);
    }
  }

  if (formatCode === 3) {
    // IEEE float PCM (already ~[-1, 1]).
    switch (bitsPerSample) {
      case 32:
        return (o) => view.getFloat32(o, true);
      case 64:
        return (o) => view.getFloat64(o, true);
      default:
        throw new Error(
          `Unsupported IEEE-float bit depth: ${bitsPerSample}-bit (supported: 32/64).`,
        );
    }
  }

  throw new Error(
    `Unsupported WAV encoding: format code ${formatCode} (supported: 1=PCM, 3=IEEE float).`,
  );
}

/**
 * Bucket normalized channel sample data into 1-per-ms min/max envelopes.
 *
 * `readChannel(channelIndex, frameIndex)` returns the normalized sample for a
 * frame; this is the single seam both the WAV and Web Audio paths use.
 */
function bucketize(
  numFrames: number,
  sampleRate: number,
  numChannels: number,
  readChannel: (channel: number, frame: number) => number,
): { channels: ChannelEnvelope[]; durationSec: number } {
  const durationSec = numFrames / sampleRate;
  const numBuckets = Math.max(1, Math.round(durationSec * 1000));
  const samplesPerMs = sampleRate / 1000;

  const channels: ChannelEnvelope[] = [];
  for (let c = 0; c < numChannels; c++) {
    const min = new Float32Array(numBuckets);
    const max = new Float32Array(numBuckets);
    min.fill(Number.POSITIVE_INFINITY);
    max.fill(Number.NEGATIVE_INFINITY);

    for (let i = 0; i < numFrames; i++) {
      const bucket = Math.min(numBuckets - 1, Math.floor(i / samplesPerMs));
      const v = readChannel(c, i);
      if (v < min[bucket]) min[bucket] = v;
      if (v > max[bucket]) max[bucket] = v;
    }

    // Any bucket that received no samples (possible for pathological rates)
    // collapses to silence rather than ±Infinity.
    for (let b = 0; b < numBuckets; b++) {
      if (!Number.isFinite(min[b])) min[b] = 0;
      if (!Number.isFinite(max[b])) max[b] = 0;
    }

    channels.push({ min, max });
  }

  return { channels, durationSec };
}

/**
 * Parse a WAV file's bytes and produce its per-ms min/max {@link Envelope} at
 * the file's native sample rate. Supports 8/16/24/32-bit integer PCM and
 * 32/64-bit IEEE float, mono or multi-channel (deinterleaved). Throws a clear
 * error for anything else.
 */
export function computeEnvelopeFromWav(bytes: Uint8Array): Envelope {
  const { format, dataOffset, dataLength } = parseWavHeader(bytes);
  const view = dataViewOf(bytes);
  const bytesPerSample = format.bitsPerSample / 8;
  const frameBytes = format.blockAlign || bytesPerSample * format.numChannels;
  if (frameBytes <= 0) {
    throw new Error("WAV file has an invalid block alignment (0 bytes/frame).");
  }
  const numFrames = Math.floor(dataLength / frameBytes);
  const readSample = makeSampleReader(view, format);

  const readChannel = (channel: number, frame: number): number => {
    const offset = dataOffset + (frame * format.numChannels + channel) * bytesPerSample;
    return readSample(offset);
  };

  const { channels, durationSec } = bucketize(
    numFrames,
    format.sampleRate,
    format.numChannels,
    readChannel,
  );

  return {
    channels,
    samplesPerMs: 1,
    sampleRate: format.sampleRate,
    durationSec,
  };
}

/** True for MIME types / extensions we treat as WAV. */
function isWav(mimeOrExt?: string): boolean {
  if (!mimeOrExt) return false;
  const s = mimeOrExt.toLowerCase();
  return s.includes("wav") || s.endsWith(".wave") || s === "wave" || s === "audio/x-wav";
}

/** Cheap signature sniff for a RIFF/WAVE container. */
function looksLikeWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const view = dataViewOf(bytes);
  return readFourCC(view, 0) === "RIFF" && readFourCC(view, 8) === "WAVE";
}

type DecodeCapableCtx = {
  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer>;
  close?: () => Promise<void> | void;
};

function getAudioContextCtor(): (new () => DecodeCapableCtx) | undefined {
  const g = globalThis as unknown as {
    AudioContext?: new () => DecodeCapableCtx;
    webkitAudioContext?: new () => DecodeCapableCtx;
    OfflineAudioContext?: new (
      channels: number,
      length: number,
      sampleRate: number,
    ) => DecodeCapableCtx;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

/**
 * Build an {@link Envelope} from a compressed audio file via a one-shot
 * `AudioContext.decodeAudioData`. Browser-only; the PCM is discarded after
 * bucketing. Note (plan): browser codecs are not bit-identical to NAudio, so
 * envelopes for compressed sources are "equivalent", not identical.
 */
async function computeEnvelopeViaWebAudio(bytes: Uint8Array): Promise<Envelope> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    throw new Error(
      "compressed decode requires a browser AudioContext (none available in this environment).",
    );
  }
  const ctx = new Ctor();
  try {
    // decodeAudioData wants an ArrayBuffer that owns exactly the data.
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(ab);

    const numChannels = audioBuffer.numberOfChannels;
    const numFrames = audioBuffer.length;
    const channelData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }

    const { channels, durationSec } = bucketize(
      numFrames,
      audioBuffer.sampleRate,
      numChannels,
      (channel, frame) => channelData[channel][frame],
    );

    return {
      channels,
      samplesPerMs: 1,
      sampleRate: audioBuffer.sampleRate,
      durationSec,
    };
  } finally {
    void ctx.close?.();
  }
}

/**
 * Dispatch by container: WAV files are stream-parsed synchronously (wrapped in a
 * resolved promise); everything else falls back to the browser Web Audio decode
 * path. `mimeOrExt` (a MIME type or file extension) is an optional hint; if
 * absent we sniff the RIFF/WAVE signature.
 */
export async function computeEnvelope(bytes: Uint8Array, mimeOrExt?: string): Promise<Envelope> {
  if (isWav(mimeOrExt) || (!mimeOrExt && looksLikeWav(bytes))) {
    return computeEnvelopeFromWav(bytes);
  }
  // A caller may pass a WAV without a hint but we still catch it via signature.
  if (looksLikeWav(bytes)) {
    return computeEnvelopeFromWav(bytes);
  }
  return computeEnvelopeViaWebAudio(bytes);
}

/**
 * Convenience adapter to feed wavesurfer v7's precomputed `peaks` input, which
 * accepts one array per channel. We return each channel's per-ms `max` array
 * (normalized [-1, 1]); the waveform component can also read `envelope.channels`
 * directly if it wants the full min/max pair.
 */
export function envelopeToPeaks(envelope: Envelope): number[][] {
  return envelope.channels.map((ch) => Array.from(ch.max));
}
