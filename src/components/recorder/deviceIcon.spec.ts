import { describe, it, expect } from "vitest";
import { deviceIconKindFor } from "./deviceIcon";

describe("deviceIconKindFor", () => {
  it("is no-device for an undefined or empty label", () => {
    expect(deviceIconKindFor(undefined)).toBe("no-device");
    expect(deviceIconKindFor("")).toBe("no-device");
  });

  it("matches each rule case-insensitively, by substring", () => {
    expect(deviceIconKindFor("Logitech Webcam C920")).toBe("webcam");
    expect(deviceIconKindFor("Internal Microphone")).toBe("computer");
    expect(deviceIconKindFor("Plantronics BT600")).toBe("headset");
    expect(deviceIconKindFor("Andrea PureAudio USB-SA")).toBe("headset");
    expect(deviceIconKindFor("VXi X200 Headset")).toBe("headset");
    expect(deviceIconKindFor("USB Audio Device")).toBe("usb");
    expect(deviceIconKindFor("Microphone (Realtek Audio)")).toBe("mic");
    expect(deviceIconKindFor("Line In (Realtek Audio)")).toBe("line-in");
    expect(deviceIconKindFor("ZOOM H2n")).toBe("recorder");
  });

  it("is case-insensitive", () => {
    expect(deviceIconKindFor("HEADSET pro")).toBe("headset");
    expect(deviceIconKindFor("zoom h4n")).toBe("recorder");
  });

  it("falls back to mic when nothing matches", () => {
    expect(deviceIconKindFor("Mystery Audio Adapter")).toBe("mic");
  });

  it("resolves priority order when a label could match more than one rule", () => {
    // "Headset" is listed before "usb audio device" and "microphone" in the
    // priority order — a label matching both should pick Headset.
    expect(deviceIconKindFor("USB Audio Device Headset Microphone")).toBe("headset");
  });
});
