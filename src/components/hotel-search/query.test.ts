import { describe, expect, it } from "vitest";

import { searchHotels } from "@/lib/hotels/search";
import type { HotelSearchQuery } from "@/lib/hotels/types";
import { hotelQueryKey, resultForHotelQuery } from "./query";

const query: HotelSearchQuery = { city: "Tokyo", lat: 35.68, lng: 139.69, checkIn: "2027-01-15", checkOut: "2027-01-18", occupants: 2, filter: 4, guestNationality: "HK" };
const previous = { queryKey: hotelQueryKey(query), hotels: searchHotels(query), status: "done" as const };

describe("hotel result scope while another request is pending", () => {
  it.each<Partial<HotelSearchQuery>>([
    { guestNationality: "US" }, { guestNationality: undefined }, { occupants: 4 },
    { checkIn: "2027-01-16" }, { checkOut: "2027-01-19" }, { filter: "hostel" },
    { city: "Shanghai" }, { lat: 31.23 }, { lng: 121.47 },
  ])("never renders/selects a prior quote after changing %j", (change) => {
    const currentKey = hotelQueryKey({ ...query, ...change });
    expect(resultForHotelQuery(currentKey, previous)).toEqual({ hotels: [], status: "searching" });
    // An old request finishing late also cannot populate the new query's results.
    expect(resultForHotelQuery(currentKey, { ...previous, status: "failed" })).toEqual({ hotels: [], status: "searching" });
    expect(resultForHotelQuery(currentKey, { ...previous, queryKey: currentKey }).hotels).toEqual(previous.hotels);
  });
  it("hides rows if dates become invalid and preserves a matching result", () => {
    expect(resultForHotelQuery(hotelQueryKey({ ...query, checkOut: query.checkIn }), previous).hotels).toEqual([]);
    expect(resultForHotelQuery(previous.queryKey, previous)).toBe(previous);
  });
  it("uses exactly the requested scope in the search URL, omitting absent nationality", () => {
    expect(new URLSearchParams(previous.queryKey).get("guestNationality")).toBe("HK");
    expect(new URLSearchParams(hotelQueryKey({ ...query, guestNationality: undefined })).has("guestNationality")).toBe(false);
  });
});
