import { describe, expect, it, vi } from "vitest";
import { createSearchCache, searchKey } from "./search-cache";
import type { SearchQuery } from "./types";

const q: SearchQuery = {
  from: { name: "Hong Kong", lat: 22.3, lng: 114.17 },
  to: { name: "Shanghai", lat: 31.2, lng: 121.3 },
  date: "2026-10-10", modes: ["train", "flight"], passengers: 1, currency: "USD",
};

function setup(errors: unknown[] = []) {
  let t = 0;
  const run = vi.fn(async () => ({ offers: [], errors }));
  const cache = createSearchCache(run, { ttlMs: 1000, errorTtlMs: 100, max: 2, now: () => t });
  return { run, cache, tick: (ms: number) => { t += ms } };
}
const signal = () => new AbortController().signal;

describe("search cache", () => {
  it("ignores display names and mode order", () => {
    expect(searchKey({ ...q, from: { ...q.from, name: "HK" }, modes: ["flight", "train"] })).toBe(searchKey(q));
    expect(searchKey({ ...q, date: "2026-10-11" })).not.toBe(searchKey(q));
  });

  it("shares in-flight and recent searches, then expires them", async () => {
    const { run, cache, tick } = setup();
    await Promise.all([cache(q, signal()), cache(q, signal())]);
    expect(run).toHaveBeenCalledTimes(1);
    tick(999);
    await cache(q, signal());
    expect(run).toHaveBeenCalledTimes(1);
    tick(1);
    await cache(q, signal());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps a result with provider errors only briefly", async () => {
    const { run, cache, tick } = setup([{ provider: "duffel", code: "TIMEOUT" }]);
    await cache(q, signal());
    tick(100);
    await cache(q, signal());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("forgets failures and evicts the oldest entry", async () => {
    let fail = true;
    const run = vi.fn(async () => { if (fail) throw new Error("x"); return { errors: [] } });
    const cache = createSearchCache(run, { ttlMs: 1000, errorTtlMs: 100, max: 1 });
    await expect(cache(q, signal())).rejects.toThrow();
    fail = false;
    await cache(q, signal());
    await cache({ ...q, date: "2026-10-11" }, signal());
    await cache(q, signal());
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("keys on country and hands each caller its own copy", async () => {
    expect(searchKey({ ...q, from: { ...q.from, country: "CN" } })).not.toBe(searchKey(q));
    const run = vi.fn(async () => ({ offers: [{ price: 1 }], errors: [] }));
    const cache = createSearchCache(run, { ttlMs: 1000, errorTtlMs: 100, max: 2 });
    (await cache(q, signal())).offers[0].price = 999;
    expect((await cache(q, signal())).offers[0].price).toBe(1);
  });

  it("starts nothing for a caller that already gave up", async () => {
    const { run, cache } = setup();
    const stop = new AbortController();
    stop.abort(new Error("gone"));
    await expect(cache(q, stop.signal)).rejects.toThrow("gone");
    expect(run).not.toHaveBeenCalled();
  });

  it("lets one caller stop waiting without cancelling the shared search", async () => {
    const { run, cache } = setup();
    const stop = new AbortController();
    const first = cache(q, stop.signal);
    stop.abort(new Error("gone"));
    await expect(first).rejects.toThrow("gone");
    await expect(cache(q, signal())).resolves.toEqual({ offers: [], errors: [] });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
