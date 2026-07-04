/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { AnnotationsPaneView } from "../components/annotations/AnnotationsPaneView";

/**
 * Harness-only wrapper for the `.eaf` selection: the "Annotations" tab chip
 * (reference screenshot 2) over the real {@link AnnotationsPaneView}, which
 * lameta embeds directly with no chip. Owns nothing but the chip and the
 * harness↔URL view round-trip — everything else lives in the plugin-owned pane.
 */
export const AnnotationsTabView = observer(function AnnotationsTabView(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  return (
    <div>
      <div
        css={css`
          display: inline-block;
          padding: 4px 14px;
          border: 1px solid #b7d59b;
          border-bottom: none;
          border-radius: 4px 4px 0 0;
          background: #eaf3e0;
          font-size: 13px;
          font-weight: 600;
          color: #33691e;
        `}
      >
        {t("annotations.tab", "Annotations")}
      </div>

      <AnnotationsPaneView store={harness.projectStore} />
    </div>
  );
});
