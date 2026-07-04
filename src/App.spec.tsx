// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

// happy-dom spec: proves the React 18 + Emotion css-prop + @testing-library
// component-testing path works (this is how the segmenter/grid specs will run).
describe("App shell", () => {
  it("renders the host simulator as the standalone root", () => {
    render(<App />);
    // The harness header shows immediately, before the (async, IndexedDB-backed)
    // session load resolves — so this holds even where IndexedDB is unavailable.
    expect(screen.getByText(/harness/i)).toBeTruthy();
  });
});
