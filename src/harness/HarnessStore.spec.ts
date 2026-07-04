// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectStore } from "../state/ProjectStore";
import { HarnessStore } from "./HarnessStore";

/**
 * Regression coverage for a bug Worker D found: AnnotationsPaneView drives
 * `ProjectStore.annotationsView` directly (grid/segmenter/recorder), not
 * through HarnessStore's own (now-deleted) showGrid()/showSegmenter()
 * delegates, so the harness URL stopped tracking view changes. A reaction in
 * the constructor mirrors `annotationsView` into the URL regardless of who
 * changed it.
 */
describe("HarnessStore URL sync", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("mirrors ProjectStore.annotationsView into the URL even when nothing calls back through the harness", () => {
    const projectStore = new ProjectStore();
    const harness = new HarnessStore(projectStore);
    // An `.eaf` selection is a precondition of writeHarnessUrlState including `view`.
    harness.selection = "eaf";

    // ProjectStore defaults annotationsView to "segmenter" — go to grid first
    // so each assertion below observes a real change (a MobX reaction never
    // fires on a no-op re-assignment to the same value).
    projectStore.showGrid();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("grid");

    projectStore.showSegmenter();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("segmenter");
  });
});
