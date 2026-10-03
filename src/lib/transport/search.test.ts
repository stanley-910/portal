import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderFailure, type Mode, type Offer, type ProviderId, type SearchQuery, type TransportProvider } from "./types";

const { providers, env } = vi.hoisted(() => ({
  providers: [] as TransportProvider[],
  env: { DUFFEL_ACCESS_TOKEN: "offline-duffel", TRAVELPAYOUTS_TOKEN: "offline-tp", TRAVELPAYOUTS_MARKET: "us" } as Record<string, string | undefined>,
}));
vi.mock("./registry", () => ({ providers }));
vi.mock("@/lib/env.server", () => ({ env }));

import { duffel } from "./providers/duffel";
import { DUFFEL_TIMEOUT_MS } from "./providers/duffel/client";
import { travelpayouts } from "./providers/travelpayouts";
import { fanOut, PROVIDER_TIMEOUT_MS, rankFareOffers, rankOffers, searchTransport } from "./search";

const query: SearchQuery = {
  from: { name: "Hong Kong", lat: 22.3, lng: 113.9, iata: "HKG" },
  to: { name: "Bangkok", lat: 13.7, lng: 100.7, iata: "BKK" },
  date: "2026-11-15", modes: ["flight"], passengers: 1, currency: "USD",
};

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id, provider: "travelpayouts", mode: "flight", kind: "cached",
    price: { amount: 100, currency: "USD" },
    segments: [{
      mode: "flight", from: query.from, to: query.to,
      depart: "2026-11-15T09:00:00+08:00", arrive: "2026-11-15T04:00:00Z", durationMin: 180,
    }], ...overrides,
  };
}

function provider(overrides: Partial<TransportProvider> = {}): TransportProvider {
  return {
    id: "travelpayouts", modes: ["flight"], covers: vi.fn(() => true),
    search: vi.fn(async () => [offer("ok")]), ...overrides,
  };
}

const search = (q = query, signal = new AbortController().signal) => searchTransport(q, signal);

