import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Node environment by default (pure model/audio/fs logic). Component specs that
// need a DOM opt in per-file with a `// @vitest-environment happy-dom` comment.
export default defineConfig({
  plugins: [react({ jsxImportSource: "@emotion/react" })],
  test: {
    globals: true,
    watch: false,
    environment: "node",
    include: ["src/**/*.spec.{ts,tsx}"]
  }
});
