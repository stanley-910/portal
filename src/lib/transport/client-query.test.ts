import { describe, expect, it } from "vitest";

import type { LandedTrip } from "@/components/trip-globe";
import { clickSearchParams, localDate } from "./client-query";

const trip: LandedTrip = {
  from: { id: "airport:HKG", mode: "flight", name: "Hong Kong International", code: "HKG", iata: "HKG", city: "Hong Kong", lat: 22.31, lng: 113.92, importance: 3, source: "https://ourairports.com/data/" },
  to: { id: "airport:PVG", mode: "flight", name: "Shanghai Pudong", code: "PVG", iata: "PVG", city: "Shanghai", lat: 31.14, lng: 121.81, importance: 3, source: "https://ourairports.com/data/" },
  origin: { lat: 22.3049, lng: 114.165 },
  destination: { lat: 31.23, lng: 121.47 },
  departDate: new Date(2026, 9, 3, 0, 15),
  distanceKm: 1250,
};

describe("globe click search", () => {
  it("sends unsnapped coordinates, never local preview hub codes", () => {
    const params = clickSearchParams(trip);
    expect(JSON.parse(params.get("from")!)).toEqual({ name: "Origin", ...trip.origin });
    expect(JSON.parse(params.get("to")!)).toEqual({ name: "Destination", ...trip.destination });
    expect(params.get("resolve")).toBe("hubs");
    expect(params.get("modes")).toBe("flight,train,bus,ferry");
  });
  it("still searches coordinates when takeoff and landing have no nearby hubs", () => {
    const params = clickSearchParams({ ...trip, from: null, to: null });
    expect(JSON.parse(params.get("from")!)).toEqual({ name: "Origin", ...trip.origin });
  });
  it("formats local calendar fields rather than slicing an ISO UTC date", () => {
    expect(localDate(trip.departDate)).toBe("2026-10-03");
  });
});
