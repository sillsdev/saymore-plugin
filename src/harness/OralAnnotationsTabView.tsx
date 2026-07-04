/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { ProjectStore } from "../state/ProjectStore";
import { OralAnnotationsViewerView } from "../components/oralAnnotations/OralAnnotationsViewerView";

/**
 * Harness-only wrapper for the OralAnnotations node selection: an "Oral
 * Annotations" tab chip — the same label the plugin's tabProvider claims for
 * `*.oralAnnotations.wav` (`tab.oralAnnotations`, see tabProvider.ts) — over
 * the real {@link OralAnnotationsViewerView}, which lameta embeds directly
 * with no chip. Mirrors AnnotationsTabView's chip pattern.
 */
export const OralAnnotationsTabView = observer(function OralAnnotationsTabView(props: {
  store: ProjectStore;
}) {
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
        {t("tab.oralAnnotations", "Oral Annotations")}
      </div>

      <OralAnnotationsViewerView store={props.store} />
    </div>
  );
});
