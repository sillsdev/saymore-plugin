/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import type { ReactNode } from "react";

export interface TabControlTab {
  /**
   * Matches the TabDescriptor id the plugin's tabProvider claims for the same
   * selection (e.g. "segments", "careful-speech"), exposed as
   * `data-testid="tab-chip-<id>"` for the e2e suite.
   */
  id: string;
  label: string;
}

const BORDER = "1px solid #b7d59b";

/**
 * Harness-only stand-in for lameta's plugin tab control: a row of tab
 * affordances over a bordered panel containing the active tab's content — the
 * active tab merges into the panel (shared background, no bottom border). In
 * lameta these are real host tabs, each hosting its own iframe; the harness
 * fakes them so every per-tab pane stays reachable standalone.
 */
export function TabControl(props: {
  tabs: TabControlTab[];
  activeId: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        css={css`
          display: flex;
          gap: 3px;
          padding-left: 6px;
        `}
      >
        {props.tabs.map((tab) => {
          const active = tab.id === props.activeId;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`tab-chip-${tab.id}`}
              onClick={() => props.onSelect(tab.id)}
              css={css`
                position: relative;
                z-index: ${active ? 1 : 0};
                margin-bottom: -1px; /* the active tab covers the panel's top border */
                padding: 5px 16px;
                border: ${BORDER};
                border-bottom: ${active ? "1px solid #fff" : BORDER};
                border-radius: 4px 4px 0 0;
                background: ${active ? "#fff" : "#eaf3e0"};
                font: inherit;
                font-size: 13px;
                font-weight: ${active ? 600 : 400};
                color: ${active ? "#33691e" : "#607d8b"};
                cursor: ${active ? "default" : "pointer"};
                &:hover {
                  color: #33691e;
                }
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        css={css`
          border: ${BORDER};
          background: #fff;
          padding: 8px;
        `}
      >
        {props.children}
      </div>
    </div>
  );
}
