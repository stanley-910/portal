import { describe, expect, it } from "vitest";
import type { Place } from "../types";
import { distanceKm } from "./gtfs/geo";
import { MAX_MATCH_KM, matchRadiusKm } from "./match-radius";

const at = (lat: number, lng: number): Place => ({ name: "p", lat, lng });
// Along the equator, 1 degree of longitude is ~111.2 km.
const trip = (km: number): [Place, Place] => [at(0, 0), at(0, km / 111.195)];

describe("matchRadiusKm", () => {
  it("keeps the floor for short trips", () => {
    const [a, b] = trip(50);
    expect(matchRadiusKm(a, b, 15)).toBe(15);
  });

  it("uses 20% of the click distance for mid trips", () => {
    const [a, b] = trip(250);
    expect(matchRadiusKm(a, b, 15)).toBeCloseTo(0.2 * distanceKm(a.lat, a.lng, b.lat, b.lng), 6);
    expect(matchRadiusKm(a, b, 15)).toBeCloseTo(50, 0);
  });

  it("caps at the station hub radius", () => {
    const [a, b] = trip(2000);
    expect(matchRadiusKm(a, b, 15)).toBe(MAX_MATCH_KM);
  });

  it("lets a floor above the cap win", () => {
    const [a, b] = trip(2000);
    expect(matchRadiusKm(a, b, 120)).toBe(120);
  });
});
