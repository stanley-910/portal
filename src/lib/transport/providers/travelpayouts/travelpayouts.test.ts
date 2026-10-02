import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/prices_for_dates.json";
import { aviasalesUrl } from "./links";
import { mapFlights } from "./map";
import { toIata } from "./places";
import { ProviderFailure, type SearchQuery } from "../../types";

const { env } = vi.hoisted(() => ({ env: {
  TRAVELPAYOUTS_TOKEN: "offline-test-token" as string | undefined,
  TRAVELPAYOUTS_MARKET: "us",
  TRAVELPAYOUTS_MARKER: undefined as string | undefined,
} }));
vi.mock("@/lib/env.server", () => ({ env }));
vi.mock("server-only", () => ({}));

import { getPrices } from "./client";
import { travelpayouts } from "./index";

const query: SearchQuery = {
  from: { name: "Hong Kong", lat: 22.31, lng: 113.92, iata: "HKG" },
  to: { name: "Bangkok", lat: 13.75, lng: 100.5 },
  date: "2026-11-15", modes: ["flight"], passengers: 1, currency: "USD",
};
const row = fixture.data[0];
const signal = () => new AbortController().signal;

beforeEach(() => {
  env.TRAVELPAYOUTS_TOKEN = "offline-test-token";
  env.TRAVELPAYOUTS_MARKER = undefined;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Travelpayouts mapper", () => {
  it("maps the documented fixture as a cached, per-passenger fare", () => {
    const offers = mapFlights(fixture.data, query);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "travelpayouts:HKG-BKK-2026-11-15T09:00:00+08:00-HX-765",
      provider: "travelpayouts", kind: "cached", price: { amount: 120, currency: "USD" },
      attribution: expect.stringContaining("availability unverified"),
      segments: [{
        carrier: "HX", number: "HX765", durationMin: 165,
        arrive: "2026-11-15T03:45:00.000Z",
        to: { iata: "BKK", lat: 13.69, lng: 100.75 },
      }],
    });
    expect(offers[0].price?.asOf).toBeUndefined();
  });

  it("accepts an empty array as normal cache sparsity, not invented availability", () => {
    expect(mapFlights([], query)).toEqual([]);
  });

  it("uses duration when duration_to is absent and preserves a real observation time", () => {
    const offers = mapFlights([{ ...row, duration_to: undefined, duration: 165, found_at: "2026-10-01T00:00:00Z" }], query);
    expect(offers[0].segments[0].durationMin).toBe(165);
    expect(offers[0].price?.asOf).toBe("2026-10-01T00:00:00Z");
  });

  it("does not multiply cached fares into a made-up party quote", () => {
    expect(mapFlights([row], { ...query, passengers: 4 })[0].price?.amount).toBe(120);
  });

  it.each([
    null,
    { ...row, price: "120" },
    { ...row, price: NaN },
    { ...row, price: Infinity },
    { ...row, price: -1 },
    { ...row, duration_to: undefined },
    { ...row, duration_to: -1 },
    { ...row, duration_to: 0 },
    { ...row, duration_to: 1e100 },
    { ...row, departure_at: "not-a-date" },
    { ...row, departure_at: "2026-11-15T09:00:00" },
    { ...row, departure_at: "2026-02-30T09:00:00Z" },
    { ...row, found_at: "private-invalid-date" },
    { ...row, airline: "" },
    { ...row, origin_airport: "" },
    { ...row, transfers: undefined },
    { ...row, currency: "EUR" },
  ])("rejects malformed essential upstream data without raw exceptions: %j", (bad) => {
    expect(() => mapFlights([row, bad], query)).toThrow(ProviderFailure);
    expect(() => mapFlights([bad], query)).toThrow("BAD_RESPONSE");
  });

  it("does not turn a connecting summary into a direct segment", () => {
    expect(mapFlights([{ ...row, transfers: 1 }], query)).toEqual([]);
  });

  it("does not include wrong dates or routes from an upstream response", () => {
    expect(mapFlights([
      { ...row, departure_at: "2026-11-16T09:00:00+08:00" },
      { ...row, destination_airport: "TPE", destination: "TPE" },
    ], query)).toEqual([]);
  });

  it("preserves explicit airport pairs and refuses a sibling airport returned for the city", () => {
    const tokyo: SearchQuery = { ...query, to: { name: "Narita", lat: 35.765, lng: 140.386, iata: "NRT" } };
    expect(mapFlights([{ ...row, destination: "TYO", destination_airport: "NRT" }], tokyo)[0].segments[0].to.iata).toBe("NRT");
    expect(mapFlights([{ ...row, destination: "TYO", destination_airport: "HND" }], tokyo)).toEqual([]);
  });

  it("includes airline in stable IDs to avoid cross-airline flight-number collisions", () => {
    const offers = mapFlights([row, { ...row, airline: "CX" }], query);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(2);
  });

  it("omits unsafe links without discarding an otherwise valid cached fare", () => {
    expect(mapFlights([{ ...row, link: "javascript:alert(1)" }], query)[0].bookingUrl).toBeUndefined();
  });
});

