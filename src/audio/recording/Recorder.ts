import { makeAutoObservable } from "mobx";

/**
 * The microphone-capture seam. The real implementation (`MicRecorder`, Track B)
 * wraps getUserMedia → AudioContext → AudioWorklet; this file defines the
 * interface every other track codes against plus a scriptable {@link SpyRecorder}
 * double so the whole recorder state machine is spec-testable headlessly.
 *
 * IMPORTANT: this module must be importable from the node vitest env — it must
 * NOT touch WebAudio (AudioContext, getUserMedia, …) at module load. The real
 * `MicRecorder` confines all such access to method bodies.
 */

/** A selectable capture device (mirrors SayMore's RecordingDeviceIndicator list). */
export interface RecordingDeviceInfo {
  /** Stable device id (MediaDeviceInfo.deviceId); "" for the system default. */
  id: string;
  /** Human-readable device name. */
  label: string;
}

/** The result of one push-to-talk take, at the device's native sample rate. */
export interface RecordingResult {
  /** Mono capture, Float32 in [-1, 1]. */
  samples: Float32Array;
  /** Native capture rate (typically 48000). Written into the per-segment WAV header. */
  sampleRate: number;
  /** Wall-clock length of the take in milliseconds (used by the too-short gate). */
  durationMs: number;
}

/**
 * A hot microphone: opened once when the recorder view mounts and kept live
 * (zero push-to-talk latency, always-live peak meter) until `close()`.
 */
export interface RecorderService {
  /** MobX-observable lifecycle state. */
  readonly state: "idle" | "open" | "recording" | "error";
  /** Live peak level 0..1 (observable, updates while open). */
  readonly level: number;
  /** Human-readable capture device name, if known. */
  readonly deviceLabel: string | undefined;

  /** Acquire the mic + worklet; stays hot until {@link close}. */
  open(): Promise<void>;
  /** Start buffering a take (push-to-talk down). */
  beginRecording(): void;
  /** Stop buffering and return the take (push-to-talk up). */
  stopRecording(): RecordingResult;
  /** Discard the in-progress take without returning it (Esc / capture loss). */
  abortRecording(): void;
  /** Subscribe to device errors (unplug etc.). Returns an unsubscribe fn. */
  onError(cb: (e: Error) => void): () => void;
  /**
   * Enumerate selectable capture devices (SayMore RecordingDeviceIndicator).
   * Optional so implementations can adopt it incrementally (B: MicRecorder);
   * the VM treats absence as "no device switching available".
   */
  listDevices?(): Promise<RecordingDeviceInfo[]>;
  /** Switch capture to `id`, reopening the hot mic; updates {@link deviceLabel}. */
  setDevice?(id: string): Promise<void>;
  /** Release the mic + worklet. */
  close(): void;
}

/**
 * A non-audio, fully scriptable {@link RecorderService} for specs and dev.
 * Tests set the buffer/level the next take returns, trigger device errors and
 * recovery, and assert against the {@link calls} log. Never touches WebAudio, so
 * it runs in the node vitest env.
 */
export class SpyRecorder implements RecorderService {
  state: RecorderService["state"] = "idle";
  level = 0;
  deviceLabel: string | undefined = "Spy Microphone";

  /** Samples returned by the next {@link stopRecording}. */
  nextSamples: Float32Array = new Float32Array(0);
  /** Sample rate reported by takes. */
  sampleRate = 48000;
  /** Duration (ms) the next take reports; when undefined it is derived from the buffer. */
  nextDurationMs: number | undefined = undefined;
  /** When true, the next {@link open} rejects (simulates an unavailable device). */
  failOpen = false;

  /** Scriptable device list returned by {@link listDevices}. */
  devices: RecordingDeviceInfo[] = [
    { id: "", label: "Spy Microphone" },
    { id: "usb", label: "USB Mic" },
  ];
  /** Currently selected device id. */
  currentDeviceId = "";

  /** Ordered log of method invocations, for assertions. */
  readonly calls: string[] = [];

  private readonly errorCbs = new Set<(e: Error) => void>();

  constructor() {
    makeAutoObservable<SpyRecorder, "errorCbs">(this, {
      calls: false,
      errorCbs: false,
    });
  }

  async open(): Promise<void> {
    this.calls.push("open");
    if (this.failOpen) throw new Error("SpyRecorder: device unavailable");
    // A device error persists until recover() is called (recovery polling).
    if (this.state !== "error") this.state = "open";
  }

  beginRecording(): void {
    this.calls.push("beginRecording");
    if (this.state !== "open") {
      throw new Error(`SpyRecorder.beginRecording: not open (state=${this.state})`);
    }
    this.state = "recording";
  }

  stopRecording(): RecordingResult {
    this.calls.push("stopRecording");
    if (this.state !== "recording") {
      throw new Error(`SpyRecorder.stopRecording: not recording (state=${this.state})`);
    }
    this.state = "open";
    const samples = this.nextSamples;
    const durationMs = this.nextDurationMs ?? (samples.length / this.sampleRate) * 1000;
    return { samples, sampleRate: this.sampleRate, durationMs };
  }

  abortRecording(): void {
    this.calls.push("abortRecording");
    if (this.state === "recording") this.state = "open";
  }

  onError(cb: (e: Error) => void): () => void {
    this.errorCbs.add(cb);
    return () => {
      this.errorCbs.delete(cb);
    };
  }

  async listDevices(): Promise<RecordingDeviceInfo[]> {
    this.calls.push("listDevices");
    return this.devices;
  }

  async setDevice(id: string): Promise<void> {
    this.calls.push(`setDevice:${id}`);
    this.currentDeviceId = id;
    const device = this.devices.find((d) => d.id === id);
    if (device) this.deviceLabel = device.label;
    // Reopening the hot mic keeps us "open" (unless the device is gone).
    if (this.state !== "error") this.state = "open";
  }

  close(): void {
    this.calls.push("close");
    this.state = "idle";
    this.level = 0;
  }

  // ── Test scripting ────────────────────────────────────────────────────────
  /**
   * Queue the buffer the next {@link stopRecording} returns. `durationMs`
   * defaults to the buffer length at the current/overridden sample rate — pass
   * it explicitly to exercise the too-short gate independently of buffer size.
   */
  setNextRecording(
    samples: Float32Array,
    opts?: { sampleRate?: number; durationMs?: number },
  ): void {
    this.nextSamples = samples;
    if (opts?.sampleRate != null) this.sampleRate = opts.sampleRate;
    this.nextDurationMs = opts?.durationMs;
  }

  /** Set the observable live peak level (0..1). */
  setLevel(level: number): void {
    this.level = level;
  }

  /** Simulate a device error (unplug): flip to "error" and notify subscribers. */
  emitError(e: Error = new Error("capture device lost")): void {
    this.state = "error";
    this.level = 0;
    for (const cb of this.errorCbs) cb(e);
  }

  /** Simulate device recovery so a subsequent {@link open} can succeed. */
  recover(): void {
    if (this.state === "error") this.state = "idle";
  }
}
