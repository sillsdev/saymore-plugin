import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the built SPA works from a file:// URL or inside the
  // lameta plugin iframe/webview (no fixed server root).
  base: "./",
  plugins: [
    react({
      // Emotion `css` prop: route the automatic JSX runtime through Emotion
      // (matches tsconfig `jsxImportSource`). No Babel plugin needed for this.
      jsxImportSource: "@emotion/react",
    }),
  ],
  // Open the default browser to the dev server URL on `vp dev`.
  server: { open: true },
  // autoSegmenter.worker.ts is an ES module worker.
  worker: { format: "es" },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
