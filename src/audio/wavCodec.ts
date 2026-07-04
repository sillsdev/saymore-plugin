/**
 * WAV decoder + linear resampler — the read side of the wav* pair
 * ({@link "./wavWriter"} is the write side). Used to read back annotation clips
 * (always mono PCM16, written by {@link "./wavWriter"}) and — in
 * {@link "./oralAnnotationsWav"} — to resample them to the source media's rate.
 *
 * Deliberately separate from `envelope.ts`'s RIFF parsing (which produces a
 * min/max envelope, not raw samples, and is a pattern file — do not merge).
 */

export interface DecodedWav {
  readonly channels: Float32Array[];
  readonly sampleRate: number;
}

interface WavFormat {
  /** 1 = PCM int, 3 = IEEE float (after resolving WAVE_FORMAT_EXTENSIBLE). */
  formatCode: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
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

/** Walk the RIFF chunk list to find `fmt ` and `data`, skipping any others (e.g. `LIST`, `fact`). */
function parseWavHeader(view: DataView): {
  format: WavFormat;
  dataOffset: number;
  dataLength: number;
} {
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
      // WAVE_FORMAT_EXTENSIBLE (0xFFFE): real format code lives in the first two
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
      dataLength = Math.min(size, view.byteLength - body);
    }

    // Chunks are word-aligned; anything else (LIST, fact, JUNK, ...) is skipped.
    offset = body + size + (size & 1);
  }

  if (!format) throw new Error("WAV file has no 'fmt ' chunk.");
  if (dataOffset < 0) throw new Error("WAV file has no 'data' chunk.");
  return { format, dataOffset, dataLength };
}

/** Per-sample reader normalized to [-1, 1] for the given format, or throws for unsupported encodings. */
function makeSampleReader(view: DataView, format: WavFormat): (byteOffset: number) => number {
  const { formatCode, bitsPerSample } = format;

  if (formatCode === 1) {
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
 * Decode a RIFF/WAVE byte buffer into de-interleaved Float32 channels
 * normalized to [-1, 1], plus the file's native sample rate. Supports 8/16/24/32-bit
 * integer PCM and 32/64-bit IEEE float, mono or multi-channel; skips any chunks
 * other than `fmt `/`data` (e.g. `LIST`, `fact`) that precede or follow them.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = dataViewOf(bytes);
  const { format, dataOffset, dataLength } = parseWavHeader(view);

  const bytesPerSample = format.bitsPerSample / 8;
  const frameBytes = format.blockAlign || bytesPerSample * format.numChannels;
  if (frameBytes <= 0) {
    throw new Error("WAV file has an invalid block alignment (0 bytes/frame).");
  }
  const numFrames = Math.floor(dataLength / frameBytes);
  const readSample = makeSampleReader(view, format);

  const channels: Float32Array[] = [];
  for (let c = 0; c < format.numChannels; c++) {
    channels.push(new Float32Array(numFrames));
  }
  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < format.numChannels; c++) {
      const offset = dataOffset + frame * frameBytes + c * bytesPerSample;
      channels[c][frame] = readSample(offset);
    }
  }

  return { channels, sampleRate: format.sampleRate };
}

/**
 * Linear-interpolation resample of a single channel from `fromRate` to `toRate`.
 * Output length is `round(samples.length * toRate / fromRate)`; the last output
 * sample maps to (clamped at) the last input sample, so endpoints are preserved.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (fromRate === toRate) return Float32Array.from(samples);

  const outLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const ratio = (samples.length - 1) / Math.max(1, outLength - 1);
  const out = new Float32Array(outLength);
  const lastIndex = samples.length - 1;

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.min(lastIndex, Math.floor(srcPos));
    const i1 = Math.min(lastIndex, i0 + 1);
    const frac = srcPos - i0;
    out[i] = samples[i0] + (samples[i1] - samples[i0]) * frac;
  }

  return out;
}
