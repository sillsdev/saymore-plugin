/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore, OralTab } from "./HarnessStore";
import { OralAnnotationsViewerView } from "../components/oralAnnotations/OralAnnotationsViewerView";
import { RecorderView } from "../components/recorder/RecorderView";
import { TabControl } from "./TabControl";

/**
 * Harness-only wrapper for the OralAnnotations node selection: the three tabs
 * the plugin's tabProvider claims for a `*.oralAnnotations.wav` —
 * "Careful Speech" / "Oral Translation" (the recorders, hot-mic) and
 * "Combined Audio" (the 3-channel viewer) — over the matching real view. In
 * lameta each tab is a real host tab hosting its own iframe; here they drive
 * {@link HarnessStore.setOralTab}. The tabs are the recorders' only
 * navigation (no in-pane exit); the viewer's staleness check owns combined-WAV
 * regeneration.
 */
export const OralAnnotationsTabView = observer(function OralAnnotationsTabView(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  const store = harness.projectStore;
  const idByTab: Record<OralTab, string> = {
    careful: "careful-speech",
    translation: "oral-translation",
    combined: "combined-audio",
  };
  return (
    <TabControl
      tabs={[
        { id: "careful-speech", label: t("tab.carefulSpeech", "Careful Speech") },
        { id: "oral-translation", label: t("tab.oralTranslation", "Oral Translation") },
        { id: "combined-audio", label: t("tab.combinedAudio", "Combined Audio") },
      ]}
      activeId={idByTab[harness.oralTab]}
      onSelect={(id) =>
        harness.setOralTab(
          id === "careful-speech"
            ? "careful"
            : id === "oral-translation"
              ? "translation"
              : "combined",
        )
      }
    >
      {store.oralViewer ? (
        <OralAnnotationsViewerView store={store} />
      ) : store.recorder ? (
        <RecorderView store={store} />
      ) : (
        <p
          css={css`
            padding: 12px;
            color: #78909c;
          `}
        >
          {t("harness.loading", "Loading…")}
        </p>
      )}
    </TabControl>
  );
});
