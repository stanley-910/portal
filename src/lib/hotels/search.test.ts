import { describe, expect, it } from "vitest";

import { searchHotels } from "./search";

const query = (filter: "hostel" | 2 | 3 | 4 | 5, occupants = 4) => ({
  city: "Shanghai",
  lat: 31.22,
  lng: 121.43,
  checkIn: "2026-10-04",
  checkOut: "2026-10-07",
  occupants,
  filter,
});

describe("hotel search", () => {
  it("filters by stars and calculates rooms and total nights", () => {
    const [hotel] = searchHotels(query(4));
    expect(hotel.stars).toBe(4);
    expect(hotel.rooms).toBe(2);
    expect(hotel.nights).toBe(3);
    expect(hotel.totalPrice.amount).toBe(hotel.pricePerNight.amount * 2 * 3);
  });

  it("supports four-person hostel occupancy in one room", () => {
    const [hostel] = searchHotels(query("hostel"));
    expect(hostel.kind).toBe("hostel");
    expect(hostel.rooms).toBe(1);
    expect(hostel.bedsPerRoom).toBe(4);
  });

  it("generates estimated fallback data for another selected city", () => {
    const [hotel] = searchHotels({ ...query(2), city: "Beijing", lat: 39.93, lng: 116.39 });
    expect(hotel.city).toBe("Beijing");
    expect(hotel.freshness).toBe("estimated");
  });

  it("measures distance from the city centre, not the searched point", () => {
    // Pudong airport, about 30 km out
    const [hotel] = searchHotels({ ...query(4), lat: 31.14, lng: 121.8 });
    expect(hotel.distanceKm).toBeLessThan(5);
  });

  it("names fallback stays by kind, not as made-up properties", () => {
    const [hotel] = searchHotels({ ...query(3), city: "Beijing", lat: 39.93, lng: 116.39 });
    expect(hotel.name).toBe("3★ hotel near the centre");
  });
});
