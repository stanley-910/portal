import { describe, expect, it } from "vitest";

import { isPast, libraryTripOf, statsOf, travelled } from "./library";

const stop = (name: string, code: string, lat: number, lng: number) => ({ name, code, lat, lng, hub: null });
const offer = (id: string, mode: string) => ({ id, mode, price: { amount: 100, currency: "USD" }, kind: "estimated" });
const leg = (from: string, to: string, date: string, riders: string[], mode = "flight", createdBy = riders[0]) => ({
  from,
  to,
  date,
  riders,
  createdBy,
  createdAt: 1,
  chosen: "o1",
  votes: {},
  search: { id: "s", status: "done", offers: [offer("o1", mode)] },
});

const plan = {
  members: { mei: { name: "Mei", color: 2 }, kit: { name: "Kit", color: 1 } },
  stops: {
    hkg: stop("Hong Kong", "HKG", 22.3, 114.17),
    sha: stop("Shanghai", "SHA", 31.2, 121.32),
    tyo: stop("Tokyo", "TYO", 35.68, 139.77),
  },
  legs: {
    b: leg("sha", "tyo", "2026-10-19", ["mei", "kit"]),
    a: leg("hkg", "sha", "2026-10-16", ["mei", "kit"], "train", "kit"),
    // a leg that lost its stop drops out rather than breaking the trip
    gone: leg("hkg", "nowhere", "2026-10-20", ["kit"]),
  },
};

const input = { id: "t1", title: "Shanghai meet-up", owner: true, updatedAt: "2026-10-04T00:00:00Z", plan, present: new Set(["kit"]) };

describe("libraryTripOf", () => {
  it("reads legs in travel order with their stops, mode and riders, and members with presence, you first", () => {
    const trip = libraryTripOf(input, "mei");
    expect(trip.legs.map((l) => `${l.from.code}-${l.to.code}`)).toEqual(["HKG-SHA", "SHA-TYO"]);
    expect(trip.legs[0]).toMatchObject({ mode: "train", by: "kit", date: "2026-10-16" });
    expect(trip.legs[0].from.country).toBe("HK");
    expect(trip.members).toEqual([
      { id: "mei", name: "Mei", slot: 1, present: false, you: true },
      { id: "kit", name: "Kit", slot: 0, present: true, you: false },
    ]);
    expect(trip.share.USD).toBeGreaterThan(0);
  });

  it("never throws on a garbled plan", () => {
    for (const garbage of [null, "x", 3, { legs: "no", stops: [] }, { legs: { a: { from: 1 } } }]) {
      const trip = libraryTripOf({ ...input, plan: garbage }, "mei");
      expect(trip.legs).toEqual([]);
      expect(trip.share).toEqual({});
    }
  });
});

describe("stats", () => {
  it("counts your legs: distance, cities, countries, nights, a rough time in transit and the modes", () => {
    const trip = libraryTripOf(input, "mei");
    const s = statsOf(trip, "mei");
    expect(s).toMatchObject({ legs: 2, cities: 3, countries: 3, nights: 3, modes: ["train", "flight"] });
    expect(s.km).toBeGreaterThan(2500);
    expect(s.hours).toBeGreaterThan(0);
  });

  it("counts only trips already taken in the lifetime totals", () => {
    const trip = libraryTripOf(input, "mei");
    expect(isPast(trip, "2026-10-04")).toBe(false);
    expect(travelled([trip], "mei", "2026-10-04")).toEqual({ km: 0, countries: 0, trips: 0 });
    expect(travelled([trip], "mei", "2026-11-01").trips).toBe(1);
  });
});
