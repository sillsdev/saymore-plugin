/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectStore } from "./state/ProjectStore";
import { OpenScreen } from "./components/shell/OpenScreen";
import { StartAnnotatingView } from "./components/shell/StartAnnotatingView";
import { ManualSegmenterView } from "./components/segmenter/ManualSegmenterView";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import {
  buildPluginConnection,
  isEmbeddedInHost,
  type PluginConnection,
} from "./plugin/connectPlugin";
import { connectToLameta, serveTabProvider } from "./plugin/lametaPluginClient";
import { resolveSaymoreTabs } from "./plugin/tabProvider";
import { annotationsEafName } from "./fs/SessionFolder";
import { createEafFromTemplate, serializeEaf } from "./model/eaf/EafDocument";
import { eafTemplateXml } from "./model/eaf/eafTemplate";
import { autoSegmentToEaf } from "./audio/autoSegmentToEaf";
import { t } from "./l10n";

/**
 * Shell. Three entry paths, one entry HTML:
 *  - Embedded as the hidden **tab provider** (role "tabProvider"): answer the host's
 *    `getTabs` queries (which tabs SayMore claims for the selected file) and render nothing.
 *  - Embedded as a **content tab** (role "tab"): wrap the host file API in a PluginHostAdapter
 *    and either show State A (Start Annotating) for an audio file with no `.eaf`, or open the
 *    session's segmenter (an `.eaf` selection, State B).
 *  - Standalone dev harness (`vp dev`): show the OpenScreen (folder / drop a file).
 */
export const App = observer(function App() {
  const [store] = useState(() => new ProjectStore());
  const embedded = useMemo(() => isEmbeddedInHost(), []);
  const [connectError, setConnectError] = useState<string | undefined>(undefined);
  // True in the hidden tab-provider instance → render nothing (it just answers getTabs).
  const [providerMode, setProviderMode] = useState(false);
  // Set when the selected Audio file has no `.eaf` yet → show State A (Start Annotating).
  const [startMediaName, setStartMediaName] = useState<string | undefined>(undefined);
  const connRef = useRef<PluginConnection | undefined>(undefined);

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    void (async () => {
      try {
        const { context, api } = await connectToLameta();
        if (cancelled) return;

        // Hidden provider instance: serve tab queries live (query-per-selection, uncached);
        // its `companions.*` are scoped by the host to each queried file.
        if (context.role === "tabProvider") {
          setProviderMode(true);
          serveTabProvider((query) => resolveSaymoreTabs(query, api.companions));
          return;
        }

        // Content tab.
        const conn = buildPluginConnection(context, api);
        connRef.current = conn;

        // An `.eaf` selection opens the segmenter (State B). An Audio file only ever reaches
        // here with no `.eaf` (the provider hides our tab once one exists), but we re-check
        // defensively — and to never overwrite an existing `.eaf`.
        if (conn.extension !== "eaf") {
          const hasEaf = await conn.adapter.exists(annotationsEafName(conn.selectedFileName));
          if (cancelled) return;
          if (!hasEaf) {
            setStartMediaName(conn.selectedFileName);
            return;
          }
        }
        await store.openSession(conn.adapter);
      } catch (e) {
        if (!cancelled) setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedded, store]);

  // State A button: create the SayMore-compatible `<media>.annotations.eaf` (seeded from
  // the annotation template) beside the media, then reveal the segmenter. Preferred path
  // (B): ask the host to select the new `.eaf` — it rescans, selects it, and recreates this
  // iframe on the "Segments" tab (so the code after `selectFile` never runs). Fallback (A):
  // on a host without `selectFile`, reveal the segmenter inline on this tab.
  async function handleStartAnnotating(): Promise<void> {
    const conn = connRef.current;
    if (!conn) throw new Error("Not connected to lameta.");
    const eafRel = annotationsEafName(conn.selectedFileName);
    // Never clobber an existing `.eaf` (guards a race where one appeared since load): only
    // seed a fresh template when none exists.
    if (!(await conn.adapter.exists(eafRel))) {
      const xml = serializeEaf(createEafFromTemplate(eafTemplateXml, conn.selectedFileName));
      await conn.adapter.writeText(eafRel, xml);
    }
    try {
      await conn.api.selectFile(eafRel);
    } catch {
      setStartMediaName(undefined);
      await store.openSession(conn.adapter);
    }
  }

  // State A button: run the auto-segmenter over the audio and write the segments into a
  // SayMore-compatible `<media>.annotations.eaf` BEFORE revealing the segmenter. The eaf
  // must be complete before `selectFile` because that recreates the iframe on the
  // "Segments" tab (code after it never runs). Fallback (host without `selectFile`): open
  // the segmenter inline on this tab, reading back the eaf we just wrote.
  async function handleAutoSegment(onProgress: (fraction: number) => void): Promise<void> {
    const conn = connRef.current;
    if (!conn) throw new Error("Not connected to lameta.");
    const { eafRel } = await autoSegmentToEaf({
      adapter: conn.adapter,
      mediaFileName: conn.selectedFileName,
      onProgress,
    });
    try {
      await conn.api.selectFile(eafRel);
    } catch {
      setStartMediaName(undefined);
      await store.openSession(conn.adapter);
    }
  }

  // The hidden provider instance has no UI — it only answers getTabs.
  if (providerMode) return null;

  return (
    <ErrorBoundary>
      {store.segmenter ? (
        <ManualSegmenterView store={store} />
      ) : startMediaName ? (
        <StartAnnotatingView
          mediaFileName={startMediaName}
          onStart={handleStartAnnotating}
          onAutoSegment={handleAutoSegment}
        />
      ) : store.startAnnotatingMedia ? (
        <StartAnnotatingView
          mediaFileName={store.startAnnotatingMedia}
          onStart={() => store.startAnnotatingManual()}
          onAutoSegment={(onProgress) => store.autoSegment(onProgress)}
        />
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
