import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { AnnotationsPaneView } from "../components/annotations/AnnotationsPaneView";
import { TabControl } from "./TabControl";

/**
 * Harness-only wrapper for the `.eaf` selection: the two tabs the plugin's
 * tabProvider claims for a `.eaf` — "Transcription & Translation" (the grid)
 * and "Segments" (the manual segmenter) — over the real
 * {@link AnnotationsPaneView}. In lameta each tab is a real host tab hosting
 * its own iframe; here they just drive `showGrid()` / `showSegmenter()`.
 */
export const AnnotationsTabView = observer(function AnnotationsTabView(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  const store = harness.projectStore;
  const segmentsActive = harness.eafView === "segmenter";
  return (
    <TabControl
      tabs={[
        {
          id: "transcription-translation",
          label: t("tab.transcriptionTranslation", "Transcription & Translation"),
        },
        { id: "segments", label: t("tab.segments", "Segments") },
      ]}
      activeId={segmentsActive ? "segments" : "transcription-translation"}
      onSelect={(id) => (id === "segments" ? store.showSegmenter() : store.showGrid())}
    >
      <AnnotationsPaneView
        store={store}
        onSetupOralAnnotations={() => harness.setupOralAnnotations()}
      />
    </TabControl>
  );
});
