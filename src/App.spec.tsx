// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

// happy-dom spec: proves the React 18 + Emotion css-prop + @testing-library
// component-testing path works (this is how the segmenter/grid specs will run).
describe("App shell", () => {
  it("renders the OpenScreen until a session is loaded", () => {
    render(<App />);
    expect(screen.getByText(/Manual Segmenter/)).toBeTruthy();
    expect(screen.getByText(/Drop one audio file/)).toBeTruthy();
  });
});
