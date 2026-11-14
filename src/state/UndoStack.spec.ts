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

  it("undoes and redoes only while the state is what its last step left", () => {
    let state = "a";
    const stack = new UndoStack(() => state);
    stack.do({ label: "x", apply: () => (state = "b"), revert: () => (state = "a") });
    expect(stack.canUndo).toBe(true);
    state = "changed elsewhere";
    expect(stack.canUndo).toBe(false);
    expect(stack.undoLabel).toBeUndefined();
    stack.undo();
    expect(state).toBe("changed elsewhere");
    state = "b";
    expect(stack.canUndo).toBe(false);
  });

  it("drops a redo whose state was changed elsewhere", () => {
    let state = "a";
    const stack = new UndoStack(() => state);
    stack.do({ label: "x", apply: () => (state = "b"), revert: () => (state = "a") });
    stack.undo();
    expect(stack.canRedo).toBe(true);
    state = "changed elsewhere";
    expect(stack.canRedo).toBe(false);
    stack.redo();
    expect(state).toBe("changed elsewhere");
  });

  it("keeps the file ops of applied commands when it drops its history, but not of undone ones", () => {
    let state = 0;
    const stack = new UndoStack(() => String(state));
    const rename = { kind: "rename", from: "a.wav", to: "b.wav" } as const;
    const del = { kind: "delete", name: "c.wav" } as const;
    stack.do({ label: "move", apply: () => state++, revert: () => state--, fileOps: [rename] });
    stack.do({ label: "delete", apply: () => state++, revert: () => state--, fileOps: [del] });
    stack.undo();
    state = 99;
    stack.undo();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.collectFileOps()).toEqual([rename]);
    stack.do({ label: "x", apply: () => {}, revert: () => {}, fileOps: [del] });
    expect(stack.collectFileOps()).toEqual([rename, del]);
    stack.clear();
    expect(stack.collectFileOps()).toEqual([]);
  });
});