beforeEach(() => { providers.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("merged offer metadata validation", () => {
  it("retains explicitly estimated fallbacks and transfer counts", async () => {
    const estimated = offer("estimate", { kind: "estimated", transfers: 2 });
    const result = await fanOut(query, { providers: [provider({ search: async () => [estimated] })] });
    expect(result.errors).toEqual([]);
    expect(result.offers).toEqual([estimated]);
  });

  it.each([-1, 0.5, NaN, Infinity])("rejects an invalid transfer count: %s", async (transfers) => {
    const result = await fanOut(query, { providers: [provider({ search: async () => [offer("bad", { transfers })] })] });
    expect(result.offers).toEqual([]);
    expect(result.errors[0].code).toBe("BAD_RESPONSE");
  });
});

describe("rankFareOffers (original currency-safe fare contract)", () => {
  const rankOffers = rankFareOffers;
  it("ranks comparable prices, foreign currencies in separate groups, then unpriced offers", () => {
    const rows = [
      offer("unpriced", { price: undefined }),
      offer("jpy", { price: { amount: 1, currency: "JPY" } }),
      offer("usd-high", { price: { amount: 200, currency: "USD" } }),
      offer("eur-high", { price: { amount: 500, currency: "EUR" } }),
      offer("eur-low", { price: { amount: 20, currency: "EUR" } }),
      offer("usd-low", { price: { amount: 10, currency: "usd" } }),
    ];
    const original = [...rows];
    expect(rankOffers(rows, "usd").map((row) => row.id)).toEqual([
      "usd-low", "usd-high", "eur-low", "eur-high", "jpy", "unpriced",
    ]);
    expect(rows).toEqual(original);
  });

  it("compares instants across offsets rather than timestamp strings", () => {
    const earlier = offer("earlier"); // 01:00 UTC
    const later = offer("later", { segments: [{ ...earlier.segments[0], depart: "2026-11-15T08:00:00+01:00" }] });
    expect(rankOffers([later, earlier], "USD").map((row) => row.id)).toEqual(["earlier", "later"]);
  });

  it("ties equal instants by provider then stable ID independent of input order", () => {
    const a = offer("a");
    const z = offer("z", { segments: [{ ...a.segments[0], depart: "2026-11-15T01:00:00Z" }] });
    const bus = offer("b", { provider: "12go" });
    expect(rankOffers([z, a, bus], "USD").map((row) => row.id)).toEqual(["b", "a", "z"]);
    expect(rankOffers([a, bus, z], "USD")).toEqual(rankOffers([z, a, bus], "USD"));
  });

  it("handles missing segments, invalid dates and nonfinite prices defensively", () => {
    const valid = offer("valid");
    const empty = offer("empty", { segments: [], price: { amount: NaN, currency: "USD" } });
    const invalid = offer("invalid", { segments: [{ ...valid.segments[0], depart: "garbage" }], price: undefined });
    expect(rankOffers([invalid, empty, valid], "USD").map((row) => row.id)).toEqual(["valid", "empty", "invalid"]);
  });

  it("treats zero as a valid fare, not a missing fare", () => {
    expect(rankOffers([offer("paid"), offer("zero", { price: { amount: 0, currency: "USD" } })], "USD")[0].id).toBe("zero");
  });
});

describe("rankOffers (best-option contract)", () => {
  it("scores known FX estimates without changing the quoted currency or amount", () => {
    const flight = offer("flight", { price: { amount: 91, currency: "USD" } });
    flight.segments[0].durationMin = 125;
    const train = offer("train", { mode: "train", price: { amount: 553, currency: "cny" } });
    train.segments[0] = { ...train.segments[0], mode: "train", durationMin: 277 };
    const input = [flight, train];
    const before = structuredClone(input);
    expect(rankOffers(input, "USD").map((o) => o.id)).toEqual(["train", "flight"]);
    expect(input).toEqual(before);
  });

  it("never treats an unknown currency as USD", () => {
    const unknown = offer("unknown", { price: { amount: 1, currency: "JPY" } });
    const known = offer("known", { price: { amount: 100, currency: "USD" } });
    expect(rankOffers([unknown, known], "USD").map((o) => o.id)).toEqual(["known", "unknown"]);
  });

  it("compares unknown currencies only within their own currency groups", () => {
    const rows = [
      offer("krw", { price: { amount: 1, currency: "KRW" } }),
      offer("jpy-high", { price: { amount: 500, currency: "JPY" } }),
      offer("jpy-low", { price: { amount: 100, currency: "jpy" } }),
    ];
    expect(rankOffers(rows, "JPY").map((o) => o.id)).toEqual(["jpy-low", "jpy-high", "krw"]);
  });

  it("uses UTC instants and stable IDs to break equal scores", () => {
    const earlier = offer("earlier");
    const later = offer("later", { segments: [{ ...earlier.segments[0], depart: "2026-11-15T08:00:00+01:00" }] });
    expect(rankOffers([later, earlier], "USD").map((o) => o.id)).toEqual(["earlier", "later"]);
    expect(rankOffers([offer("z"), offer("a")], "USD").map((o) => o.id)).toEqual(["a", "z"]);
  });

  it("counts every segment rather than only the first when scoring duration", () => {
    const direct = offer("direct", { price: { amount: 100, currency: "USD" } });
    const connection = offer("connection", { price: { amount: 10, currency: "USD" } });
    connection.segments = [
      { ...connection.segments[0], durationMin: 1 },
      { ...connection.segments[0], durationMin: 3000 },
    ];
    expect(rankOffers([connection, direct], "USD")[0].id).toBe("direct");
  });

  it("does not throw on malformed direct ranking inputs", () => {
    expect(() => rankOffers([offer("empty", { segments: [], price: { amount: NaN, currency: "USD" } }), offer("valid")], "USD")).not.toThrow();
  });
});

describe("searchTransport", () => {
  it("returns an empty result when no provider covers the route", async () => {
    const unused = provider({ covers: () => false });
    providers.push(unused);
    expect(await search()).toMatchObject({ offers: [], errors: [], tookMs: expect.any(Number) });
    expect(unused.search).not.toHaveBeenCalled();
  });

  it("filters mode before calling covers; an empty mode list means all modes", async () => {
    const flight = provider();
    providers.push(flight);
    expect((await search({ ...query, modes: ["bus"] })).offers).toEqual([]);
    expect(flight.covers).not.toHaveBeenCalled();
    expect((await search({ ...query, modes: [] })).offers).toHaveLength(1);
  });

  it("keeps successes beside typed failures and redacts unknown failures", async () => {
    providers.push(
      provider(),
      provider({ id: "12go", search: async () => { throw new ProviderFailure("RATE_LIMITED", true); } }),
      provider({ id: "tdx", search: async () => { throw new Error("secret-token-provider-body"); } }),
    );
    const result = await search();
    expect(result.offers).toHaveLength(1);
    expect(result.errors).toEqual([
      { provider: "12go", code: "RATE_LIMITED", retryable: true },
      { provider: "tdx", code: "UPSTREAM_ERROR", retryable: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("isolates synchronous throws in covers and search", async () => {
    providers.push(
      provider({ id: "12go", covers: () => { throw new Error("secret"); } }),
      provider({ id: "tdx", search: () => { throw new Error("secret"); } }),
      provider(),
    );
    const result = await search();
    expect(result.offers).toHaveLength(1);
    expect(result.errors.map((error) => error.provider)).toEqual(["12go", "tdx"]);
  });

  it("fans out concurrently and bounds an adapter which ignores its abort signal", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    const hanging = provider({ id: "tdx", search: vi.fn((_q, signal) => {
      captured = signal;
      return new Promise<Offer[]>(() => {});
    }) });
    const healthy = provider();
    providers.push(hanging, healthy);
    const pending = search();
    await vi.advanceTimersByTimeAsync(0);
    expect(hanging.search).toHaveBeenCalledOnce();
    expect(healthy.search).toHaveBeenCalledOnce();
    expect(captured?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      offers: [expect.objectContaining({ id: "ok" })],
      errors: [{ provider: "tdx", code: "TIMEOUT", retryable: true }],
      tookMs: PROVIDER_TIMEOUT_MS,
    });
    expect(captured?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a provider's late rejection after its deadline without changing the result", async () => {
    vi.useFakeTimers();
    let rejectLate: (reason: Error) => void = () => {};
    providers.push(provider({ search: () => new Promise<Offer[]>((_, reject) => { rejectLate = reject; }) }));
    const pending = search();
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    const result = await pending;
    rejectLate(new Error("late secret provider failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.errors).toEqual([{ provider: "travelpayouts", code: "TIMEOUT", retryable: true }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives providers separate deadline signals and orders results rather than completion times", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    providers.push(
      provider({ search: async (_q, signal) => {
        signals.push(signal);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [offer("cheap", { price: { amount: 1, currency: "USD" } })];
      } }),
      provider({ id: "12go", search: async (_q, signal) => {
        signals.push(signal);
        return [offer("expensive", { provider: "12go" })];
      } }),
    );
    const pending = search();
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).offers.map((row) => row.id)).toEqual(["cheap", "expensive"]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts promptly on caller cancellation, including a pre-aborted request", async () => {
    vi.useFakeTimers();
    const hanging = provider({ search: vi.fn(() => new Promise<Offer[]>(() => {})) });
    providers.push(hanging);
    const controller = new AbortController();
    const pending = search(query, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("secret cancellation reason"));
    expect((await pending).errors).toEqual([{ provider: "travelpayouts", code: "TIMEOUT", retryable: true }]);
    vi.mocked(hanging.search).mockClear();
    expect((await search(query, controller.signal)).errors[0].code).toBe("TIMEOUT");
    expect(hanging.search).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans successful deadlines without cancelling the parent request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    providers.push(provider());
    await search(query, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.signal.aborted).toBe(false);
  });

  it.each([
    { segments: [] },
    { price: { amount: -1, currency: "USD" } },
    { price: { amount: Infinity, currency: "USD" } },
    { price: { amount: 1, currency: "dollars" } },
    { provider: "12go" },
    { mode: "bus" },
    { kind: "fresh-ish" },
    { segments: [{ ...offer("base").segments[0], depart: "2026-11-15T09:00:00" }] },
    { segments: [{ ...offer("base").segments[0], depart: "2026-02-30T09:00:00Z" }] },
    { segments: [{ ...offer("base").segments[0], arrive: "2026-11-14T09:00:00Z" }] },
  ])("rejects malformed offer %j without losing valid siblings", async (bad) => {
    providers.push(provider({ search: async () => [offer("bad", bad as Partial<Offer>), offer("ok")] }));
    const result = await search();
    expect(result.offers.map((row) => row.id)).toEqual(["ok"]);
    expect(result.errors).toEqual([{ provider: "travelpayouts", code: "BAD_RESPONSE", retryable: false }]);
  });

  it("rejects a malformed non-array batch", async () => {
    providers.push(provider({ search: async () => null as unknown as Offer[] }));
    expect(await search()).toMatchObject({ offers: [], errors: [{ provider: "travelpayouts", code: "BAD_RESPONSE", retryable: false }] });
  });
});

describe("a provider past its deadline", () => {
  const estimate = offer("estimate", { kind: "estimated", price: { amount: 150, currency: "USD" } });
  const hanging = () => new Promise<Offer[]>(() => {});

  it("still gives its estimates, with the timeout in errors", async () => {
    vi.useFakeTimers();
    providers.push(provider({ search: hanging, fallback: () => [estimate] }));
    const pending = search();
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      offers: [estimate],
      errors: [{ provider: "travelpayouts", code: "TIMEOUT", retryable: true }],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives its estimates when it fails, too", async () => {
    providers.push(provider({ search: async () => { throw new ProviderFailure("RATE_LIMITED", true); }, fallback: () => [estimate] }));
    expect(await search()).toMatchObject({ offers: [estimate], errors: [{ code: "RATE_LIMITED" }] });
  });

  it("never passes off a fallback offer that isn't marked estimated, and survives a throwing fallback", async () => {
    providers.push(
      provider({ search: hanging, fallback: () => [offer("posing-as-cached"), estimate] }),
      provider({ id: "12go", search: async () => { throw new ProviderFailure("UPSTREAM_ERROR", true); }, fallback: () => { throw new Error("broken"); } }),
    );
    const result = await fanOut(query, { timeoutMs: 20 });
    expect(result.offers.map((o) => o.id)).toEqual(["estimate"]);
    expect(result.errors.map((e) => e.code)).toEqual(["UPSTREAM_ERROR", "TIMEOUT"]);
  });

  it("waits for a provider's own longer deadline before giving up on it", async () => {
    vi.useFakeTimers();
    let answer: (offers: Offer[]) => void = () => {};
    providers.push(provider({ timeoutMs: PROVIDER_TIMEOUT_MS + 2_000, search: () => new Promise<Offer[]>((resolve) => { answer = resolve; }) }));
    const pending = search();
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS + 1_000);
    answer([offer("late-but-live")]);
    expect((await pending).offers.map((o) => o.id)).toEqual(["late-but-live"]);
  });
});

describe("live flight providers time out", () => {
  // the real Duffel and Travelpayouts adapters, with keys, against APIs that never answer
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("still returns an estimated flight, and says which providers timed out", async () => {
    vi.useFakeTimers();
    providers.push(duffel, travelpayouts);
    const pending = search(query);
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    // Duffel has longer than the default, so the search waits for it
    await vi.advanceTimersByTimeAsync(DUFFEL_TIMEOUT_MS - PROVIDER_TIMEOUT_MS);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      provider: "travelpayouts", mode: "flight", kind: "estimated",
      segments: [{ from: { iata: "HKG" }, to: { iata: "BKK" } }],
      price: { currency: "USD" },
    });
    expect(result.errors).toEqual([
      { provider: "duffel", code: "TIMEOUT", retryable: true },
      { provider: "travelpayouts", code: "TIMEOUT", retryable: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Preserve the incoming API contract separately from coordinate-search behavior.
describe("incoming fanOut contract", () => {
const place = { name: "X", lat: 0, lng: 0 };
const query = (modes: Mode[] = []): SearchQuery => ({
  from: place,
  to: place,
  date: "2026-10-20",
  modes,
  passengers: 1,
  currency: "USD",
});

function offer(provider: ProviderId, depart: string): Offer {
  const mode = provider === "travelpayouts" ? "flight" : "train";
  return {
    id: `${provider}:${depart}`,
    provider,
    mode,
    kind: "cached",
    segments: [{ mode, from: place, to: place, depart, arrive: depart, durationMin: 0 }],
  };
}

function fake(id: ProviderId, modes: Mode[], search: TransportProvider["search"]): TransportProvider {
  return { id, modes, covers: (q) => q.modes.length === 0 || q.modes.some((m) => modes.includes(m)), search };
}

const hang = () => new Promise<Offer[]>(() => {});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fanOut", () => {
  it("returns offers from healthy providers beside errors from failing and hanging ones", async () => {
    const result = await fanOut(query(), {
      timeoutMs: 50,
      providers: [
        fake("travelpayouts", ["flight"], async () => [offer("travelpayouts", "2026-10-20T09:00:00+08:00")]),
        fake("tdx", ["train"], async () => {
          throw new ProviderFailure("RATE_LIMITED", true);
        }),
        fake("gtfs", ["bus"], hang),
      ],
    });
    expect(result.offers.map((o) => o.provider)).toEqual(["travelpayouts"]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { provider: "tdx", code: "RATE_LIMITED", retryable: true },
        { provider: "gtfs", code: "TIMEOUT", retryable: true },
      ]),
    );
    expect(result.errors).toHaveLength(2);
    expect(result.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("aborts the signal handed to a provider that runs past the timeout", async () => {
    let seen: AbortSignal | undefined;
    await fanOut(query(), {
      timeoutMs: 20,
      providers: [
        fake("gtfs", ["bus"], (_q, signal) => {
          seen = signal;
          return hang();
        }),
      ],
    });
    expect(seen?.aborted).toBe(true);
  });

  it("maps a non-ProviderFailure throw to UPSTREAM_ERROR", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("12go", ["ferry"], async () => {
          throw new Error("boom");
        }),
      ],
    });
    expect(result.errors).toEqual([{ provider: "12go", code: "UPSTREAM_ERROR", retryable: false }]);
  });

  it("skips providers whose modes do not match", async () => {
    const train = vi.fn(async () => [] as Offer[]);
    const result = await fanOut(query(["flight"]), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [offer("travelpayouts", "2026-10-20T09:00:00+08:00")]),
        fake("tdx", ["train"], train),
      ],
    });
    expect(train).not.toHaveBeenCalled();
    expect(result.offers).toHaveLength(1);
  });

  it("returns empty offers and errors when no provider covers the query", async () => {
    const result = await fanOut(query(["ferry"]), {
      providers: [fake("travelpayouts", ["flight"], async () => [])],
    });
    expect(result.offers).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("treats a throwing covers() as not covering", async () => {
    const p = fake("tdx", ["train"], async () => []);
    p.covers = () => {
      throw new Error("bad");
    };
    const result = await fanOut(query(), { providers: [p] });
    expect(result.errors).toEqual([]);
  });

  it("ranks by best-option score, including the unpriced heuristic", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [
          { ...offer("travelpayouts", "2026-10-20T01:30:00Z"), price: { amount: 120, currency: "USD" } },
          { ...offer("travelpayouts", "2026-10-20T10:00:00+08:00"), price: { amount: 80, currency: "USD" } },
        ]),
        fake("tdx", ["train"], async () => [offer("tdx", "2026-10-20T00:45:00Z")]),
      ],
    });

    expect(result.offers.map((o) => o.price?.amount ?? null)).toEqual([80, null, 120]);
  });

  it("prefers a lower-cost train over a faster expensive flight", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [{
          ...offer("travelpayouts", "2026-10-20T09:00:00Z"),
          price: { amount: 91, currency: "USD" },
          segments: [{ ...offer("travelpayouts", "2026-10-20T09:00:00Z").segments[0], durationMin: 125 }],
        }]),
        fake("china-rail", ["train"], async () => [{
          ...offer("china-rail", "2026-10-20T08:00:00+08:00"),
          price: { amount: 553, currency: "CNY" },
          mode: "train",
          segments: [{ ...offer("china-rail", "2026-10-20T08:00:00+08:00").segments[0], mode: "train", durationMin: 277 }],
        }]),
      ],
    });
    expect(result.offers[0].mode).toBe("train");
  });

  it("ranks a connecting flight below a direct one at the same price", async () => {
    const priced = (depart: string, transfers: number): Offer => ({
      ...offer("travelpayouts", depart),
      price: { amount: 100, currency: "USD" },
      transfers,
    });
    const result = await fanOut(query(), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [priced("2026-10-20T08:00:00Z", 1), priced("2026-10-20T09:00:00Z", 0)]),
      ],
    });
    expect(result.offers.map((o) => o.transfers)).toEqual([0, 1]);
  });

  it("aborts every provider when the caller signal aborts", async () => {
    const ctrl = new AbortController();
    const p = fanOut(query(), { timeoutMs: 5_000, signal: ctrl.signal, providers: [fake("gtfs", ["bus"], hang)] });
    ctrl.abort();
    const result = await p;
    expect(result.errors).toEqual([{ provider: "gtfs", code: "TIMEOUT", retryable: true }]);
  });
});
});

