/** @jsxImportSource @emotion/react */
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { ProjectStore } from "./state/ProjectStore";
import { OpenScreen } from "./components/shell/OpenScreen";
import { ManualSegmenterView } from "./components/segmenter/ManualSegmenterView";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";

/**
 * Shell: the OpenScreen until a session (or single file) is loaded, then the
 * Manual Segmenter. Auto Segmenter and the Transcription grid arrive in later
 * phases (they reuse the same ProjectStore + WaveformSurface).
 */
export const App = observer(function App() {
  const [store] = useState(() => new ProjectStore());
  return (
    <ErrorBoundary>
      {store.segmenter ? <ManualSegmenterView store={store} /> : <OpenScreen store={store} />}
    </ErrorBoundary>
  );
});
