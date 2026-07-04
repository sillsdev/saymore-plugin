/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import type { SessionNode } from "./sessionTree";
import { stubTitle } from "../components/shell/stub";
import { LAMETA_UI_FONT } from "../lametaTheme";
import audioIconUrl from "./icons/Audio.png";
import elanIconUrl from "./icons/ELAN.png";

/** lameta's actual file-type icons (copied from the lameta source). */
function nodeIconUrl(kind: SessionNode["kind"]): string {
  switch (kind) {
    case "audio":
    case "oral":
      // Oral annotations are audio recordings → the same microphone icon.
      return audioIconUrl;
    case "eaf":
      return elanIconUrl;
  }
}

/**
 * The simulated SayMore session file list (reference screenshot 1): the media
 * "Audio" row, a nested "Annotations" row once an `.eaf` exists, and an
 * "OralAnnotations" row when per-segment WAVs exist. Clicking a selectable row
 * drives the pane below; the oral row is display-only.
 */
export const FileTree = observer(function FileTree(props: { harness: HarnessStore }) {
  const { harness } = props;
  const { nodes } = harness.tree;

  return (
    <div
      css={css`
        border: 1px solid #cfd8dc;
        border-radius: 4px;
        background: #fff;
        font-family: ${LAMETA_UI_FONT};
        font-size: 13px;
        overflow: hidden;
      `}
    >
      {nodes.map((node) => {
        const selectable = node.kind === "audio" || node.kind === "eaf";
        const selected =
          (node.kind === "audio" && harness.selection === "audio") ||
          (node.kind === "eaf" && harness.selection === "eaf");
        return (
          <div
            key={node.kind + node.name}
            role={selectable ? "button" : undefined}
            title={selectable ? undefined : stubTitle(t("harness.oralRow", "Oral annotations"))}
            onClick={
              selectable
                ? () => void (node.kind === "audio" ? harness.selectAudio() : harness.selectEaf())
                : undefined
            }
            css={css`
              display: flex;
              align-items: center;
              gap: 6px;
              padding: 3px 8px 3px ${8 + node.depth * 20}px;
              cursor: ${selectable ? "pointer" : "default"};
              color: ${selectable ? "#263238" : "#78909c"};
              background: ${selected ? "#cfe4ff" : "transparent"};
              border-bottom: 1px solid #eceff1;
              &:hover {
                background: ${selected ? "#cfe4ff" : selectable ? "#f0f4f7" : "transparent"};
              }
            `}
          >
            <img
              src={nodeIconUrl(node.kind)}
              alt=""
              aria-hidden
              css={css`
                width: 16px;
                height: 16px;
                object-fit: contain;
              `}
            />
            <span
              css={css`
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              `}
            >
              {node.name}
            </span>
            <span
              css={css`
                min-width: 110px;
                color: #607d8b;
              `}
            >
              {node.typeLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
});
