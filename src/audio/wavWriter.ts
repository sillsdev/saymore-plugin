/**
 * Canonical 16-bit PCM WAV encoder — the write side of the wav* pair
 * ({@link "./wavCodec"} is the read side). Used for per-segment annotation
 * recordings (`MicRecorder` output) and is deliberately minimal: mono only,
 * 16-bit only, no extra chunks, matching what SayMore's own recorder writes.
 */

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const NUM_CHANNELS = 1;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Round half away from zero (unlike `Math.round`, which rounds -0.5 to -0, i.e. toward +Infinity). */
function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

/** Clamp to [-1, 1], then scale/round to a signed 16-bit PCM sample. */
function floatToPcm16(sample: number): number {
  const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
  // +1.0 * 32768 = 32768, one past int16 max; the final clamp pulls it back to
  // 32767 (the standard asymmetric float->int16 full-scale mapping).
  const pcm = roundHalfAwayFromZero(clamped * 32768);
  return pcm < -32768 ? -32768 : pcm > 32767 ? 32767 : pcm;
}

/**
 * Encode a single-channel Float32 sample buffer ([-1, 1] range) as a canonical
 * 44-byte-header RIFF/WAVE file: PCM, mono, 16-bit, little-endian.
 */
export function encodeWavPcm16Mono(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * NUM_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = NUM_CHANNELS * BYTES_PER_SAMPLE;

  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat: 1 = PCM
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    view.setInt16(HEADER_BYTES + i * BYTES_PER_SAMPLE, floatToPcm16(samples[i]), true);
  }

  return new Uint8Array(buffer);
}
