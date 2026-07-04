import { makeAutoObservable, runInAction } from "mobx";
import type { RecorderService, RecordingDeviceInfo, RecordingResult } from "./Recorder";
import { RECORDER_WORKLET_NAME } from "./recorderWorkletName";

/** Minimum interval between live `level` updates (main-thread render pressure). */
const LEVEL_THROTTLE_MS = 50;

interface RecorderWorkletMessage {
  samples: Float32Array;
  peak: number;
}

function getAudioContextCtor(): (new () => AudioContext) | undefined {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

/**
 * Real {@link RecorderService}: `getUserMedia` → `AudioContext` →
 * {@link "./recorderWorklet"}. HOT-MIC design (plan): the stream and worklet
 * open once in {@link open} and stay running until {@link close} — zero
 * push-to-talk latency, always-live peak meter. `beginRecording`/
 * `stopRecording` just mark/collect the frames the worklet is already posting.
 *
 * Deliberately thin: no policy (too-short discard, listen-gating, etc.) lives
 * here — that's `RecorderViewModel`'s job. All WebAudio/DOM access is confined
 * to method bodies so importing this module is safe outside a browser.
 */
export class MicRecorder implements RecorderService {
  state: RecorderService["state"] = "idle";
  level = 0;
  deviceLabel: string | undefined = undefined;

  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  private recording = false;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;

  /** "" = system default; set by {@link setDevice}, applied on the next (re)open. */
  private currentDeviceId = "";

  private lastLevelUpdateMs = 0;
  private peakSinceLastUpdate = 0;

  private readonly errorCbs = new Set<(e: Error) => void>();

  constructor() {
    makeAutoObservable<
      MicRecorder,
      | "stream"
      | "track"
      | "audioContext"
      | "sourceNode"
      | "workletNode"
      | "recording"
      | "chunks"
      | "totalSamples"
      | "currentDeviceId"
      | "lastLevelUpdateMs"
      | "peakSinceLastUpdate"
      | "errorCbs"
      | "onTrackEnded"
      | "onDeviceChange"
      | "handleWorkletMessage"
    >(this, {
      stream: false,
      track: false,
      audioContext: false,
      sourceNode: false,
      workletNode: false,
      recording: false,
      chunks: false,
      totalSamples: false,
      currentDeviceId: false,
      lastLevelUpdateMs: false,
      peakSinceLastUpdate: false,
      errorCbs: false,
      onTrackEnded: false,
      onDeviceChange: false,
      handleWorkletMessage: false,
    });
  }

  async open(): Promise<void> {
    if (this.state === "open" || this.state === "recording") return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: this.currentDeviceId ? { deviceId: { exact: this.currentDeviceId } } : true,
      });
      this.track = this.stream.getAudioTracks()[0] ?? null;
      this.track?.addEventListener("ended", this.onTrackEnded);
      navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);

      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) {
        throw new Error("MicRecorder.open requires a browser AudioContext.");
      }
      this.audioContext = new AudioContextCtor();
      await this.audioContext.audioWorklet.addModule(
        new URL("./recorderWorklet.js", import.meta.url),
      );
      this.workletNode = new AudioWorkletNode(this.audioContext, RECORDER_WORKLET_NAME);
      this.workletNode.port.onmessage = (event: MessageEvent<RecorderWorkletMessage>) => {
        this.handleWorkletMessage(event.data);
      };
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      // Feeds the worklet only — never connected to destination (no monitoring echo).
      this.sourceNode.connect(this.workletNode);

      runInAction(() => {
        this.deviceLabel = this.track?.label || undefined;
        this.state = "open";
      });
    } catch (e) {
      // Release whatever was acquired before the failure (stream, listeners,
      // audio context) so a retried open() doesn't pile up leaked resources.
      this.close();
      throw e;
    }
  }

  private handleWorkletMessage(message: RecorderWorkletMessage): void {
    if (this.recording) {
      this.chunks.push(message.samples);
      this.totalSamples += message.samples.length;
    }

    if (message.peak > this.peakSinceLastUpdate) this.peakSinceLastUpdate = message.peak;
    const now = performance.now();
    if (now - this.lastLevelUpdateMs >= LEVEL_THROTTLE_MS) {
      this.lastLevelUpdateMs = now;
      const peak = this.peakSinceLastUpdate;
      this.peakSinceLastUpdate = 0;
      runInAction(() => {
        this.level = peak;
      });
    }
  }

  beginRecording(): void {
    if (this.state !== "open") {
      throw new Error(`MicRecorder.beginRecording: not open (state=${this.state})`);
    }
    this.chunks = [];
    this.totalSamples = 0;
    this.recording = true;
    this.state = "recording";
  }

  stopRecording(): RecordingResult {
    if (this.state !== "recording") {
      throw new Error(`MicRecorder.stopRecording: not recording (state=${this.state})`);
    }
    this.recording = false;
    this.state = "open";

    const samples = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.totalSamples = 0;

    const sampleRate = this.audioContext?.sampleRate ?? 48000;
    const durationMs = (samples.length / sampleRate) * 1000;
    return { samples, sampleRate, durationMs };
  }

  abortRecording(): void {
    this.recording = false;
    this.chunks = [];
    this.totalSamples = 0;
    if (this.state === "recording") this.state = "open";
  }

  onError(cb: (e: Error) => void): () => void {
    this.errorCbs.add(cb);
    return () => {
      this.errorCbs.delete(cb);
    };
  }

  /**
   * Enumerate capture devices (SayMore's RecordingDeviceIndicator). Always
   * live-queried, never cached — calling this again after a
   * `navigator.mediaDevices.ondevicechange` event naturally reflects the
   * change, so there's no separate "refresh" step. Labels are populated once
   * mic permission has been granted (i.e. after {@link open} has succeeded at
   * least once).
   */
  async listDevices(): Promise<RecordingDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ id: d.deviceId, label: d.label || "Microphone" }));
  }

  /**
   * Switch capture to `id` ("" = system default). If the mic isn't currently
   * open, just remembers the choice for the next {@link open}. Otherwise tears
   * down and reopens the hot mic on the new device (any in-progress take is
   * discarded, same as {@link abortRecording} — you can't carry samples across
   * a device swap), preserving the open/error handling {@link open} already does.
   */
  async setDevice(id: string): Promise<void> {
    this.currentDeviceId = id;
    if (this.state === "idle") return;
    this.close();
    await this.open();
  }

  close(): void {
    this.track?.removeEventListener("ended", this.onTrackEnded);
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange);
    }
    this.sourceNode?.disconnect();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
    }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.audioContext?.close();

    this.stream = null;
    this.track = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.recording = false;
    this.chunks = [];
    this.totalSamples = 0;

    runInAction(() => {
      this.state = "idle";
      this.level = 0;
      this.deviceLabel = undefined;
    });
  }

  /** `track.onended`: the capture device was unplugged/removed. */
  private readonly onTrackEnded = (): void => {
    this.emitError(new Error("Recording device disconnected."));
  };

  /** `navigator.mediaDevices.ondevicechange`: re-check our track is still live. */
  private readonly onDeviceChange = (): void => {
    if (this.track && this.track.readyState !== "live") {
      this.emitError(new Error("Recording device disconnected."));
    }
  };

  private emitError(e: Error): void {
    runInAction(() => {
      this.state = "error";
      this.level = 0;
    });
    for (const cb of this.errorCbs) cb(e);
  }
}
