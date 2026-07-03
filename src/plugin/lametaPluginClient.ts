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

import type { PluginHostApiV1, PluginInitContext, PluginResponseMessage } from "./PluginApiTypes";

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

    let initTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for lameta:init from host"));
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      const data = event.data as { type?: string } | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "lameta:init") {
        if (initTimer) {
          clearTimeout(initTimer);
          initTimer = null;
        }
        const context = (data as { context: PluginInitContext }).context;
        resolve({ context, api });
        return;
      }

      if (data.type === "lameta:response") {
        const msg = data as PluginResponseMessage;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
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
    ): Promise<unknown> {
      const id = nextId++;
      return new Promise<unknown>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
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
    };

    window.addEventListener("message", onMessage);
    // Tell the host we're loaded and ready for lameta:init.
    window.parent.postMessage({ type: "lameta:ready" }, "*");
  });
}
