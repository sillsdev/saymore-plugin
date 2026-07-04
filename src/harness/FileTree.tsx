/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import type { HarnessStore } from "./HarnessStore";
import type { SessionNode } from "./sessionTree";
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

function selectNode(harness: HarnessStore, kind: SessionNode["kind"]): void {
  if (kind === "audio") void harness.selectAudio();
  else if (kind === "eaf") void harness.selectEaf();
  else void harness.selectOral();
}

/**
 * The simulated SayMore session file list (reference screenshot 1): the media
 * "Audio" row, a nested "Annotations" row once an `.eaf` exists, and an
 * "OralAnnotations" row once the combined WAV exists. Every row is selectable
 * and drives the pane below.
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
        const selected = harness.selection === node.kind;
        return (
          <div
            key={node.kind + node.name}
            role="button"
            onClick={() => selectNode(harness, node.kind)}
            css={css`
              display: flex;
              align-items: center;
              gap: 6px;
              padding: 3px 8px 3px ${8 + node.depth * 20}px;
              cursor: pointer;
              color: #263238;
              background: ${selected ? "#cfe4ff" : "transparent"};
              border-bottom: 1px solid #eceff1;
              &:hover {
                background: ${selected ? "#cfe4ff" : "#f0f4f7"};
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
