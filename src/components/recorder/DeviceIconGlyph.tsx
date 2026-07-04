/** @jsxImportSource @emotion/react */
import type { DeviceIconKind } from "./deviceIcon";

const COLOR = "#607d8b";

/**
 * Small inline-SVG glyph per {@link DeviceIconKind} (coordinator-approved
 * fallback — SayMore's own libpalaso PNGs weren't fetchable here). Simple
 * silhouettes at icon size (~14px); the important part is `deviceIcon.ts`'s
 * label->kind mapping, which is pure and spec'd.
 *
 * Named distinctly from `deviceIcon.ts` (not `DeviceIcon.tsx`) — Windows'
 * case-insensitive filesystem treats those as the same path and confuses the
 * TS module resolver into a phantom duplicate file identity.
 */
export function DeviceIconGlyph(props: { kind: DeviceIconKind; size?: number }) {
  const size = props.size ?? 14;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {renderGlyph(props.kind)}
    </svg>
  );
}

function renderGlyph(kind: DeviceIconKind) {
  switch (kind) {
    case "no-device":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={COLOR} strokeWidth="1.3" />
          <line x1="3" y1="11" x2="11" y2="3" stroke={COLOR} strokeWidth="1.3" />
        </>
      );
    case "webcam":
      return (
        <>
          <circle cx="7" cy="6" r="4.5" fill="none" stroke={COLOR} strokeWidth="1.3" />
          <circle cx="7" cy="6" r="1.6" fill={COLOR} />
          <rect x="4" y="11" width="6" height="1.4" rx="0.7" fill={COLOR} />
        </>
      );
    case "computer":
      return (
        <>
          <rect
            x="1.5"
            y="2"
            width="11"
            height="7"
            rx="1"
            fill="none"
            stroke={COLOR}
            strokeWidth="1.2"
          />
          <rect x="5" y="10.5" width="4" height="1.3" fill={COLOR} />
        </>
      );
    case "headset":
      return (
        <>
          <path d="M3 8 V6 a4 4 0 0 1 8 0 V8" fill="none" stroke={COLOR} strokeWidth="1.3" />
          <rect x="1.8" y="7.5" width="2.2" height="3.5" rx="1" fill={COLOR} />
          <rect x="10" y="7.5" width="2.2" height="3.5" rx="1" fill={COLOR} />
        </>
      );
    case "usb":
      return (
        <>
          <rect
            x="4.5"
            y="3"
            width="5"
            height="7"
            rx="0.8"
            fill="none"
            stroke={COLOR}
            strokeWidth="1.2"
          />
          <line x1="6.2" y1="3" x2="6.2" y2="1.2" stroke={COLOR} strokeWidth="1.2" />
          <line x1="7.8" y1="3" x2="7.8" y2="1.2" stroke={COLOR} strokeWidth="1.2" />
          <line x1="7" y1="10" x2="7" y2="12.5" stroke={COLOR} strokeWidth="1.2" />
        </>
      );
    case "line-in":
      return (
        <>
          <circle cx="7" cy="6" r="3.2" fill="none" stroke={COLOR} strokeWidth="1.2" />
          <line x1="7" y1="9.2" x2="7" y2="12.5" stroke={COLOR} strokeWidth="1.2" />
        </>
      );
    case "recorder":
      return (
        <>
          <rect
            x="1.5"
            y="3"
            width="11"
            height="8"
            rx="1.5"
            fill="none"
            stroke={COLOR}
            strokeWidth="1.2"
          />
          <circle cx="7" cy="7" r="2" fill="#c62828" />
        </>
      );
    case "mic":
    default:
      return (
        <>
          <rect
            x="5"
            y="1.5"
            width="4"
            height="7"
            rx="2"
            fill="none"
            stroke={COLOR}
            strokeWidth="1.2"
          />
          <path d="M3 7.5 a4 4 0 0 0 8 0" fill="none" stroke={COLOR} strokeWidth="1.2" />
          <line x1="7" y1="11.5" x2="7" y2="12.8" stroke={COLOR} strokeWidth="1.2" />
        </>
      );
  }
}
