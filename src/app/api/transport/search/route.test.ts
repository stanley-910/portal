import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flight keys on, every other provider unconfigured, for the end-to-end timeout case below.
const { env } = vi.hoisted(() => ({ env: { DUFFEL_ACCESS_TOKEN: "offline-duffel", TRAVELPAYOUTS_TOKEN: "offline-tp", TRAVELPAYOUTS_MARKET: "us" } }));
vi.mock("@/lib/env.server", () => ({ env }));
vi.mock("@/lib/transport/search", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/transport/search")>(), searchTransport: vi.fn(),
}));
vi.mock("@/lib/transport/hub-search", () => ({ searchFromCoordinates: vi.fn() }));
import { searchTransport } from "@/lib/transport/search";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import type { HubSearchResult } from "@/lib/transport/hub-search";
import { GET } from "./route";

function request(extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    from: JSON.stringify({ name: "Hong Kong", lat: 22.3, lng: 114.2 }),
    to: JSON.stringify({ name: "Shanghai", lat: 31.2, lng: 121.5 }),
    date: "2026-11-15", ...extra,
  });
  return new Request(`http://localhost/api/transport/search?${params}`);
}

beforeEach(() => vi.resetAllMocks());
describe("transport search route", () => {
  it.each<Record<string, string>>([{ from: "{" }, { date: "2026-02-30" }, { modes: "spaceship" }, { resolve: "anything" }])("returns safe 400 for invalid input %j", async (extra) => {
    const response = await GET(request(extra));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "BAD_QUERY", fields: expect.any(Array) });
    expect(searchTransport).not.toHaveBeenCalled();
    expect(searchFromCoordinates).not.toHaveBeenCalled();
  });
  it("preserves the existing provider search contract by default", async () => {
    vi.mocked(searchTransport).mockResolvedValue({ offers: [], errors: [], tookMs: 0 });
    const req = request();
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(searchTransport).toHaveBeenCalledWith(expect.objectContaining({ modes: [] }), req.signal);
    expect(searchFromCoordinates).not.toHaveBeenCalled();
  });
  it("opts click queries into hub resolution without stripping clicked coordinates", async () => {
    vi.mocked(searchFromCoordinates).mockResolvedValue({ offers: [], errors: [], tookMs: 0, estimates: [], offerPairs: {}, hubs: {} } as never);
    const req = request({ resolve: "hubs" });
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(searchFromCoordinates).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Hong Kong", lat: 22.3, lng: 114.2 },
      to: { name: "Shanghai", lat: 31.2, lng: 121.5 },
    }), req.signal);
  });
  it("does not misclassify an internal SyntaxError as a client error", async () => {
    vi.mocked(searchTransport).mockRejectedValue(new SyntaxError("internal failure"));
    await expect(GET(request())).rejects.toThrow("internal failure");
  });
});

describe("transport search route, when the live flight APIs never answer", () => {
  beforeEach(async () => {
    // the real search behind the route: hubs, every registered provider, deadlines and fallbacks
    const search = await vi.importActual<typeof import("@/lib/transport/search")>("@/lib/transport/search");
    const hubs = await vi.importActual<typeof import("@/lib/transport/hub-search")>("@/lib/transport/hub-search");
    vi.mocked(searchTransport).mockImplementation(search.searchTransport);
    vi.mocked(searchFromCoordinates).mockImplementation(hubs.searchFromCoordinates);
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers with estimated flights, never an empty card, and names the providers that timed out", async () => {
    vi.useFakeTimers();
    const pending = GET(request({ resolve: "hubs", modes: "flight" }));
    await vi.advanceTimersByTimeAsync(15_000);
    const response = await pending;
    expect(response.status).toBe(200);
    const result = (await response.json()) as HubSearchResult;
    expect(fetch).toHaveBeenCalled();
    expect(result.offers.length).toBeGreaterThan(0);
    for (const offer of result.offers) expect(offer).toMatchObject({ mode: "flight", kind: "estimated", provider: "travelpayouts" });
    expect(result.errors).toEqual(expect.arrayContaining([
      { provider: "duffel", code: "TIMEOUT", retryable: true },
      { provider: "travelpayouts", code: "TIMEOUT", retryable: true },
    ]));
    // every flight pair searched has something on it
    expect(result.estimates.filter((id) => result.hubs.pairs.find((p) => p.id === id)?.mode === "flight")).toEqual([]);
  });
});

describe("progressive transport stream", () => {
  it("streams a partial snapshot before the final result without changing the JSON endpoint", async () => {
    const result = { offers: [], errors: [], tookMs: 0, estimates: [], offerPairs: {}, hubs: {} } as unknown as HubSearchResult;
    let finish!: (value: HubSearchResult) => void;
    vi.mocked(searchFromCoordinates).mockImplementation(async (_q, _signal, progress) => {
      progress?.(result);
      return new Promise((resolve) => { finish = resolve; });
    });
    const response = await GET(request({ resolve: "hubs", stream: "1" }));
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const reader = response.body!.getReader();
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({ t: "result", done: false });
    finish(result);
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({ t: "result", done: true });
    expect((await reader.read()).done).toBe(true);
  });
  it("cancels work when a stream reader leaves", async () => {
    let signal!: AbortSignal;
    vi.mocked(searchFromCoordinates).mockImplementation((_q, s) => { signal = s; return new Promise(() => {}); });
    const response = await GET(request({ resolve: "hubs", stream: "1" }));
    await response.body!.cancel();
    expect(signal.aborted).toBe(true);
  });
});

describe("progressive snapshot pressure", () => {
  afterEach(() => vi.useRealTimers());
  it("sends the first useful snapshot immediately, coalesces bursts and always flushes final state", async () => {
    vi.useFakeTimers();
    const result = { offers: [{ id: "first" }], errors: [], tookMs: 0, estimates: [], offerPairs: {}, hubs: {} } as unknown as HubSearchResult;
    let finish!: (value: HubSearchResult) => void;
    vi.mocked(searchFromCoordinates).mockImplementation(async (_q, _signal, progress) => {
      for (let i = 0; i < 20; i++) progress?.({ ...result, tookMs: i });
      return new Promise((resolve) => { finish = resolve; });
    });
    const response = await GET(request({ resolve: "hubs", stream: "1" }));
    const reader = response.body!.getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(first).toMatchObject({ done: false, result: { tookMs: 0 } });
    await vi.advanceTimersByTimeAsync(50);
    const batch = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(batch).toMatchObject({ done: false, result: { tookMs: 19 } });
    finish({ ...result, tookMs: 1000 });
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({ done: true });
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
