import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../../fs/InMemoryAdapter";
import { OralAnnotationIndex, oralAnnotationsFolderName } from "../../fs/OralAnnotationFiles";
import { annotationsEafName } from "../../fs/SessionFolder";
import { encodeWavPcm16Mono } from "../../audio/wavWriter";
import { buildAutoSegmentedEafXml } from "../../audio/autoSegmentToEaf";
import { AnnotationDocumentStore } from "../AnnotationDocumentStore";
import { combinedOralWavName } from "./combinedWav";
import { OralAnnotationsViewerModel, parseWavDurationSec } from "./OralAnnotationsViewerModel";
import type { OralAnnotationsSource } from "../../audio/oralAnnotationsWav";

const MEDIA = "m.wav";
const FOLDER = oralAnnotationsFolderName(MEDIA);
const COMBINED = combinedOralWavName(MEDIA);
const EAF = annotationsEafName(MEDIA);

function tinyWav(seconds = 1, rate = 8000): Uint8Array {
  return encodeWavPcm16Mono(new Float32Array(seconds * rate).fill(0.1), rate);
}

async function setup(opts?: { freshCombined?: boolean }) {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array([1, 2, 3, 4]));
  adapter.seed(EAF, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3]));
  adapter.seed(`${FOLDER}/0_to_1_Careful.wav`, tinyWav());
  if (opts?.freshCombined) adapter.seed(COMBINED, tinyWav(1)); // seeded last → newest

  const document = new AnnotationDocumentStore();
  document.init(MEDIA, 3, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3]));
  const oralIndex = await OralAnnotationIndex.build(adapter, MEDIA);

  let decodeCalls = 0;
  const decodeMedia = async (): Promise<OralAnnotationsSource> => {
    decodeCalls++;
    return { channels: [new Float32Array(3 * 8000)], sampleRate: 8000 };
  };

  const vm = new OralAnnotationsViewerModel({
    adapter,
    mediaFileName: MEDIA,
    document,
    oralIndex,
    decodeMedia,
  });
  return { adapter, vm, decodeCount: () => decodeCalls };
}

describe("parseWavDurationSec", () => {
  it("reads the duration from a PCM WAV header", () => {
    expect(parseWavDurationSec(tinyWav(2, 8000))).toBeCloseTo(2, 3);
    expect(parseWavDurationSec(new Uint8Array([1, 2, 3]))).toBe(0);
  });
});

describe("OralAnnotationsViewerModel", () => {
  it("auto-regenerates and loads when the combined file is missing", async () => {
    const { adapter, vm, decodeCount } = await setup();
    expect(await adapter.exists(COMBINED)).toBe(false);
    await vm.load();
    expect(decodeCount()).toBe(1); // regenerated
    expect(await adapter.exists(COMBINED)).toBe(true);
    expect(vm.bytes).toBeDefined();
    expect(vm.durationSec).toBeGreaterThan(0);
    expect(vm.isRegenerating).toBe(false);
  });

  it("loads without regenerating when the combined file is fresh", async () => {
    const { vm, decodeCount } = await setup({ freshCombined: true });
    await vm.load();
    expect(decodeCount()).toBe(0); // no regen
    expect(vm.bytes).toBeDefined();
  });

  it("regenerates when a per-segment WAV is newer than the combined file", async () => {
    const { adapter, vm, decodeCount } = await setup({ freshCombined: true });
    // Touch a clip so its mtime exceeds the combined file's.
    await adapter.writeBytes(`${FOLDER}/0_to_1_Careful.wav`, tinyWav());
    await vm.load();
    expect(decodeCount()).toBe(1);
  });

  it("regenerates when the eaf is newer than the combined file", async () => {
    const { adapter, vm, decodeCount } = await setup({ freshCombined: true });
    await adapter.writeText(EAF, buildAutoSegmentedEafXml(MEDIA, [1, 2, 3]));
    await vm.load();
    expect(decodeCount()).toBe(1);
  });

  it("regenerate() manually rebuilds and reloads", async () => {
    const { adapter, vm, decodeCount } = await setup({ freshCombined: true });
    await vm.load();
    expect(decodeCount()).toBe(0);
    await vm.regenerate();
    expect(decodeCount()).toBe(1);
    expect(await adapter.exists(COMBINED)).toBe(true);
    expect(vm.bytes).toBeDefined();
  });
});
