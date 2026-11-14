/**
 * SayMore's Careful Speech / Oral Translation audio export, minus the mp3 step:
 * the per-segment WAVs sorted by the number their file name starts with, then
 * their sample data joined back to back with no gaps or padding. SayMore
 * refuses clips whose WAV formats differ; so does this.
 */

/** The fixed fields of a WAV `fmt ` chunk that must match from clip to clip. */
interface WavParts {
  /** The first 16 bytes of the `fmt ` chunk, copied into the output header. */
  fmt: Uint8Array;
  formatKey: string;
  data: Uint8Array;
}

/** A clip whose WAV format differs from the first clip's. */
export class MixedWavFormatError extends Error {
  constructor(
    readonly fileName: string,
    readonly firstFileName: string,
  ) {
    super(
      `Can't concatenate WAV files that don't share the same format. "${fileName}" must have the same format as "${firstFileName}".`,
    );
    this.name = "MixedWavFormatError";
  }
}

/** A clip that is not a RIFF/WAVE file. */
export class NotWavError extends Error {
  constructor(readonly fileName: string) {
    super(`At least one of the source files is not WAV format. File name: "${fileName}".`);
    this.name = "NotWavError";
  }
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function parseWav(bytes: Uint8Array, fileName: string): WavParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourCC(view, 0) !== "RIFF" || fourCC(view, 8) !== "WAVE") {
    throw new NotWavError(fileName);
  }
  let fmt: Uint8Array | undefined;
  let data: Uint8Array | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.byteLength) {
      fmt = bytes.slice(body, body + 16);
    } else if (id === "data") {
      data = bytes.subarray(body, Math.min(body + size, bytes.byteLength));
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new NotWavError(fileName);
  return { fmt, data, formatKey: Array.from(fmt).join(",") };
}

/** The number a segment file name starts with (`0.75_to_1.25_Careful.wav` gives 0.75), or undefined. */
export function leadingNumber(fileName: string): number | undefined {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const m = /^[0-9.]+/.exec(base);
  if (!m) return undefined;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The clip names in SayMore's order: ascending by leading number, names with no
 * leading number dropped.
 */
export function sortSegmentWavNames(names: readonly string[]): string[] {
  return names
    .map((name, i) => ({ name, i, n: leadingNumber(name) }))
    .filter((e): e is { name: string; i: number; n: number } => e.n !== undefined)
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((e) => e.name);
}

/** Join the clips (already in order) into one WAV in the first clip's format. */
export function concatenateWavs(clips: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  if (clips.length === 0) throw new Error("No audio clips to combine.");
  const parts = clips.map((c) => parseWav(c.bytes, c.name));
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].formatKey !== parts[0].formatKey) {
      throw new MixedWavFormatError(clips[i].name, clips[0].name);
    }
  }
  const dataBytes = parts.reduce((sum, p) => sum + p.data.byteLength, 0);
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  out.set(parts[0].fmt, 20);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (const p of parts) {
    out.set(p.data, at);
    at += p.data.byteLength;
  }
  return out;
}
