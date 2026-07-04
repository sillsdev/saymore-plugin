/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import type { ReactNode } from "react";
import { t } from "../l10n";

/**
 * Host-simulator convention for a control that mirrors a real SayMore feature we
 * haven't built yet: it stays **visible but inert** — disabled, dimmed, and
 * carrying a "Not implemented yet" tooltip — so the simulated UI reads like the
 * real thing without pretending the button works. One helper keeps every stub
 * consistent.
 */
export function stubTitle(feature?: string): string {
  return feature
    ? t("harness.stubNamed", "{feature} — not implemented yet", { feature })
    : t("harness.stub", "Not implemented yet");
}

export function StubButton(props: { children: ReactNode; feature?: string; className?: string }) {
  return (
    <button
      type="button"
      disabled
      title={stubTitle(props.feature)}
      className={props.className}
      css={css`
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        font-size: 13px;
        color: #37474f;
        background: #f5f7f8;
        border: 1px solid #cfd8dc;
        border-radius: 3px;
        cursor: not-allowed;
        opacity: 0.65;
      `}
    >
      {props.children}
    </button>
  );
}
