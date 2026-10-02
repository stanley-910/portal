import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/prices_for_dates.json";
import { aviasalesUrl } from "./links";
import { mapFlights } from "./map";
import { toIata } from "./places";
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
      segments: [{
        carrier: "HX",
        number: "HX765",
        durationMin: 165,
        arrive: "2026-11-15T03:45:00.000Z",
      }],
    });
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
});
