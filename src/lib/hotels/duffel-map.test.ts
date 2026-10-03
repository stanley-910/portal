import { describe, expect, it } from "vitest";

import { mapStays } from "./duffel-map";
import { rankStays } from "./search";

const query = { city: "Shanghai", lat: 31.23, lng: 121.47, checkIn: "2026-11-15", checkOut: "2026-11-17", occupants: 3, filter: 4 as const };
const result = (id: string, rating: number | null, total: string, lat = 31.235) => ({
  id,
  cheapest_rate_total_amount: total,
  cheapest_rate_currency: "CNY",
  accommodation: { name: `Hotel ${id}`, rating, location: { geographic_coordinates: { latitude: lat, longitude: 121.475 } } },
});

describe("mapStays", () => {
  it("keeps the asked star rating and derives a nightly price per room from the quoted total", () => {
    const stays = mapStays([result("a", 4, "2400.00"), result("b", 3, "900.00"), result("c", null, "500.00"), { id: "junk" }], query);
    expect(stays).toHaveLength(1);
    // 3 people → 2 rooms; 2 nights; 2400 / 2 / 2
    expect(stays[0]).toMatchObject({
      id: "duffel:a", stars: 4, rooms: 2, total: 2400, freshness: "live",
      pricePerNight: { amount: 600, currency: "CNY" },
    });
  });

  it("ranks live stays with the quoted total, not one rebuilt from the nightly price", () => {
    const [hotel] = rankStays(mapStays([result("a", 4, "2401.00")], query), query);
    expect(hotel).toMatchObject({ rooms: 2, nights: 2, totalPrice: { amount: 2401, currency: "CNY" } });
    expect(hotel).not.toHaveProperty("total");
  });
});
