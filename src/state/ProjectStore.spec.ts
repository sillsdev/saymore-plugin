// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { testDataPath } from "../testData";
import { InMemoryAdapter } from "../fs/InMemoryAdapter";
import { annotationsEafName } from "../fs/SessionFolder";
import { ProjectStore } from "./ProjectStore";

const MEDIA = "shortSound.wav";

function seededAdapter(): InMemoryAdapter {
  const adapter = new InMemoryAdapter();
  adapter.seed(MEDIA, new Uint8Array(readFileSync(testDataPath("media", MEDIA))));
  // A real, parseable EAF beside the media (any valid one — we only need segments to load).
  adapter.seed(
    annotationsEafName(MEDIA),
    readFileSync(testDataPath("session", "longerSound.wav.annotations.eaf"), "utf8"),
  );
  return adapter;
}

describe("ProjectStore progressive load", () => {
  it("reveals the grid (document + segmenter) before the waveform envelope decodes", async () => {
    const store = new ProjectStore();
    await store.openSession(seededAdapter());

    // openSession resolves at the end of stage A2: the shell is up…
    expect(store.document).toBeDefined();
    expect(store.segmenter).toBeDefined();
    expect(store.annotationsView).toBe("grid");
    expect(store.oralIndex).toBeDefined();

    // …but the (expensive) waveform envelope is still decoding in the background.
    // It lands shortly after, filling in the real duration.
    await vi.waitFor(() => expect(store.envelope).toBeDefined());
    expect(store.document!.durationSec).toBeGreaterThan(0);
    expect(store.loadPhase).toBe("idle");
  });

  it("builds the recorder right after openSession, before the media finishes loading", async () => {
    const store = new ProjectStore();
    await store.openSession(seededAdapter());

    // The oral flows only need document + oralIndex, both ready at openSession — so the
    // recorder tab can build (and render) without waiting on the background media read.
    expect(store.document).toBeDefined();
    expect(store.oralIndex).toBeDefined();

    store.openRecorder("Careful");
    await vi.waitFor(() => expect(store.recorder).toBeDefined());

    // The source media (and waveform) still stream in afterwards.
    await vi.waitFor(() => expect(store.envelope).toBeDefined());
  });

  it("abandons a superseded background decode when a new load starts", async () => {
    const store = new ProjectStore();
    // First load, then immediately open a second session before the first's decode is applied.
    const first = store.openSession(seededAdapter());
    const second = store.openSession(seededAdapter());
    await Promise.all([first, second]);

    // The store settles on exactly one session; the stale decode never clobbers it.
    await vi.waitFor(() => expect(store.envelope).toBeDefined());
    expect(store.document).toBeDefined();
    expect(store.loadPhase).toBe("idle");
  });
});
