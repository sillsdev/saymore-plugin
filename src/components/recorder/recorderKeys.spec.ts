import { describe, it, expect } from "vitest";
import { recorderKeyAction } from "./recorderKeys";

describe("recorderKeyAction", () => {
  it("space down/up drives Listen while gating, Record once armed", () => {
    expect(recorderKeyAction(" ", "down", false, "Listen", false)).toBe("listenDown");
    expect(recorderKeyAction(" ", "up", false, "Listen", false)).toBe("listenUp");
    expect(recorderKeyAction(" ", "down", false, "Record", false)).toBe("speakDown");
    expect(recorderKeyAction(" ", "up", false, "Record", false)).toBe("speakUp");
  });

  it("space does nothing in Done or Error mode", () => {
    expect(recorderKeyAction(" ", "down", false, "Done", false)).toBeUndefined();
    expect(recorderKeyAction(" ", "down", false, "Error", false)).toBeUndefined();
  });

  it("filters OS key-repeat on space so it doesn't re-trigger", () => {
    expect(recorderKeyAction(" ", "down", true, "Listen", false)).toBeUndefined();
    expect(recorderKeyAction(" ", "down", true, "Record", false)).toBeUndefined();
  });

  it("'b' replays the source on key-down only", () => {
    expect(recorderKeyAction("b", "down", false, "Listen", false)).toBe("replay");
    expect(recorderKeyAction("b", "up", false, "Listen", false)).toBeUndefined();
  });

  it("arrow keys nudge the new-segment boundary only when currentIsNew", () => {
    expect(recorderKeyAction("ArrowLeft", "down", false, "Listen", true)).toBe(
      "nudgeNewBoundaryLeft",
    );
    expect(recorderKeyAction("ArrowRight", "down", false, "Listen", true)).toBe(
      "nudgeNewBoundaryRight",
    );
    expect(recorderKeyAction("ArrowLeft", "down", false, "Listen", false)).toBeUndefined();
  });

  it("Escape aborts", () => {
    expect(recorderKeyAction("Escape", "down", false, "Record", false)).toBe("abort");
  });

  it("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo", () => {
    expect(
      recorderKeyAction("z", "down", false, "Listen", false, { ctrlKey: true, shiftKey: false }),
    ).toBe("undo");
    expect(
      recorderKeyAction("z", "down", false, "Listen", false, { ctrlKey: true, shiftKey: true }),
    ).toBe("redo");
    expect(
      recorderKeyAction("y", "down", false, "Listen", false, { ctrlKey: true, shiftKey: false }),
    ).toBe("redo");
  });

  it("plain Z (no modifier) also undoes, matching the hover Undo button's tooltip", () => {
    expect(recorderKeyAction("z", "down", false, "Listen", false)).toBe("undo");
    expect(recorderKeyAction("Z", "down", false, "Listen", false)).toBe("undo");
  });

  it("plain y (no modifier) does nothing", () => {
    expect(recorderKeyAction("y", "down", false, "Listen", false)).toBeUndefined();
  });

  it("unrelated keys and key-up phases (other than space) are ignored", () => {
    expect(recorderKeyAction("Enter", "down", false, "Listen", false)).toBeUndefined();
    expect(recorderKeyAction("Escape", "up", false, "Record", false)).toBeUndefined();
  });
});
