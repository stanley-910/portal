import type { HotelResult, HotelSearchQuery } from "@/lib/hotels/types";

/** The request URL is also the identity of its result, including nationality and occupancy. */
export function hotelQueryKey(query: HotelSearchQuery): string {
  if (!query.checkIn || !query.checkOut || query.checkOut <= query.checkIn) return "";
  const params = new URLSearchParams({
    city: query.city, lat: String(query.lat), lng: String(query.lng),
    checkIn: query.checkIn, checkOut: query.checkOut,
    occupants: String(query.occupants), filter: String(query.filter),
  });
  if (query.guestNationality) params.set("guestNationality", query.guestNationality);
  return params.toString();
}

export type HotelSearchResult = { queryKey: string; hotels: HotelResult[]; status: "done" | "failed" };

/** Hide the previous request immediately on render, before the new effect/fetch has started. */
export function resultForHotelQuery(queryKey: string, result: HotelSearchResult | null): {
  hotels: HotelResult[]; status: "idle" | "searching" | "done" | "failed";
} {
  return queryKey && result?.queryKey === queryKey ? result : { hotels: [], status: queryKey ? "searching" : "idle" };
}
