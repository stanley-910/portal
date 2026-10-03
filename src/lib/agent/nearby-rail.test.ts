import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env.server", () => ({ env: {} }));
import { searchNearbyRail } from "./nearby-rail";
import { agentTools, type ToolContext } from "./tools";
import { handlesFor, type PlanJson } from "./snapshot";
import { createChinaRailProvider } from "@/lib/transport/providers/china-rail";
import type { Seed } from "@/lib/transport/providers/china-rail/schema";
import type { Offer, SearchQuery } from "@/lib/transport/types";
import type { searchFromCoordinates } from "@/lib/transport/hub-search";

const from = { name: "Origin", lat: 0, lng: 0 };
const to = { name: "Destination", lat: 0, lng: 10 };
const query: SearchQuery = { from, to, date: "2027-05-01", modes: [], passengers: 1, currency: "CNY" };
const prefs = { radius_km: 100, currency: "CNY", max_fare: 200 };
const signal = () => new AbortController().signal;
function offer(id: string, lng: number, amount?: number, currency = "CNY"): Offer {
  return { id, provider: "china-rail", mode: "train", kind: "timetable",
    price: amount === undefined ? undefined : { amount, currency }, attribution: "Published test timetable",
    segments: [{ mode: "train", from: { ...from, name: id, lng }, to, depart: "2027-05-01T10:00:00+08:00", arrive: "2027-05-01T15:00:00+08:00", durationMin: 300 }] };
}
const searchWith = (offers: Offer[]) => vi.fn(async () => ({ offers, errors: [] })) as unknown as typeof searchFromCoordinates;

describe("nearby rail for Pip", () => {
  it("finds a service in an adjacent city even when the nearest city has no route", async () => {
    const station = (city: string, lng: number) => ({ city, name: city, nameLocal: city, country: "CN", lat: 0, lng, source: "https://example.com" });
    const seed = { checked: "2026-10-04", stations: { nearest: station("nearest", 0), adjacent: station("adjacent", 0.3), destination: station("destination", 10) },
      trains: [{ from: "adjacent", to: "destination", number: "G1", departures: ["10:00"], durationMin: 300, tz: "Asia/Shanghai", source: "https://example.com" }] } as Seed;
    const provider = createChinaRailProvider(seed);
    expect(provider.covers({ ...query, modes: ["train"] })).toBe(true);
    const offers = await provider.search(query, signal());
    expect(offers[0].segments[0].from.name).toBe("adjacent");
    const result = await searchNearbyRail(query, prefs, signal(), searchWith(offers));
    expect(result.options[0].accessDistanceKm).toBeGreaterThan(30);
    expect(result.options[0].railFareBudget).toBe("unknown");
  });
  it("compares rail fares only, retaining unknown and foreign-currency alternatives", async () => {
    const result = await searchNearbyRail(query, prefs, signal(), searchWith([
      offer("expensive", 0.1, 250), offer("cheap", 0.2, 100), offer("unknown", 0.3), offer("foreign", 0.4, 10, "USD"),
    ]));
    expect(result.options[0].id).toBe("cheap");
    expect(result.options.find((o) => o.id === "cheap")?.railFareBudget).toBe("within_rail_fare_budget");
    expect(result.options.find((o) => o.id === "expensive")?.railFareBudget).toBe("over_rail_fare_budget");
    for (const id of ["unknown", "foreign"]) expect(result.options.find((o) => o.id === id)?.railFareBudget).toBe("unknown");
    expect(result.options.every((o) => o.transferCost === null && o.doorToDoorCost === null)).toBe(true);
  });
  it("respects both access radii and avoids returning only departures of the same station pair", async () => {
    const farEnd = offer("far-end", 0.1); farEnd.segments[0].to = { ...to, lng: 12 };
    const result = await searchNearbyRail(query, { ...prefs, radius_km: 50 }, signal(), searchWith([
      offer("near", 0.1, 100), offer("same-pair", 0.1, 150), offer("far-start", 1, 80), farEnd,
    ]));
    expect(result.options.map((o) => o.id)).toEqual(["near"]);
  });
  it("finds real cached China trains from nearby coordinates on a future demo date", async () => {
    const result = await searchNearbyRail({ ...query,
      from: { name: "Langfang", lat: 39.52, lng: 116.70 },
      to: { name: "Kunshan", lat: 31.38, lng: 120.98 },
    }, prefs, signal());
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.some((o) => /Beijing|北京/.test(o.from.name) && /Shanghai|上海/.test(o.to.name))).toBe(true);
    expect(result.options.every((o) => o.railFareBudget === "unknown")).toBe(true);
  });
});


