import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps built asset URLs relative so the SPA works when hosted in an
// iframe/webview or opened over file:// (the eventual lameta plugin scenario).
// worker.format: "es" is needed for the auto-segmenter worker (autoSegmenter.worker.ts).
export default defineConfig({
  base: "./",
  plugins: [react({ jsxImportSource: "@emotion/react" })],
  worker: {
    format: "es"
  }
});
