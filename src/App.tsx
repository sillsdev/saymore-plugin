/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectStore } from "./state/ProjectStore";
import { OpenScreen } from "./components/shell/OpenScreen";
import { StartAnnotatingView } from "./components/shell/StartAnnotatingView";
import { FileConversionView } from "./components/shell/FileConversionView";
import { ManualSegmenterView } from "./components/segmenter/ManualSegmenterView";
import { AnnotationsPaneView } from "./components/annotations/AnnotationsPaneView";
import { OralAnnotationsViewerView } from "./components/oralAnnotations/OralAnnotationsViewerView";
import { RecorderView } from "./components/recorder/RecorderView";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { LAMETA_UI_FONT } from "./lametaTheme";
import {
  buildPluginConnection,
  isEmbeddedInHost,
  type PluginConnection,
} from "./plugin/connectPlugin";
import { connectToLameta, serveTabProvider } from "./plugin/lametaPluginClient";
import { resolveSaymoreTabs } from "./plugin/tabProvider";
import { annotationsEafName, standardAudioName } from "./fs/SessionFolder";
import { STANDARD_AUDIO_FFMPEG_ARGS } from "./model/SayMoreConstants";
import { createEafFromTemplate, serializeEaf } from "./model/eaf/EafDocument";
import { eafTemplateXml } from "./model/eaf/eafTemplate";
import { autoSegmentToEaf } from "./audio/autoSegmentToEaf";
import { HostSimulator } from "./harness/HostSimulator";
import { wantsOpenScreen } from "./harness/harnessRouter";
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
  // Set when a non-WAV media file was selected with no annotations yet → offer file
  // conversion first (produce `<base>_StandardAudio.wav`, then reselect it).
  const [convertMediaName, setConvertMediaName] = useState<string | undefined>(undefined);
  // Set when this instance is a dedicated recorder tab on a `.oralAnnotations.wav`
  // selection ("careful-speech" / "oral-translation") → render RecorderView alone,
  // with no grid to exit back to.
  const [oralRecorderTab, setOralRecorderTab] = useState(false);
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

        // A media selection only ever reaches here with no `.eaf` (the provider hides
        // our tab once one exists), but we re-check defensively — and to never
        // overwrite an existing `.eaf`. `.eaf` and `.oralAnnotations.wav` selections
        // always open the session (their tab only exists once the eaf does).
        if (conn.selectionKind === "media") {
          const hasEaf = await conn.adapter.exists(annotationsEafName(conn.selectedFileName));
          if (cancelled) return;
          if (!hasEaf) {
            if (conn.extension === "wav") {
              setStartMediaName(conn.selectedFileName);
              return;
            }
            // Non-WAV media: SayMore annotates a standard WAV copy. If we already made one,
            // reselect it and let its own tab flow take over; otherwise offer conversion.
            const wavName = standardAudioName(conn.selectedFileName);
            const wavExists = await conn.adapter.exists(wavName);
            if (cancelled) return;
            if (wavExists) {
              try {
                await conn.api.selectFile(wavName);
                return;
              } catch {
                /* host without selectFile: fall through to the conversion offer */
              }
            }
            setConvertMediaName(conn.selectedFileName);
            return;
          }
        }
        await store.openSession(conn.adapter);
        if (cancelled) return;
        // Route the pane by which provider-claimed tab this iframe is (see
        // tabProvider.ts). A missing tabId (pre-provider host) gets each
        // selection's default: the viewer / the grid.
        if (conn.selectionKind === "oralAnnotations") {
          if (conn.tabId === "careful-speech" || conn.tabId === "oral-translation") {
            setOralRecorderTab(true);
            store.openRecorder(conn.tabId === "careful-speech" ? "Careful" : "Translation");
          } else {
            store.openOralAnnotationsViewer();
          }
        } else if (conn.selectionKind === "eaf" && conn.tabId === "segments") {
          store.showSegmenter();
        }
      } catch (e) {
        if (!cancelled) setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedded, store]);

  // State A button: create the SayMore-compatible `<media>.annotations.eaf` (seeded from
  // the annotation template) beside the media, then reveal the annotations UI. Preferred
  // path (B): ask the host to select the new `.eaf` — it rescans, selects it, and recreates
  // this iframe on the eaf's default "Transcription & Translation" tab (so the code after
  // `selectFile` never runs). Fallback (A): on a host without `selectFile`, reveal it
  // inline on this tab.
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
      // Mirror the provider's empty-eaf default: manual segmentation starts in
      // the segmenter (with `selectFile` the host lands on the Segments tab).
      store.showSegmenter();
    }
  }

  // File-conversion screen "Convert": ask the host to run ffmpeg over the selected
  // non-WAV media, producing `<base>_StandardAudio.wav` beside it (progress 0→1 drives the
  // bar), then reselect that WAV so the host recreates this iframe on it and the normal
  // Start Annotating (auto/manual) flow runs. A host without `selectFile` surfaces the
  // rejection as an error in the conversion view.
  async function handleConvert(onProgress: (fraction: number) => void): Promise<void> {
    const conn = connRef.current;
    if (!conn) throw new Error("Not connected to lameta.");
    const wavName = standardAudioName(conn.selectedFileName);
    await conn.api.ffmpeg.run({
      outputRelPath: wavName,
      args: STANDARD_AUDIO_FFMPEG_ARGS,
      onProgress,
    });
    await conn.api.selectFile(wavName);
  }

  // Grid toolbar "Setup Oral Annotation": create the combined
  // `<media>.oralAnnotations.wav` (source-only until recordings exist), then ask
  // the host to select it — its Careful Speech / Oral Translation / Combined
  // Audio tabs appear and the default (Careful Speech) opens. On a host without
  // `selectFile` the button simply disappears (the file now exists); the user
  // selects it in lameta's file list.
  async function handleSetupOralAnnotations(): Promise<void> {
    const conn = connRef.current;
    if (!conn) throw new Error("Not connected to lameta.");
    const combinedRel = await store.setupOralAnnotations();
    try {
      await conn.api.selectFile(combinedRel);
    } catch {
      /* feature-detect fallback: stay on the grid */
    }
  }

  // State A button: run the auto-segmenter over the audio and write the segments into a
  // SayMore-compatible `<media>.annotations.eaf` BEFORE revealing the annotations UI. The
  // eaf must be complete before `selectFile` because that recreates the iframe on the
  // eaf's default tab (code after it never runs). Fallback (host without `selectFile`):
  // open the annotations UI inline on this tab, reading back the eaf we just wrote.
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

  // Embedded plugin path: a dedicated recorder tab (Careful Speech / Oral
  // Translation), the Combined Audio viewer, the Annotations pane (grid or
  // segmenter per tab), State A, or a connecting notice.
  if (embedded) {
    return (
      <ErrorBoundary>
        {oralRecorderTab ? (
          store.recorder ? (
            <RecorderView store={store} />
          ) : (
            <PluginConnecting error={connectError ?? store.error} />
          )
        ) : store.oralViewer ? (
          <OralAnnotationsViewerView store={store} />
        ) : store.segmenter ? (
          <AnnotationsPaneView store={store} onSetupOralAnnotations={handleSetupOralAnnotations} />
        ) : convertMediaName ? (
          <FileConversionView
            sourceName={convertMediaName}
            outputName={standardAudioName(convertMediaName)}
            onConvert={handleConvert}
          />
        ) : startMediaName ? (
          <StartAnnotatingView onStart={handleStartAnnotating} onAutoSegment={handleAutoSegment} />
        ) : (
          <PluginConnecting error={connectError ?? store.error} />
        )}
      </ErrorBoundary>
    );
  }

  // Standalone: the host simulator is the root page. The legacy OpenScreen flow
  // stays reachable at `?open` (drop/pick a single file → the same store views).
  if (wantsOpenScreen()) {
    return (
      <ErrorBoundary>
        {store.segmenter ? (
          <ManualSegmenterView store={store} />
        ) : store.startAnnotatingMedia ? (
          <StartAnnotatingView
            onStart={() => store.startAnnotatingManual()}
            onAutoSegment={(onProgress) => store.autoSegment(onProgress)}
          />
        ) : (
          <OpenScreen store={store} />
        )}
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <HostSimulator store={store} />
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
        font-family: ${LAMETA_UI_FONT};
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
