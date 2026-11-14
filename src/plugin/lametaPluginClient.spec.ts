// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectToLameta, READY_RESEND_MS } from "./lametaPluginClient";

type Posted = { type: string; id?: number; method?: string; params?: unknown[] };

function capturePosts() {
  const posted: Posted[] = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as Posted);
  });
  return posted;
}

async function connect(posted: Posted[]) {
  const connecting = connectToLameta(5000);
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "lameta:init", context: { role: "tab" } } }),
  );
  const conn = await connecting;
  posted.length = 0;
  return conn;
}

const lastRequest = (posted: Posted[]) => posted.filter((p) => p.type === "lameta:request").pop()!;

describe("lametaPluginClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("re-posts lameta:ready until init arrives, then stops", async () => {
    vi.useFakeTimers();
    const posted = capturePosts();
    const connecting = connectToLameta(5000);
    vi.advanceTimersByTime(READY_RESEND_MS * 3);
    expect(posted.filter((p) => p.type === "lameta:ready").length).toBe(4);
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "lameta:init", context: { role: "tab" } } }),
    );
    await connecting;
    const before = posted.length;
    vi.advanceTimersByTime(READY_RESEND_MS * 5);
    expect(posted.length).toBe(before);
  });

  it("saveFile sends exactly the bytes a typed array views, as an ArrayBuffer", async () => {
    const posted = capturePosts();
    const { api } = await connect(posted);
    const whole = new Uint8Array([1, 2, 3, 4, 5]);
    api
      .saveFile("a.csv", whole.subarray(1, 4), {
        filters: [{ name: "CSV", extensions: ["csv"] }],
        rememberFolderKey: "LastExportDestinationFolder",
      })
      .catch(() => {});
    const request = lastRequest(posted);
    expect(request.method).toBe("saveFile");
    const [name, bytes, options] = request.params!;
    expect(name).toBe("a.csv");
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(bytes as ArrayBuffer))).toEqual([2, 3, 4]);
    expect(options).toEqual({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      rememberFolderKey: "LastExportDestinationFolder",
    });
    // The plugin's own buffer is copied, not transferred.
    expect(whole.byteLength).toBe(5);
  });

  it("selectFile passes the tab id only when one is given", async () => {
    const posted = capturePosts();
    const { api } = await connect(posted);
    api.selectFile("a.wav").catch(() => {});
    expect(lastRequest(posted).params).toEqual(["a.wav"]);
    api.selectFile("a.wav", { tabId: "start" }).catch(() => {});
    expect(lastRequest(posted).params).toEqual(["a.wav", { tabId: "start" }]);
  });

  it("project settings round-trip through requests and responses", async () => {
    const posted = capturePosts();
    const { api } = await connect(posted);
    const reading = api.getProjectSettings();
    const read = lastRequest(posted);
    expect(read.method).toBe("getProjectSettings");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "lameta:response", id: read.id, result: { version: 1 } },
      }),
    );
    expect(await reading).toEqual({ version: 1 });

    const writing = expect(api.setProjectSettings({ version: 1 })).rejects.toThrow(
      "no project open",
    );
    const write = lastRequest(posted);
    expect(write).toMatchObject({ method: "setProjectSettings", params: [{ version: 1 }] });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "lameta:response", id: write.id, error: "no project open" },
      }),
    );
    await writing;
  });
});
