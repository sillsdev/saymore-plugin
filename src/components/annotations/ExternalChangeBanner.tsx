/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import Button from "@mui/material/Button";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * Shown when another program changed the annotation file while this pane holds
 * unsaved edits. Nothing is written until the user chooses.
 */
export const ExternalChangeBanner = observer(function ExternalChangeBanner(props: {
  store: ProjectStore;
}) {
  const watcher = props.store.externalChange;
  if (!watcher?.conflict) return null;
  return (
    <div
      role="alert"
      data-testid="external-change-banner"
      css={css`
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: #fff4d6;
        border-bottom: 1px solid #e6c875;
        font-family: ${LAMETA_UI_FONT};
        font-size: 13px;
        color: #4a3b00;
      `}
    >
      <span css={{ flex: 1 }}>
        {t(
          "annotations.externalChange.message",
          "This annotation file was changed by another program, and you have edits that are not saved yet.",
        )}
      </span>
      <Button size="small" variant="contained" onClick={() => void watcher.reload()}>
        {t("annotations.externalChange.reload", "Reload")}
      </Button>
      <Button size="small" variant="outlined" onClick={() => void watcher.keepMine()}>
        {t("annotations.externalChange.keepMine", "Keep mine")}
      </Button>
    </div>
  );
});
