import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({ providers: [] }));
vi.mock("./search", async (importOriginal) => ({
  ...await importOriginal<typeof import("./search")>(), searchTransport: vi.fn(),
}));
import { searchFromCoordinates } from "./hub-search";
import { searchTransport } from "./search";
import type { Offer, SearchQuery } from "./types";

const query: SearchQuery = {
  from: { name: "Hong Kong click", lat: 22.305, lng: 114.165 },
  to: { name: "Shanghai click", lat: 31.23, lng: 121.47 },
  date: "2026-11-15", modes: ["flight", "train", "ferry"], currency: "USD", passengers: 1,
};
const search = vi.mocked(searchTransport);
const signal = () => new AbortController().signal;
function offer(q: SearchQuery, id: string, amount: number): Offer {
  return {
    id, provider: "travelpayouts", mode: "flight", kind: "cached",
    segments: [{ mode: "flight", from: q.from, to: q.to, depart: `${q.date}T09:00:00+08:00`, arrive: `${q.date}T11:00:00+08:00`, durationMin: 120 }],
    price: { amount, currency: "USD" },
  };
}

beforeEach(() => { search.mockReset(); });
describe("clicks → hubs → provider queries", () => {
  it("searches exact airport pairs, with bounded fan-out and the request signal", async () => {
    search.mockResolvedValue({ offers: [], errors: [], tookMs: 0 });
    const abort = signal();
    const result = await searchFromCoordinates(query, abort);
    const flights = search.mock.calls.filter(([q]) => q.modes[0] === "flight");
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.length).toBeLessThanOrEqual(4);
    for (const [q, s] of flights) {
      expect(q.from.iata).toMatch(/^[A-Z]{3}$/);
      expect(q.to.iata).toMatch(/^[A-Z]{3}$/);
      expect(q.from.iata).not.toBe(q.to.iata);
      expect(s).toBe(abort);
      expect(q.date).toBe(query.date);
    }
    expect(result.hubs.origin).toEqual(query.from);
    expect(result.estimates.length).toBe(result.hubs.pairs.length);
    expect(result.offers).toEqual([]);
  });
  it("retains honest bundled alternatives when the flight API is not configured", async () => {
    search.mockResolvedValue({ offers: [], errors: [{ provider: "travelpayouts", code: "NOT_CONFIGURED", retryable: false }], tookMs: 1 });
    const result = await searchFromCoordinates(query, signal());
    expect(result.errors).toHaveLength(1);
    expect(result.hubs.pairs.some((pair) => pair.mode === "train" && pair.evidence === "bundled-connection")).toBe(true);
    expect(result.estimates.length).toBeGreaterThan(0);
    expect(result.offers).toHaveLength(0); // Never invent priced/scheduled flights.
  });
  it("ranks and deduplicates merged provider offers, retaining their pair associations", async () => {
    search.mockImplementation(async (q) => ({
      offers: q.modes[0] === "flight" ? [offer(q, "travelpayouts:duplicate", 200), offer(q, `travelpayouts:${q.from.iata}-${q.to.iata}`, 100)] : [],
      errors: [], tookMs: 0,
    }));
    const result = await searchFromCoordinates(query, signal());
    expect(result.offers[0].price?.amount).toBe(100);
    expect(result.offers.filter((offer) => offer.id === "travelpayouts:duplicate")).toHaveLength(1);
    expect(result.offerPairs["travelpayouts:duplicate"].length).toBeGreaterThan(1);
    expect(result.estimates.every((id) => result.hubs.pairs.find((pair) => pair.id === id)?.mode !== "flight")).toBe(true);
  });
  it("does not call providers for unsupported ocean clicks", async () => {
    const result = await searchFromCoordinates({ ...query, from: { name: "Ocean", lat: 0, lng: -140 } }, signal());
    expect(search).not.toHaveBeenCalled();
    expect(result.hubs.from).toEqual([]);
    expect(result.offers).toEqual([]);
  });
  it("retains the raw bus adapter path when buses are requested", async () => {
    search.mockResolvedValue({ offers: [], errors: [], tookMs: 0 });
    await searchFromCoordinates({ ...query, modes: ["bus"] }, signal());
    expect(search).toHaveBeenCalledExactlyOnceWith({ ...query, modes: ["bus"] }, expect.any(AbortSignal));
  });
});
