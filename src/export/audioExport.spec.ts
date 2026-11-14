import { describe, expect, it } from "vitest";
import { decodeWav } from "../audio/wavCodec";
import { encodeWavPcm16Mono } from "../audio/wavWriter";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { OralAnnotationIndex } from "../fs/OralAnnotationFiles";
import { exportOralAudio, MONO_MP3_FFMPEG_ARGS } from "./audioExport";

const MEDIA = "S.wav";
const wav = (v: number) => encodeWavPcm16Mono(new Float32Array([v]), 8000);

async function seeded() {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array(4));
  adapter.seed(`${MEDIA}_Annotations/2_to_3_Careful.wav`, wav(0.5));
  adapter.seed(`${MEDIA}_Annotations/0.5_to_2_Careful.wav`, wav(0.25));
  adapter.seed(`${MEDIA}_Annotations/0.5_to_2_Translation.wav`, wav(-0.5));
  return { adapter, index: await OralAnnotationIndex.build(adapter, MEDIA) };
}

describe("exportOralAudio", () => {
  it("delivers the combined WAV of one kind when there is no ffmpeg", async () => {
    const { adapter, index } = await seeded();
    const r = await exportOralAudio({
      adapter,
      index,
      kind: "Careful",
      sessionId: "S",
      mediaFileName: MEDIA,
    });
    expect(r.fileName).toBe("S_CarefulSpeech.wav");
    expect(r.fellBackToWav).toBe(true);
    expect(Array.from(decodeWav(r.bytes).channels[0])).toEqual([0.25, 0.5]);
  });

  it("names the oral translation export after SayMore", async () => {
    const { adapter, index } = await seeded();
    const r = await exportOralAudio({
      adapter,
      index,
      kind: "Translation",
      sessionId: "S",
      mediaFileName: MEDIA,
    });
    expect(r.fileName).toBe("S_OralTranslation.wav");
  });

  it("encodes through temporary companion files and removes them", async () => {
    const { adapter, index } = await seeded();
    let seen: { args: string[]; inputExisted: boolean } | undefined;
    const r = await exportOralAudio({
      adapter,
      index,
      kind: "Careful",
      sessionId: "S",
      mediaFileName: MEDIA,
      runFfmpeg: async (spec) => {
        seen = { args: spec.args, inputExisted: await adapter.exists(spec.inputRelPath) };
        await adapter.writeBytes(spec.outputRelPath, new Uint8Array([1, 2, 3]));
      },
    });
    expect(seen).toEqual({ args: MONO_MP3_FFMPEG_ARGS, inputExisted: true });
    expect(r.fileName).toBe("S_CarefulSpeech.mp3");
    expect(r.fellBackToWav).toBe(false);
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect((await adapter.list()).filter((n) => n.includes("_export_"))).toEqual([]);
  });

  it("removes the temporary files when ffmpeg fails", async () => {
    const { adapter, index } = await seeded();
    await expect(
      exportOralAudio({
        adapter,
        index,
        kind: "Careful",
        sessionId: "S",
        mediaFileName: MEDIA,
        runFfmpeg: async () => {
          throw new Error("ffmpeg exited 1");
        },
      }),
    ).rejects.toThrow("ffmpeg exited 1");
    expect((await adapter.list()).filter((n) => n.includes("_export_"))).toEqual([]);
  });
});
