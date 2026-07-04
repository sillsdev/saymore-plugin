import type { ReactNode } from "react";
import Button from "@mui/material/Button";
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
    <Button
      variant="outlined"
      disabled
      title={stubTitle(props.feature)}
      className={props.className}
      sx={{
        textTransform: "none",
        fontFamily: "inherit",
        fontSize: 13,
        py: "3px",
        px: "8px",
        minWidth: 0,
        gap: "4px",
        color: "#37474f",
        background: "#f5f7f8",
        borderColor: "#cfd8dc",
        // Keep the tooltip reachable on hover even though the action is inert.
        "&.Mui-disabled": {
          color: "#37474f",
          opacity: 0.65,
          background: "#f5f7f8",
          pointerEvents: "auto",
          cursor: "not-allowed",
        },
      }}
    >
      {props.children}
    </Button>
  );
}
