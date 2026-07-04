/**
 * Which icon the device indicator shows for a capture device's label —
 * SayMore parity (libpalaso `RecordingDeviceIndicator`): case-insensitive
 * SUBSTRING match against the label, first rule in priority order wins, pure
 * so it's unit-testable without any DOM/audio dependency.
 */
export type DeviceIconKind =
  | "no-device"
  | "webcam"
  | "computer"
  | "headset"
  | "usb"
  | "mic"
  | "line-in"
  | "recorder";

interface Rule {
  kind: DeviceIconKind;
  match(lowerLabel: string): boolean;
}

/** Priority order matters — e.g. a label matching both Headset and USB rules picks Headset. */
const RULES: readonly Rule[] = [
  { kind: "webcam", match: (l) => l.includes("webcam") },
  { kind: "computer", match: (l) => l.includes("internal") },
  {
    kind: "headset",
    match: (l) =>
      l.includes("headset") ||
      l.includes("plantronics") ||
      l.includes("andrea") ||
      l.includes("vxi x200"),
  },
  { kind: "usb", match: (l) => l.includes("usb audio device") },
  { kind: "mic", match: (l) => l.includes("microphone") },
  { kind: "line-in", match: (l) => l.includes("line") },
  { kind: "recorder", match: (l) => l.includes("zoom") },
];

/** `undefined`/empty label (no input device) -> "no-device"; no rule matches -> "mic" fallback. */
export function deviceIconKindFor(label: string | undefined): DeviceIconKind {
  if (!label) return "no-device";
  const lower = label.toLowerCase();
  for (const rule of RULES) {
    if (rule.match(lower)) return rule.kind;
  }
  return "mic";
}
