// VENDORED from lameta: src/plugins/client/lametaPluginClient.ts.
//
// The small, dependency-free helper a plugin runs INSIDE its iframe to talk to
// lameta. Adapted only to (a) import PluginApiTypes from the co-located vendored
// copy and (b) avoid `any` so it passes this repo's type-aware lint. Behaviour is
// identical to the canonical source.
//
// Usage:
//   import { connectToLameta } from "./lametaPluginClient";
//   const { context, api } = await connectToLameta();
//
// Your iframe is created fresh for each file and destroyed on file change / tab
// switch (and, in dev, whenever you edit your source). There are no
// "selection changed" events — persist eagerly (debounced) and restore state from
// readSidecar()/companions on connect so hot-reload is loss-free.

import type {
  FfprobeResult,
  PluginGetTabsMessage,
  PluginHostApiV1,
  PluginInitContext,
  PluginProgressMessage,
  PluginResponseMessage,
  TabDescriptor,
  TabProviderQuery,
} from "./PluginApiTypes";

export interface LametaConnection {
  context: PluginInitContext;
  api: PluginHostApiV1;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export function connectToLameta(timeoutMs = 10000): Promise<LametaConnection> {
  return new Promise<LametaConnection>((resolve, reject) => {
    let nextId = 1;
    const pending = new Map<number, PendingEntry>();
    // Per-request progress callbacks (e.g. ffmpeg.run), invoked on `lameta:progress`
    // and dropped when the request's `lameta:response` arrives. Kept client-side only —
    // the callback itself never crosses postMessage.
    const progress = new Map<number, (fraction: number) => void>();

    // Re-announce readiness on an interval until the host answers. A one-shot
    // `lameta:ready` races the host wiring up its listener — a fast file:// iframe
    // can post before the host is ready, the message is dropped, and we time out
    // for nothing. Retrying (host makes init idempotent) closes the race from both
    // sides. Both timers are cleared the instant `lameta:init` arrives.
    let initTimer: ReturnType<typeof setTimeout> | null = null;
    let readyTimer: ReturnType<typeof setInterval> | null = null;
    function stopTimers(): void {
      if (initTimer) {
        clearTimeout(initTimer);
        initTimer = null;
      }
      if (readyTimer) {
        clearInterval(readyTimer);
        readyTimer = null;
      }
    }
    function postReady(): void {
      window.parent.postMessage({ type: "lameta:ready" }, "*");
    }

    initTimer = setTimeout(() => {
      stopTimers();
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for lameta:init from host"));
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      const data = event.data as { type?: string } | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "lameta:init") {
        stopTimers();
        const context = (data as { context: PluginInitContext }).context;
        resolve({ context, api });
        return;
      }

      if (data.type === "lameta:progress") {
        const msg = data as PluginProgressMessage;
        const cb = progress.get(msg.id);
        if (cb && typeof msg.fraction === "number") cb(msg.fraction);
        return;
      }

      if (data.type === "lameta:response") {
        const msg = data as PluginResponseMessage;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        progress.delete(msg.id);
        if (msg.error !== undefined && msg.error !== null) {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve(msg.result);
        }
      }
    }

    // Companion methods travel as dotted strings ("companions.readText", ...), so
    // `method` is a plain string. `transfer` lets writeBytes hand its ArrayBuffer to
    // the host zero-copy (the buffer is unusable in the plugin afterwards).
    function request(
      method: string,
      params: unknown[],
      transfer?: Transferable[],
      onProgress?: (fraction: number) => void,
    ): Promise<unknown> {
      const id = nextId++;
      return new Promise<unknown>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        if (onProgress) progress.set(id, onProgress);
        const message = { type: "lameta:request", id, method, params };
        if (transfer && transfer.length) window.parent.postMessage(message, "*", transfer);
        else window.parent.postMessage(message, "*");
      });
    }

    const api: PluginHostApiV1 = {
      getFileBytes: () => request("getFileBytes", []) as Promise<ArrayBuffer>,
      readFileRange: (offset, length) =>
        request("readFileRange", [offset, length]) as Promise<ArrayBuffer>,
      readSidecar: (name) => request("readSidecar", [name]) as Promise<string | null>,
      writeSidecar: (contents, name) => request("writeSidecar", [contents, name]) as Promise<void>,
      listSidecars: () => request("listSidecars", []) as Promise<string[]>,
      selectFile: (relPath) => request("selectFile", [relPath]) as Promise<void>,
      // Always present; every call errors unless the manifest declares the
      // "companionFiles" permission.
      companions: {
        list: (subdir) =>
          request("companions.list", [subdir]) as Promise<
            { name: string; size: number; mtimeMs: number }[]
          >,
        exists: (relPath) => request("companions.exists", [relPath]) as Promise<boolean>,
        readText: (relPath) => request("companions.readText", [relPath]) as Promise<string>,
        readBytes: (relPath) => request("companions.readBytes", [relPath]) as Promise<ArrayBuffer>,
        writeText: (relPath, contents) =>
          request("companions.writeText", [relPath, contents]) as Promise<void>,
        writeBytes: (relPath, data) =>
          request("companions.writeBytes", [relPath, data], [data]) as Promise<void>,
        rename: (fromRelPath, toRelPath) =>
          request("companions.rename", [fromRelPath, toRelPath]) as Promise<void>,
        delete: (relPath) => request("companions.delete", [relPath]) as Promise<void>,
        stat: (relPath) =>
          request("companions.stat", [relPath]) as Promise<{
            size: number;
            mtimeMs: number;
          } | null>,
      },
      // Always present; every call errors unless the manifest declares the "ffmpeg"
      // permission. `onProgress` is stripped from the wire params and driven by
      // `lameta:progress` messages instead.
      ffmpeg: {
        probe: (relPath) => request("ffmpeg.probe", [relPath]) as Promise<FfprobeResult>,
        run: ({ onProgress, ...spec }) =>
          request("ffmpeg.run", [spec], undefined, onProgress) as Promise<void>,
      },
    };

    // Listener first (synchronous, before any post) so we never miss the host's
    // reply, then announce readiness immediately and keep re-announcing every
    // ~150ms until `lameta:init` lands (stopTimers clears this).
    window.addEventListener("message", onMessage);
    postReady();
    readyTimer = setInterval(postReady, 150);
  });
}

/**
 * Serve the host's tab-provider queries. Call this (once) in the hidden provider instance
 * — i.e. when `connectToLameta()` returned `context.role === "tabProvider"`. The host sends
 * a `lameta:getTabs` on EVERY selection change (uncached); we hand each query to `handler`
 * and post the resulting `TabDescriptor[]` back as `lameta:tabs` (an empty array = no tab).
 *
 * `handler` may be async and should recompute live (e.g. check companion state via the
 * `api` from `connectToLameta`, which the host scopes to the queried file for the duration
 * of the query). A throwing/rejecting handler yields no tabs rather than wedging the strip.
 */
export function serveTabProvider(
  handler: (query: TabProviderQuery) => TabDescriptor[] | Promise<TabDescriptor[]>,
): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!data || typeof data !== "object" || data.type !== "lameta:getTabs") return;
    const msg = data as PluginGetTabsMessage;
    const reply = (tabs: TabDescriptor[]): void =>
      window.parent.postMessage({ type: "lameta:tabs", id: msg.id, tabs }, "*");
    void Promise.resolve()
      .then(() => handler({ file: msg.file, folder: msg.folder }))
      .then(reply)
      .catch(() => reply([]));
  });
}
