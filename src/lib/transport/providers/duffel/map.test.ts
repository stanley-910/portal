import { describe, expect, it } from "vitest";

import offers from "./__fixtures__/offers.json";
import { mapOffers } from "./map";
import { withOffset } from "./time";
import type { SearchQuery } from "../../types";

const query: SearchQuery = {
  from: { name: "Hong Kong", lat: 22.3, lng: 113.9, iata: "HKG" },
  to: { name: "Shanghai", lat: 31.1, lng: 121.8, iata: "PVG" },
  date: "2026-11-15",
  modes: [],
  passengers: 1,
  currency: "USD",
};

describe("withOffset", () => {
  it("writes local clock times with the zone's offset, across DST", () => {
    expect(withOffset("2026-11-15T08:00:00", "Asia/Hong_Kong")).toBe("2026-11-15T08:00:00+08:00");
    expect(withOffset("2026-07-01T09:30", "Europe/London")).toBe("2026-07-01T09:30:00+01:00");
    expect(withOffset("2026-12-01T09:30:00", "Europe/London")).toBe("2026-12-01T09:30:00+00:00");
    expect(withOffset("2026-11-15T08:00:00+09:00", null)).toBe("2026-11-15T08:00:00+09:00");
  });
  it("gives null for a missing or unknown zone", () => {
    expect(withOffset("2026-11-15T08:00:00", null)).toBeNull();
    expect(withOffset("2026-11-15T08:00:00", "Mars/Olympus")).toBeNull();
  });
});

describe("mapOffers", () => {
  it("keeps live offers for the asked airports, cheapest first, operating airline up front", () => {
    const out = mapOffers(offers, query, "HKG", "PVG");
    expect(out.map((o) => o.id)).toEqual(["duffel:off_0000AoqGfP1mD0Kp3cHk2", "duffel:off_0000AoqGfP1mD0Kp3cHk1"]);
    const [eastern, cathay] = out;
    expect(eastern).toMatchObject({ provider: "duffel", kind: "live", price: { amount: 268, currency: "USD" } });
    expect(eastern.segments[0]).toMatchObject({ carrier: "Shanghai Airlines", number: "MU5062", durationMin: 140 });
    expect(eastern.attribution).toBe("Duffel — live fare from China Eastern; operated by Shanghai Airlines");
    expect(cathay.segments[0]).toMatchObject({
      depart: "2026-11-15T08:00:00+08:00",
      arrive: "2026-11-15T10:35:00+08:00",
      durationMin: 155,
      from: { name: "Hong Kong", iata: "HKG", country: "HK", lat: 22.308 },
    });
  });
  it("prices per passenger and drops offers on another day", () => {
    expect(mapOffers(offers, { ...query, passengers: 2 }, "HKG", "PVG")[0].price?.amount).toBe(134);
    expect(mapOffers(offers, { ...query, date: "2026-11-16" }, "HKG", "PVG")).toEqual([]);
  });
});