describe("progressive provider results", () => {
  it("publishes the fast validated result before the slow provider finishes", async () => {
    vi.useFakeTimers();
    const slow = provider({ id: "duffel", search: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return [offer("slow", { provider: "duffel" })];
    } });
    const progress = vi.fn();
    const started = Date.now();
    const visible: number[] = [];
    const pending = fanOut(query, { providers: [provider(), slow], onProgress: (result) => {
      if (result.offers.length) visible.push(Date.now() - started);
      progress(result);
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0].offers.map((o: Offer) => o.id)).toEqual(["ok"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).offers).toHaveLength(2);
    expect(visible[0]).toBe(0);
    expect(Date.now() - started).toBe(1_000);
  });

  it("coalesces identical active queries while keeping reader cancellation independent", async () => {
    vi.useFakeTimers();
    const p = provider({ search: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [offer("shared")];
    }) });
    const abort = new AbortController();
    const a = fanOut(query, { providers: [p], signal: abort.signal });
    const b = fanOut(query, { providers: [p] });
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect((await a).errors[0].code).toBe("TIMEOUT");
    expect((await b).offers[0].id).toBe("shared");
    expect(p.search).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent calls per provider including separate coordinate searches", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0;
    const p = provider({ search: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active--;
      return [offer("bounded")];
    } });
    const work = Promise.all(Array.from({ length: 20 }, (_, i) => fanOut({ ...query, date: `2026-11-${String(i + 1).padStart(2, "0")}` }, { providers: [p] })));
    await vi.advanceTimersByTimeAsync(500);
    expect(await work).toHaveLength(20);
    expect(peak).toBe(6);
  });
});
