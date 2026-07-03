import { describe, it, expect } from "vitest";
import { UndoStack, type Command } from "./UndoStack";

function counterCommand(log: string[], name: string): Command {
  return {
    label: name,
    apply: () => log.push(`+${name}`),
    revert: () => log.push(`-${name}`),
  };
}

describe("UndoStack", () => {
  it("applies, undoes, and redoes in order", () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.do(counterCommand(log, "a"));
    stack.do(counterCommand(log, "b"));
    expect(stack.canUndo).toBe(true);
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.redo();
    expect(log).toEqual(["+a", "+b", "-b", "+b"]);
  });

  it("a new command clears the redo stack", () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.do(counterCommand(log, "a"));
    stack.undo();
    stack.do(counterCommand(log, "b"));
    expect(stack.canRedo).toBe(false);
  });

  it("collects deferred file ops only from applied commands", () => {
    const stack = new UndoStack();
    stack.do({
      label: "move",
      apply: () => {},
      revert: () => {},
      fileOps: [{ kind: "rename", from: "a.wav", to: "b.wav" }],
    });
    stack.do({
      label: "delete",
      apply: () => {},
      revert: () => {},
      fileOps: [{ kind: "delete", name: "c.wav" }],
    });
    expect(stack.collectFileOps()).toHaveLength(2);
    stack.undo();
    expect(stack.collectFileOps()).toEqual([{ kind: "rename", from: "a.wav", to: "b.wav" }]);
  });
});