describe("current China corridor coverage", () => {
  const cities: Record<string, [number, number]> = { Beijing: [39.9042,116.4074], Shanghai: [31.2304,121.4737], Hangzhou: [30.2741,120.1551], Xian: [34.3416,108.9398], Guangzhou: [23.1291,113.2644], Shenzhen: [22.5431,114.0579], HK: [22.3193,114.1694] };
  const both = [["Beijing","Shanghai"],["Beijing","Hangzhou"],["Beijing","Xian"],["Shanghai","Hangzhou"],["Guangzhou","Shenzhen"],["HK","Shenzhen"],["HK","Guangzhou"],["HK","Shanghai"],["HK","Beijing"],["HK","Hangzhou"]];
  const pairs = [...both, ...both.map(([a,b]) => [b,a]), ["Guangzhou","Beijing"], ["Shenzhen","Beijing"]];
  it.each(pairs)("returns a station-level service for %s → %s", async (a,b) => {
    const point = (name: string) => ({ name, lat: cities[name][0], lng: cities[name][1] });
    // Two weekdays cover the published sleeper's different operating patterns.
    const results = await Promise.all(["2027-05-04","2027-05-07"].map((date) => searchNearbyRail({ ...query, from: point(a), to: point(b), date }, { ...prefs, radius_km: 30 }, signal())));
    expect(results.some((r) => r.options.length > 0)).toBe(true);
  });
});


it("lets shared-trip Pip search an existing leg without changing it", async () => {
  const plan: PlanJson = { stops: {
    a: { name: "Langfang", lat: 39.52, lng: 116.70, hub: null, code: null },
    b: { name: "Kunshan", lat: 31.38, lng: 120.98, hub: null, code: null },
  }, legs: { leg: { from: "a", to: "b", date: "2027-05-01", createdBy: "m", riders: ["m"], search: { id: "s", status: "done", offers: [] }, votes: {}, chosen: null, createdAt: 1 } } };
  const original = JSON.stringify(plan);
  const ctx: ToolContext = { roomId: "test", agentId: "pip", today: "2026-10-04", askedBy: "m", load: async () => ({ plan, handles: handlesFor(plan) }), addCard: vi.fn(), activity: vi.fn(), marks: vi.fn(), markMeetup: vi.fn(), meetups: new Map(), until: Date.now() + 20_000 };
  const result = await agentTools(ctx).search_nearby_trains.execute!({ leg: "L1", ...prefs }, { toolCallId: "nearby", messages: [], context: {} });
  expect(result).toMatchObject({ from: { name: "Langfang" }, to: { name: "Kunshan" }, options: expect.arrayContaining([expect.objectContaining({ date: "2027-05-01", railFareBudget: "unknown" })]) });
  expect(JSON.stringify(plan)).toBe(original);
  expect(ctx.addCard).not.toHaveBeenCalled();
});


describe("PR 21 geocoding reaches Pip rail search", () => {
  it.each([
    ["Nagoya", 35.1709, 136.8815, "Tokyo", 35.6812, 139.7671],
    ["Hakata", 33.5902, 130.4207, "Kumamoto", 32.7897, 130.6887],
    ["Bangkok", 13.804, 100.54, "Chiang Mai", 18.783, 99.016],
    ["Da Nang", 16.071, 108.209, "Hanoi", 21.024, 105.841],
  ])("returns cached schedules for %s to %s", async (a, lat1, lng1, b, lat2, lng2) => {
    const result = await searchNearbyRail({ ...query, date: "2026-11-15", from: { name: a, lat: lat1, lng: lng1 }, to: { name: b, lat: lat2, lng: lng2 } }, { ...prefs, radius_km: 60 }, signal());
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.some((o) => o.source.includes("jr-central") || o.source.includes("jr-kyushu") || o.source.includes("thailand") || o.source.includes("vietnam"))).toBe(true);
  });
});
