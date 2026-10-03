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
    expect(eastern.segments[0]).toMatchObject({ carrier: "Shanghai Airlines", carrierCode: "FM", number: "MU5062", durationMin: 140 });
    expect(eastern.attribution).toBe("Duffel — live fare from China Eastern; operated by Shanghai Airlines");
    expect(cathay.segments[0]).toMatchObject({
      depart: "2026-11-15T08:00:00+08:00",
      arrive: "2026-11-15T10:35:00+08:00",
      durationMin: 155,
      from: { name: "Hong Kong", iata: "HKG", country: "HK", lat: 22.308 },
    });
  });
  it("takes the logo's airline code from the airline it names, and none when that airline has no code", () => {
    expect(mapOffers(offers, query, "HKG", "PVG")[1].segments[0].carrierCode).toBe("CX");
    const input = validFixture();
    input.slices[0].segments[0] = { ...input.slices[0].segments[0], operating_carrier: { name: "Cathay Pacific", iata_code: null } } as never;
    const [offer] = mapOffers([input], query, "HKG", "PVG");
    expect(offer.segments[0].carrier).toBe("Cathay Pacific");
    expect(offer.segments[0]).not.toHaveProperty("carrierCode");
  });
  it("prices per passenger and drops offers on another day", () => {
    expect(mapOffers(offers, { ...query, passengers: 2 }, "HKG", "PVG")[0].price?.amount).toBe(134);
    expect(mapOffers(offers, { ...query, date: "2026-11-16" }, "HKG", "PVG")).toEqual([]);
  });
});

function validFixture() {
  const input = structuredClone(offers[0]);
  if (!input.slices) throw new Error("Recorded fixture must contain slices");
  return { ...input, slices: input.slices.map((slice) => ({ ...slice, segments: [...slice.segments] })) };
}

// Controlled mutations of the recorded provider fixture exercise timezone and connection failure cases.
describe("long-haul offers", () => {
  it("flags Duffel test inventory as a bookable sandbox fare", () => {
    const input = validFixture();
    const [out] = mapOffers([{ ...input, live_mode: false }], query, "HKG", "PVG");
    expect(out.kind).toBe("live");
    expect(out.sandbox).toBe(true);
    expect(out.attribution).toContain("sandbox");
    const [live] = mapOffers([{ ...input, live_mode: true }], query, "HKG", "PVG");
    expect(live.sandbox).toBeUndefined();
  });
  it("keeps overnight local dates and measures duration in UTC", () => {
    const input = validFixture();
    const segment = input.slices[0].segments[0];
    segment.departing_at = "2026-11-15T23:00:00";
    segment.arriving_at = "2026-11-16T05:00:00";
    segment.destination = { ...segment.destination, iata_code: "LHR", time_zone: "Europe/London", city_name: "London" };
    const [out] = mapOffers([input], { ...query, to: { ...query.to, iata: "LHR" } }, "HKG", "LHR");
    expect(out.segments[0]).toMatchObject({ arrive: "2026-11-16T05:00:00+00:00", durationMin: 840 });
  });
  it("rejects a connection departing before arrival or at a disconnected airport", () => {
    const input = validFixture();
    const first = input.slices[0].segments[0];
    const second = structuredClone(first);
    second.origin = { ...first.destination };
    second.destination = { ...first.destination, iata_code: "LHR", time_zone: "Europe/London" };
    second.departing_at = first.departing_at;
    second.arriving_at = "2026-11-16T05:00:00";
    input.slices[0].segments.push(second);
    expect(mapOffers([input], query, "HKG", "LHR")).toEqual([]);
    second.departing_at = "2026-11-15T18:00:00";
    expect(mapOffers([input], query, "HKG", "LHR")).toHaveLength(1);
    second.origin.iata_code = "SHA";
    expect(mapOffers([input], query, "HKG", "LHR")).toEqual([]);
  });
});
