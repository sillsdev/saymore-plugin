/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { t } from "../../l10n";
import { LAMETA_DARK_GREEN, LAMETA_UI_FONT } from "../../lametaTheme";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";

const METER_HEIGHT_PX = 56;

/** Thin vertical live mic level bar + device label, next to the Speak button. */
export const PeakMeter = observer(function PeakMeter(props: { vm: RecorderViewModel }) {
  const { vm } = props;
  const pct = Math.round(Math.max(0, Math.min(1, vm.micLevel)) * 100);

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-family: ${LAMETA_UI_FONT};
        font-size: 10px;
        color: #607d8b;
      `}
    >
      <div
        role="meter"
        aria-label={t("recorder.micLevel", "Microphone level")}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        css={css`
          position: relative;
          width: 10px;
          height: ${METER_HEIGHT_PX}px;
          background: #eceff1;
          border: 1px solid #cfd8dc;
          border-radius: 3px;
          overflow: hidden;
        `}
      >
        <div
          css={css`
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: ${LAMETA_DARK_GREEN};
          `}
          style={{ height: `${pct}%` }}
        />
      </div>
      <span
        css={css`
          max-width: 76px;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}
        title={vm.deviceLabel}
      >
        {vm.deviceLabel ?? t("recorder.noDevice", "No microphone")}
      </span>
    </div>
  );
});
