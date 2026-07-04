/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { t } from "../../l10n";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import { DeviceIconGlyph } from "./DeviceIconGlyph";
import { deviceIconKindFor } from "./deviceIcon";

/**
 * The device icon in the mic-meter area: tooltip = the current device label
 * (or "no input device"), icon chosen by {@link deviceIconKindFor}. Clicking
 * it opens an in-app input-device picker (a browser can't launch the OS
 * sound control panel) listing `vm.availableDevices`, current one checked;
 * choosing an entry calls `vm.setDevice(id)`.
 */
export const DeviceIndicator = observer(function DeviceIndicator(props: { vm: RecorderViewModel }) {
  const { vm } = props;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const tooltip = vm.deviceLabel ?? t("recorder.noInputDevice", "no input device");

  function choose(id: string): void {
    setAnchorEl(null);
    void vm.setDevice(id);
  }

  return (
    <>
      <button
        type="button"
        title={tooltip}
        aria-label={tooltip}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          line-height: 1;
        `}
      >
        <DeviceIconGlyph kind={deviceIconKindFor(vm.deviceLabel)} size={14} />
      </button>
      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={() => setAnchorEl(null)}>
        {vm.availableDevices.length === 0 && (
          <MenuItem disabled sx={{ fontSize: 13 }}>
            {t("recorder.noDevicesFound", "No devices found")}
          </MenuItem>
        )}
        {vm.availableDevices.map((device) => (
          <MenuItem
            key={device.id}
            selected={device.label === vm.deviceLabel}
            onClick={() => choose(device.id)}
            sx={{ fontSize: 13 }}
          >
            {device.label === vm.deviceLabel ? "✓ " : ""}
            {device.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
});
