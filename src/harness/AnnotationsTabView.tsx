import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { AnnotationsPaneView } from "../components/annotations/AnnotationsPaneView";
import { TabControl } from "./TabControl";

/**
 * Harness-only wrapper for the `.eaf` selection: the single tab the plugin's
 * tabProvider claims for a `.eaf` — "Transcription & Translation" — over the
 * real {@link AnnotationsPaneView}. In lameta this is a real host tab hosting
 * its own iframe. The manual segmenter is no longer a separate tab: it is
 * reached in-pane via the grid's "Edit Segments" button (and left via the
 * segmenter's "Back" button), so the tab stays put while the pane switches.
 */
export const AnnotationsTabView = observer(function AnnotationsTabView(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  const store = harness.projectStore;
  return (
    <TabControl
      tabs={[
        {
          id: "transcription-translation",
          label: t("tab.transcriptionTranslation", "Transcription & Translation"),
        },
      ]}
      activeId="transcription-translation"
      onSelect={() => store.showGrid()}
    >
      <AnnotationsPaneView
        store={store}
        onSetupOralAnnotations={() => harness.setupOralAnnotations()}
        // The simulator is a normal-flow page (not a full-height host frame), so
        // bound the grid instead of letting it claim the whole viewport.
        height="60vh"
      />
    </TabControl>
  );
});
