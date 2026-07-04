import { describe, it, expect } from "vitest";
import { deriveSessionTree } from "./sessionTree";

describe("deriveSessionTree", () => {
  it("returns just the Audio node for a bare media file", () => {
    const tree = deriveSessionTree(["longerSound.wav"]);
    expect(tree.mediaFileName).toBe("longerSound.wav");
    expect(tree.eafName).toBeUndefined();
    expect(tree.nodes.map((n) => [n.kind, n.typeLabel, n.depth])).toEqual([["audio", "Audio", 0]]);
  });

  it("adds a nested Annotations node when the eaf exists", () => {
    const tree = deriveSessionTree(["longerSound.wav", "longerSound.wav.annotations.eaf"]);
    expect(tree.eafName).toBe("longerSound.wav.annotations.eaf");
    expect(tree.nodes.map((n) => n.kind)).toEqual(["audio", "eaf"]);
    expect(tree.nodes[1].depth).toBe(1);
  });

  it("adds an OralAnnotations node (the oralAnnotations.wav file, depth 2) under the eaf", () => {
    const tree = deriveSessionTree([
      "longerSound.wav",
      "longerSound.wav.annotations.eaf",
      "longerSound.wav.oralAnnotations.wav",
    ]);
    expect(tree.nodes.map((n) => [n.kind, n.name, n.typeLabel])).toEqual([
      ["audio", "longerSound.wav", "Audio"],
      ["eaf", "longerSound.wav.annotations.eaf", "Annotations"],
      ["oral", "longerSound.wav.oralAnnotations.wav", "OralAnnotations"],
    ]);
    expect(tree.nodes[2].depth).toBe(2);
  });

  it("does NOT show OralAnnotations without an eaf (oral rows hang off the eaf)", () => {
    const tree = deriveSessionTree(["longerSound.wav", "longerSound.wav.oralAnnotations.wav"]);
    expect(tree.nodes.map((n) => n.kind)).toEqual(["audio"]);
  });

  it("returns nothing when there is no media file", () => {
    expect(deriveSessionTree(["notes.txt"]).nodes).toEqual([]);
  });
});
