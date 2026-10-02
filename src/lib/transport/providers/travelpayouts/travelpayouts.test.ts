import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/prices_for_dates.json";
import { estimateFlight } from "./estimate";
import { aviasalesUrl } from "./links";
import { mapFlights } from "./map";
import { toIata } from "./places";
import { localIso, zoneOf } from "./timezones";
import type { SearchQuery } from "../../types";

const query: SearchQuery = {
  from: { name: "Hong Kong", lat: 22.31, lng: 113.92, iata: "HKG" },
  to: { name: "Bangkok", lat: 13.75, lng: 100.5 },
  date: "2026-11-15",
  modes: ["flight"],
  passengers: 1,
  currency: "USD",
};

describe("Travelpayouts adapter", () => {
  it("maps the documented fixture to a cached offer", () => {
    const offers = mapFlights(fixture.data, query);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "travelpayouts:HKG-BKK-2026-11-15T09:00:00+08:00-765",
      kind: "cached",
      price: { amount: 120, currency: "USD" },
      transfers: 0,
      segments: [{
        carrier: "HX",
        number: "HX765",
        durationMin: 165,
        arrive: "2026-11-15T10:45:00+07:00",
      }],
    });
  });

  it("keeps the transfer count of a connecting fare", () => {
    const [offer] = mapFlights([{ ...fixture.data[0], transfers: 1 }], query);
    expect(offer.transfers).toBe(1);
    expect(offer.segments).toHaveLength(1);
  });

  it("maps an empty data array to no offers", () => {
    expect(mapFlights([], query)).toEqual([]);
  });

  it("resolves explicit and nearby places to city codes", () => {
    expect(toIata(query.from)).toBe("HKG");
    expect(toIata(query.to)).toBe("BKK");
    expect(toIata({ name: "Pacific", lat: 0, lng: 0 })).toBeNull();
  });

  it("prefixes relative links and appends a marker only once", () => {
    const url = aviasalesUrl("/search/HKG1511BKK15111", "generic");
    expect(url).toBe("https://www.aviasales.com/search/HKG1511BKK15111?marker=generic");
    expect(aviasalesUrl(`${url}&marker=generic`, "generic")).toBe(url);
    expect(aviasalesUrl("/search/HKG1511BKK15111")).toBe("https://www.aviasales.com/search/HKG1511BKK15111");
  });

  it("writes arrivals in the destination's local time, or UTC for an airport it doesn't know", () => {
    const ms = Date.parse("2026-11-15T03:45:00Z");
    expect(localIso(ms, zoneOf("BKK"))).toBe("2026-11-15T10:45:00+07:00");
    expect(localIso(ms, zoneOf("HND"))).toBe("2026-11-15T12:45:00+09:00");
    expect(localIso(ms, zoneOf("KTM"))).toBe("2026-11-15T09:30:00+05:45");
    expect(zoneOf("XXX")).toBeNull();
    expect(localIso(ms, null)).toBe("2026-11-15T03:45:00.000Z");
  });

  it("estimates a flight from distance, marked estimated, with a search link", () => {
    const [offer] = estimateFlight(query, "HKG", "BKK", "generic");
    expect(offer).toMatchObject({
      kind: "estimated",
      mode: "flight",
      price: { currency: "USD" },
      bookingUrl: "https://www.aviasales.com/search/HKG1511BKK1?marker=generic",
    });
    // HKG–BKK is about 1,700 km: roughly 2 h 50 in the air plus overhead
    expect(offer.segments[0].durationMin).toBeGreaterThan(150);
    expect(offer.segments[0].durationMin).toBeLessThan(200);
  });

  it("doesn't estimate a flight for a short hop", () => {
    const near = { ...query, to: { name: "Shenzhen", lat: 22.64, lng: 113.81 } };
    expect(estimateFlight(near, "HKG", "SZX")).toEqual([]);
  });
});
