import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import { OfferStore, readOffers, type SearchSnapshot } from "./offer-store";
const result = (live = false) => ({ offers: live ? [{ id: "live", kind: "live" }] : [], hubs: { pairs: [] }, offerPairs: {}, estimates: [], errors: [], tookMs: 1 }) as unknown as HubSearchResult;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("shared browser offer searches", () => {
  it("deduplicates subscribers, retains partial results, and cancels only after the last leaves", async () => {
    let publish!: (value: SearchSnapshot) => void;
    let signal!: AbortSignal;
    const request = vi.fn((_url: string, s: AbortSignal, p: typeof publish) => { signal = s; publish = p; return new Promise<void>(() => {}); });
    const store = new OfferStore(request);
    const one = vi.fn(), two = vi.fn();
    const offOne = store.watch("same", one), offTwo = store.watch("same", two);
    expect(request).toHaveBeenCalledOnce();
    publish({ status: "searching", result: result() });
    expect(one.mock.lastCall?.[0].result).not.toBeNull();
    offOne(); await Promise.resolve(); expect(signal.aborted).toBe(false);
    offTwo(); await Promise.resolve(); expect(signal.aborted).toBe(true);
    expect(store.peek("same")).toBeNull();
  });
  it("reuses completed nonlive results until TTL, but never caches completed live quotes", () => {
    vi.useFakeTimers();
    const request = vi.fn(async (url: string, _signal: AbortSignal, publish: (v: SearchSnapshot) => void) => publish({ status: "done", result: result(url.includes("live")) }));
    const store = new OfferStore(request);
    store.watch("estimate", () => {})(); store.watch("estimate", () => {})();
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    store.watch("estimate", () => {})(); expect(request).toHaveBeenCalledTimes(2);
    store.watch("live", () => {})(); store.watch("live", () => {})(); expect(request).toHaveBeenCalledTimes(4);
  });
  it("retry updates existing subscribers and ignores an obsolete response", async () => {
    const runs: { signal: AbortSignal; publish: (v: SearchSnapshot) => void }[] = [];
    const store = new OfferStore(async (_url, signal, publish) => { runs.push({ signal, publish }); });
    const one = vi.fn(), two = vi.fn();
    const offOne = store.watch("same", one);
    const offTwo = store.watch("same", two, true);
    expect(runs[0].signal.aborted).toBe(true);
    runs[0].publish({ status: "done", result: result() });
    expect(one.mock.lastCall?.[0].status).toBe("searching");
    runs[1].publish({ status: "done", result: result() });
    expect(one.mock.lastCall?.[0].status).toBe("done");
    offOne(); offTwo(); await Promise.resolve();
  });
  it("preserves partial results when a later provider stream fails", async () => {
    const store = new OfferStore(async (_url, _signal, publish) => { publish({ status: "searching", result: result() }); throw new Error("lost"); });
    const updates = vi.fn(); store.watch("partial", updates); await Promise.resolve();
    expect(updates.mock.lastCall?.[0]).toMatchObject({ status: "failed", result: { offers: [] } });
  });
});

describe("progressive offer decoding", () => {
  it("shows the first batch before the final snapshot, including a final line without newline", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { source = c; } }), { headers: { "content-type": "application/x-ndjson" } })));
    const updates = vi.fn();
    const done = readOffers("/fixture", new AbortController().signal, updates);
    await Promise.resolve();
    source.enqueue(new TextEncoder().encode(JSON.stringify({ t: "result", result: result(), done: false }) + "\n"));
    await new Promise((r) => setTimeout(r, 0));
    expect(updates.mock.lastCall?.[0].status).toBe("searching");
    source.enqueue(new TextEncoder().encode(JSON.stringify({ t: "result", result: result(true), done: true })));
    source.close(); await done;
    expect(updates.mock.lastCall?.[0]).toMatchObject({ status: "done", result: { offers: [{ id: "live" }] } });
  });
  it("does not mistake an EOF without the terminal event for a completed search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ t: "result", result: result(), done: false }) + "\n", { headers: { "content-type": "application/x-ndjson" } })));
    await expect(readOffers("/fixture", new AbortController().signal, () => {})).rejects.toThrow("interrupted");
  });
});
