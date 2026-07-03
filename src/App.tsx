/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { ProjectStore } from "./state/ProjectStore";
import { OpenScreen } from "./components/shell/OpenScreen";
import { ManualSegmenterView } from "./components/segmenter/ManualSegmenterView";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { connectPluginAdapter, isEmbeddedInHost } from "./plugin/connectPlugin";
import { t } from "./l10n";

/**
 * Shell. Two entry paths feed the same ProjectStore + tools:
 *  - Embedded in lameta's plugin iframe: connect over postMessage, wrap the host
 *    file API in a PluginHostAdapter, and open the selected file's session.
 *  - Standalone dev harness (`vp dev`): show the OpenScreen (folder / drop a file).
 * Once a session loads, the Manual Segmenter renders (Auto Segmenter and the
 * Transcription grid arrive in later phases and reuse this store).
 */
export const App = observer(function App() {
  const [store] = useState(() => new ProjectStore());
  const embedded = useMemo(() => isEmbeddedInHost(), []);
  const [connectError, setConnectError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    void (async () => {
      try {
        const { adapter } = await connectPluginAdapter();
        if (!cancelled) await store.openSession(adapter);
      } catch (e) {
        if (!cancelled) setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedded, store]);

  return (
    <ErrorBoundary>
      {store.segmenter ? (
        <ManualSegmenterView store={store} />
      ) : embedded ? (
        <PluginConnecting error={connectError ?? store.error} />
      ) : (
        <OpenScreen store={store} />
      )}
    </ErrorBoundary>
  );
});

/** Status shown inside the host iframe while connecting / on connect failure. */
function PluginConnecting(props: { error: string | undefined }) {
  return (
    <div
      css={css`
        margin: 2rem auto;
        max-width: 40rem;
        padding: 0 1rem;
        font-family: system-ui, sans-serif;
        line-height: 1.5;
      `}
    >
      {props.error ? (
        <p
          css={css`
            color: #c62828;
          `}
        >
          {props.error}
        </p>
      ) : (
        <p>{t("plugin.connecting", "Connecting to lameta…")}</p>
      )}
    </div>
  );
}
