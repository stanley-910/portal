import { describe, expect, it } from "vitest";

import { CONNECTIONS, HUBS, HUB_LIMITS, distanceKm, nearbyHubs, resolveHubs } from "./resolve";
import type { Hub, SeedConnection } from "./types";

const point = (lat: number, lng: number) => ({ name: "Click", lat, lng });
const airport = (code: string, lat: number, lng: number): Hub => ({
  id: `airport:${code}`, code, iata: code, name: code, city: code, country: "CN", mode: "flight",
  lat, lng, importance: 2, source: "https://ourairports.com/data/",
});

describe("bundled hub integrity", () => {
  it("has broad airport coverage and unique stable hub IDs", () => {
    expect(HUBS.filter((hub) => hub.mode === "flight").length).toBeGreaterThan(300);
    expect(new Set(HUBS.map((hub) => hub.country)).size).toBeGreaterThan(30);
    expect(new Set(HUBS.map((hub) => hub.id)).size).toBe(HUBS.length);
    expect(HUBS.some((hub) => hub.mode === "train")).toBe(true);
    expect(HUBS.some((hub) => hub.mode === "ferry")).toBe(true);
  });
  it("keeps usable coordinates, sources, and connection references", () => {
    const byId = new Map(HUBS.map((hub) => [hub.id, hub]));
    for (const hub of HUBS) {
      expect(hub.lat).toBeGreaterThanOrEqual(-90);
      expect(hub.lat).toBeLessThanOrEqual(90);
      expect(hub.lng).toBeGreaterThanOrEqual(-180);
      expect(hub.lng).toBeLessThanOrEqual(180);
      expect(hub.source).toMatch(/^https:\/\//);
      expect(hub.name.length).toBeGreaterThan(0);
      if (hub.mode === "flight") expect(hub.iata).toMatch(/^[A-Z]{3}$/);
    }
    for (const edge of CONNECTIONS) {
      expect(byId.get(edge.from)?.mode).toBe(edge.mode);
      expect(byId.get(edge.to)?.mode).toBe(edge.mode);
      expect(edge.durationMin).toBeGreaterThan(0);
      expect(edge.source).toMatch(/^https:\/\//);
    }
  });
});

describe("coordinate resolution", () => {
  it("measures safely across the date line and at antipodes", () => {
    expect(distanceKm(point(0, 179), point(0, -179))).toBeCloseTo(222.39, 1);
    expect(distanceKm(point(0, 0), point(0, 180))).toBeCloseTo(Math.PI * 6371, 5);
    expect(distanceKm(point(22, 114), point(22, 114))).toBe(0);
  });
  it("rejects invalid geographic input", () => {
    expect(() => nearbyHubs(point(91, 0))).toThrow(RangeError);
    expect(() => nearbyHubs(point(NaN, 0))).toThrow(RangeError);
  });
  it("returns no distant fallback for an ocean or out-of-coverage click", () => {
    const result = resolveHubs(point(0, -140), point(51.5, -0.1));
    expect(result.from).toEqual([]);
    expect(result.to.some((candidate) => candidate.hub.iata === "LHR")).toBe(true);
    expect(result.pairs).toEqual([]);
  });
  it.each([["HKG", "LHR"], ["HND", "SFO"], ["SIN", "SYD"], ["JFK", "CDG"]])("resolves global flight pair %s–%s", (from, to) => {
    const a = HUBS.find((hub) => hub.iata === from)!;
    const b = HUBS.find((hub) => hub.iata === to)!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const result = resolveHubs(a, b, ["flight"]);
    expect(result.pairs.some((pair) => pair.from.hub.iata === from && pair.to.hub.iata === to)).toBe(true);
    expect(result.pairs.length).toBeLessThanOrEqual(HUB_LIMITS.flightPairs);
  });
  it("keeps actual clicks and bounds flight pair fan-out", () => {
    const origin = point(22.305, 114.165);
    const destination = point(31.23, 121.47);
    const result = resolveHubs(origin, destination);
    expect(result.origin).toEqual(origin);
    expect(result.destination).toEqual(destination);
    expect(result.from.some((candidate) => candidate.hub.iata === "HKG")).toBe(true);
    expect(result.to.some((candidate) => candidate.hub.iata === "SHA")).toBe(true);
    expect(result.pairs.filter((pair) => pair.mode === "flight").length).toBeLessThanOrEqual(HUB_LIMITS.flightPairs);
    expect(result.pairs.some((pair) => pair.mode === "train")).toBe(true);
    for (const pair of result.pairs) {
      expect(pair.from.hub.id).not.toBe(pair.to.hub.id);
      expect(result.from.some((candidate) => candidate.hub.id === pair.from.hub.id)).toBe(true);
      expect(result.to.some((candidate) => candidate.hub.id === pair.to.hub.id)).toBe(true);
    }
  });
  it("does not offer a rail detour through Shenzhen/Guangzhou for Hong Kong–Macau", () => {
    const result = resolveHubs(point(22.287, 114.151), point(22.197, 113.558));
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.pairs.every((pair) => pair.mode === "ferry")).toBe(true);
  });
  it("preserves explicit SHA rather than substituting the Shanghai city/PVG airport", () => {
    const result = resolveHubs({ ...point(31.2, 121.4), iata: "sha" }, point(35.7, 139.7), ["flight"]);
    expect(result.from.map((candidate) => candidate.hub.iata)).toEqual(["SHA"]);
    expect(result.pairs.every((pair) => pair.from.hub.iata === "SHA")).toBe(true);
  });
  it("keeps a snapped end to exactly its hub, in its mode only", () => {
    const sea = HUBS.find((hub) => hub.iata === "SEA")!;
    const unsnapped = resolveHubs(point(sea.lat, sea.lng), point(35.7, 139.7));
    expect(unsnapped.from.filter((c) => c.hub.mode === "flight").length).toBeGreaterThan(1);
    const result = resolveHubs({ ...point(sea.lat, sea.lng), snap: sea.id }, point(35.7, 139.7));
    expect(result.from.map((candidate) => candidate.hub.id)).toEqual([sea.id]);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.pairs.every((pair) => pair.from.hub.id === sea.id && pair.mode === "flight")).toBe(true);
    expect(resolveHubs({ ...point(sea.lat, sea.lng), snap: sea.id }, point(35.7, 139.7), ["train"]).from).toEqual([]);
  });
  it("finds no pair for ends snapped to different modes, and ignores an unknown snap", () => {
    const hkg = HUBS.find((hub) => hub.iata === "HKG")!;
    const hongqiao = HUBS.find((hub) => hub.id === "train:SHANGHAI-HONGQIAO")!;
    expect(resolveHubs({ ...point(hkg.lat, hkg.lng), snap: hkg.id }, { ...point(hongqiao.lat, hongqiao.lng), snap: hongqiao.id }).pairs).toEqual([]);
    const unknown = resolveHubs({ ...point(hkg.lat, hkg.lng), snap: "airport:ZZZ" }, point(hongqiao.lat, hongqiao.lng));
    expect(unknown.from.length).toBeGreaterThan(1);
  });
  it("does not invent a flight for a short local hop or the same airport", () => {
    expect(resolveHubs(point(22.30, 114.16), point(22.31, 114.17), ["flight"]).pairs).toEqual([]);
  });
  it("requires a seed edge for surface connectivity, not just matching station modes", () => {
    const hubs: Hub[] = [
      { ...airport("AAA", 0, 0), id: "rail:a", mode: "train" },
      { ...airport("BBB", 0, 10), id: "rail:b", mode: "train" },
    ];
    expect(resolveHubs(point(0, 0), point(0, 10), [], hubs, []).pairs).toEqual([]);
    const edges: SeedConnection[] = [{ from: "rail:a", to: "rail:b", mode: "train", durationMin: 300, source: "https://example.com" }];
    expect(resolveHubs(point(0, 10), point(0, 0), [], hubs, edges).pairs).toEqual([]);
    const pair = resolveHubs(point(0, 0), point(0, 10), [], hubs, edges).pairs[0];
    expect(pair.evidence).toBe("bundled-connection");
    expect(pair.from.hub.id).toBe("rail:a");
    expect(pair.estimatedDurationMin).toBe(300);
  });
  it("is stable when input order changes and respects mode filters", () => {
    const hubs = [airport("AAA", 0, -0.1), airport("BBB", 0, 0.1), airport("CCC", 0, 10)];
    const result = resolveHubs(point(0, 0), point(0, 10), ["flight"], hubs, []);
    const reversed = resolveHubs(point(0, 0), point(0, 10), ["flight"], [...hubs].reverse(), []);
    expect(reversed).toEqual(result);
    expect(result.pairs.every((pair) => pair.evidence === "geographic-candidate")).toBe(true);
    expect(resolveHubs(point(0, 0), point(0, 10), ["bus"], hubs, []).pairs).toEqual([]);
  });
});
