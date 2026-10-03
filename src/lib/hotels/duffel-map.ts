import { z } from "zod";

import { matches, nightsBetween, type CatalogStay } from "./search";
import type { HotelSearchQuery } from "./types";

/** Rooms for a group: two to a room, like the estimates. */
export const roomsFor = (occupants: number) => Math.ceil(occupants / 2);

const resultSchema = z.object({
  id: z.string().min(1),
  cheapest_rate_total_amount: z.string().regex(/^\d+(\.\d+)?$/),
  cheapest_rate_currency: z.string().regex(/^[A-Z]{3}$/),
  accommodation: z.object({
    name: z.string().trim().min(1),
    rating: z.number().int().nullish(),
    location: z.object({
      geographic_coordinates: z.object({ latitude: z.number(), longitude: z.number() }),
    }),
  }),
});

export type LiveStay = CatalogStay & { rooms: number; total: number };

/**
 * Duffel search results as stays the hotel tab ranks, filtered to the asked star rating. The quoted total is for every
 * room and night, so the nightly price per room is derived from it; results that don't parse are dropped one by one.
 */
export function mapStays(raw: readonly unknown[], query: HotelSearchQuery): LiveStay[] {
  const rooms = roomsFor(query.occupants);
  const nights = nightsBetween(query.checkIn, query.checkOut);
  const stays: LiveStay[] = [];
  for (const item of raw) {
    const parsed = resultSchema.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    const rating = r.accommodation.rating;
    const stars = rating && rating >= 2 && rating <= 5 ? (rating as 2 | 3 | 4 | 5) : undefined;
    const total = Number(r.cheapest_rate_total_amount);
    const stay: LiveStay = {
      id: `duffel:${r.id}`,
      name: r.accommodation.name,
      city: query.city,
      lat: r.accommodation.location.geographic_coordinates.latitude,
      lng: r.accommodation.location.geographic_coordinates.longitude,
      kind: "hotel",
      ...(stars ? { stars } : {}),
      bedsPerRoom: 2,
      pricePerNight: { amount: Math.round((total / nights / rooms) * 100) / 100, currency: r.cheapest_rate_currency },
      freshness: "live",
      rooms,
      total,
    };
    if (matches(stay, query.filter)) stays.push(stay);
  }
  return stays;
}