describe("Travelpayouts place and link boundaries", () => {
  it("keeps explicit airports rather than broadening to city codes", () => {
    expect(toIata(query.from)).toBe("HKG");
    expect(toIata({ ...query.from, iata: "icn" })).toBe("ICN");
    expect(toIata({ ...query.from, iata: "nrt" })).toBe("NRT");
    expect(toIata({ ...query.from, iata: "pvg" })).toBe("PVG");
    expect(toIata({ ...query.from, iata: "sha" })).toBe("SHA");
    expect(toIata({ ...query.from, iata: "not-a-code" })).toBeNull();
  });

  it("retains the limited coordinate fallback without treating it as connectivity evidence", () => {
    expect(toIata(query.to)).toBe("BKK");
    expect(toIata({ name: "Pacific", lat: 0, lng: 0 })).toBeNull();
    expect(toIata({ name: "Invalid", lat: NaN, lng: 100 })).toBeNull();
    expect(toIata({ name: "Invalid", lat: 100, lng: 100 })).toBeNull();
  });

  it("prefixes safe relative links and keeps one existing marker", () => {
    const url = "https://www.aviasales.com/search/HKG1511BKK1";
    expect(aviasalesUrl("/search/HKG1511BKK1", "generic")).toBe(`${url}?marker=generic`);
    expect(aviasalesUrl(`${url}?marker=existing&marker=duplicate`, "generic")).toBe(`${url}?marker=existing`);
    expect(aviasalesUrl(`${url}?marker=existing&marker=duplicate`)).toBe(`${url}?marker=existing`);
    expect(aviasalesUrl("/search/HKG1511BKK1")).toBe(url);
  });

  it.each([
    "javascript:alert(1)", "https://evil.invalid/search/a", "//evil.invalid/search/a",
    "http://www.aviasales.com/search/a", "https://user:pass@www.aviasales.com/search/a",
    "https://www.aviasales.com/other", "https://[malformed",
  ])("rejects untrusted booking destination %s", (link) => {
    expect(aviasalesUrl(link, "generic")).toBeUndefined();
  });
});

describe("Travelpayouts client and adapter (offline fetch stubs)", () => {
  it("requests explicit airports, market, currency, one-way/direct fares and header-only auth", async () => {
    const fetch = vi.fn(async () => Response.json(fixture));
    vi.stubGlobal("fetch", fetch);
    const result = await getPrices(query, "HKG", "BKK", signal());
    expect(result).toEqual(fixture.data);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit & { next: { revalidate: number } }];
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      origin: "HKG", destination: "BKK", currency: "usd", market: "us",
      departure_at: query.date, one_way: "true", direct: "true", limit: "30",
    });
    expect(url).not.toContain("offline-test-token");
    expect(options.headers).toMatchObject({ "X-Access-Token": "offline-test-token" });
    expect(options.next).toEqual({ revalidate: 86400 });
    expect((await travelpayouts.search(query, signal()))[0].kind).toBe("cached");
  });

  it.each([
    null, [], {}, { success: "true", data: [] }, { success: true },
    { success: true, data: {} }, { success: false, error: "secret upstream error" },
    { success: true, data: [], currency: "EUR" },
  ])("rejects malformed/logical envelopes with sanitized BAD_RESPONSE: %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    await expect(getPrices(query, "HKG", "BKK", signal())).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "BAD_RESPONSE" });
  });

  it("distinguishes an empty successful cache from malformed missing data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data: [], currency: "usd" })));
    expect(await travelpayouts.search(query, signal())).toEqual([]);
  });

  it("reports missing credentials without making a request", async () => {
    env.TRAVELPAYOUTS_TOKEN = undefined;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(getPrices(query, "HKG", "BKK", signal())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(travelpayouts.search(query, signal())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("covers means resolvable endpoints only; identical endpoints are not a route", async () => {
    expect(travelpayouts.covers(query)).toBe(true);
    expect(travelpayouts.covers({ ...query, modes: ["bus"] })).toBe(false);
    const same = { ...query, to: query.from };
    expect(travelpayouts.covers(same)).toBe(false);
    await expect(travelpayouts.search(same, signal())).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });
});
