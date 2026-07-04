/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { t } from "../l10n";
import type { ProjectStore } from "../state/ProjectStore";
import { StartAnnotatingView } from "../components/shell/StartAnnotatingView";
import { HarnessStore } from "./HarnessStore";
import { FileTree } from "./FileTree";
import { AnnotationsTabView } from "./AnnotationsTabView";

/**
 * Standalone **host simulator**: the root page at http://localhost:5175/. It
 * fakes SayMore/lameta so the real plugin flows can be exercised without the
 * host — a session file tree on top, and below it whichever pane the selected
 * file drives (Start Annotating for the audio, the Annotations grid for the
 * `.eaf`, the real segmenter behind "Segment…"). Only mounted when NOT embedded;
 * the embedded plugin path is untouched.
 */
export const HostSimulator = observer(function HostSimulator(props: { store: ProjectStore }) {
  const { store } = props;
  const [harness] = useState(() => new HarnessStore(store));

  useEffect(() => {
    void harness.init();
  }, [harness]);

  return (
    <div
      css={css`
        max-width: 60rem;
        margin: 1.5rem auto;
        padding: 0 1rem;
        font-family: system-ui, sans-serif;
      `}
    >
      <Header harness={harness} />

      {harness.phase === "needs-folder-reconnect" ? (
        <div css={panelCss}>
          <p>
            {t(
              "harness.reconnectPrompt",
              "This session is a connected disk folder. Reconnect to grant access again.",
            )}
          </p>
          <button
            type="button"
            css={primaryButtonCss}
            onClick={() => void harness.reconnectFolder()}
          >
            {t("harness.reconnect", "Reconnect folder")}
          </button>
        </div>
      ) : harness.phase === "error" ? (
        <p
          css={css`
            color: #c62828;
          `}
        >
          {harness.error}
        </p>
      ) : harness.phase === "init" ? (
        <p>{t("harness.loading", "Loading…")}</p>
      ) : (
        <>
          <FileTree harness={harness} />
          <div
            css={css`
              margin-top: 1rem;
            `}
          >
            <Pane harness={harness} store={store} />
          </div>
        </>
      )}
    </div>
  );
});

const Pane = observer(function Pane(props: { harness: HarnessStore; store: ProjectStore }) {
  const { harness, store } = props;

  if (!harness.selection) {
    return <p css={hintCss}>{t("harness.selectHint", "Select a file above to begin.")}</p>;
  }

  if (harness.selection === "audio") {
    if (harness.hasEaf) {
      return (
        <p css={hintCss}>
          {t(
            "harness.audioAlreadyAnnotated",
            "This audio already has annotations. In the real host it would show no plugin tab — open the Annotations row above.",
          )}
        </p>
      );
    }
    const mediaName = store.startAnnotatingMedia ?? harness.mediaFileName ?? "";
    if (!mediaName || store.loading) return <p css={hintCss}>{t("harness.loading", "Loading…")}</p>;
    return (
      <StartAnnotatingView
        mediaFileName={mediaName}
        onStart={() => harness.runManual()}
        onAutoSegment={(onProgress) => harness.runAuto(onProgress)}
      />
    );
  }

  // selection === "eaf"
  return <AnnotationsTabView harness={harness} />;
});

const Header = observer(function Header(props: { harness: HarnessStore }) {
  const { harness } = props;
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 1rem;
      `}
    >
      <h1
        css={css`
          font-size: 1.15rem;
          margin: 0;
        `}
      >
        {t("harness.title", "SayMore host simulator")}
      </h1>
      <span
        css={css`
          font-size: 12px;
          color: #607d8b;
          border: 1px solid #cfd8dc;
          border-radius: 10px;
          padding: 1px 8px;
        `}
      >
        {harness.source === "folder"
          ? t("harness.sourceFolder", "connected folder")
          : t("harness.sourceSample", "bundled sample")}
      </span>
      <span
        css={css`
          flex: 1;
        `}
      />
      <button
        type="button"
        css={secondaryButtonCss}
        title={t("harness.resetHint", "Drop any created eaf / edits and reseed the sample")}
        onClick={() => void harness.reset()}
      >
        {t("harness.reset", "Reset sample")}
      </button>
      <button type="button" css={secondaryButtonCss} onClick={() => void harness.connectFolder()}>
        {t("harness.connectFolder", "Connect folder…")}
      </button>
    </div>
  );
});

const panelCss = css`
  border: 1px solid #cfd8dc;
  border-radius: 4px;
  padding: 1rem;
  background: #fff;
`;
const hintCss = css`
  color: #78909c;
  font-size: 14px;
`;
const primaryButtonCss = css`
  padding: 6px 14px;
  font-size: 14px;
  color: #fff;
  background: #2e7d32;
  border: 1px solid #2e7d32;
  border-radius: 4px;
  cursor: pointer;
`;
const secondaryButtonCss = css`
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid #90a4ae;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
`;
