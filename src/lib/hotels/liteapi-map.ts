import { z } from "zod";

import { roomsFor, type LiveStay } from "./duffel-map";
import { bookingUrl, matches, nightsBetween, typicalNightly, type CatalogStay } from "./search";
import type { HotelSearchQuery } from "./types";

// Official v3 rates / hotel detail schemas and examples are linked in findings/stays.md.
const money = z.object({ amount: z.number().finite().positive(), currency: z.literal("USD") });
const rate = z.object({
  occupancyNumber: z.number().int().positive(),
  adultCount: z.number().int().positive(),
  childCount: z.number().int().nonnegative(),
  retailRate: z.object({
    total: z.array(money).length(1),
    taxesAndFees: z.array(z.object({ included: z.boolean() })).optional(),
  }),
});
const offerSchema = z.object({
  offerId: z.string().min(1),
  offerRetailRate: money,
  suggestedSellingPrice: money.optional(),
  rates: z.array(rate).min(1),
});
export const liteRateHotelSchema = z.object({ hotelId: z.string().min(1), roomTypes: z.array(z.unknown()) });
export const liteResponseSchema = z.object({ data: z.array(z.unknown()), sandbox: z.boolean().optional() });
const detailSchema = z.object({ data: z.object({
  id: z.string().min(1), name: z.string().trim().min(1),
  starRating: z.number().int().min(2).max(5),
  hotelType: z.string(),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }),
  // the hotel's photos: a main one, and the gallery; anything that isn't an https URL is dropped, not the hotel
  main_photo: z.string().optional().catch(undefined),
  hotelImages: z.array(z.object({ url: z.string() }).catch({ url: "" })).optional().catch(undefined),
}) });

/** The hotel's main photo, else the first in its gallery, as long as it's served over https. */
const photoOf = (hotel: { main_photo?: string; hotelImages?: { url: string }[] }) =>
  [hotel.main_photo, ...(hotel.hotelImages ?? []).map((i) => i.url)].find((url) => !!url && /^https:\/\/\S+$/.test(url));

export const liteOccupancies = (occupants: number) => Array.from(
  { length: roomsFor(occupants) }, (_, i) => ({ adults: Math.min(2, occupants - 2 * i) }),
);

/** Never extrapolate a single room's price to a party or label sandbox inventory as live. */
export function mapLiteStay(raw: unknown, detail: unknown, query: HotelSearchQuery, quotedAt: string): LiveStay | null {
  const parsed = liteRateHotelSchema.safeParse(raw);
  const metadata = detailSchema.safeParse(detail);
  if (!parsed.success || !metadata.success || query.filter === "hostel") return null;
  const hotel = metadata.data.data;
  if (hotel.id !== parsed.data.hotelId || hotel.hotelType.toLowerCase() !== "hotel") return null;
  const requested = liteOccupancies(query.occupants);
  const totals: number[] = [];
  for (const rawOffer of parsed.data.roomTypes) {
    const offer = offerSchema.safeParse(rawOffer);
    if (!offer.success) continue;
    const { rates, offerRetailRate, suggestedSellingPrice } = offer.data;
    if (rates.length !== requested.length) continue;
    if (!requested.every((occupancy, i) => {
      const room = rates.filter((r) => r.occupancyNumber === i + 1);
      return room.length === 1 && room[0].adultCount === occupancy.adults && room[0].childCount === 0;
    })) continue;
    // The current card cannot itemise additional local charges: do not hide them in a misleading total.
    if (rates.some((r) => r.retailRate.taxesAndFees?.some((tax) => !tax.included))) continue;
    const roomTotal = rates.reduce((sum, r) => sum + r.retailRate.total[0].amount, 0);
    if (Math.abs(roomTotal - offerRetailRate.amount) > 0.02) continue;
    // Public rates must honour SSP; never advertise the net/discounted price below that floor.
    totals.push(Math.max(offerRetailRate.amount, suggestedSellingPrice?.amount ?? offerRetailRate.amount));
  }
  if (!totals.length) return null;
  const total = Math.min(...totals);
  const rooms = requested.length;
  const photoUrl = photoOf(hotel);
  const stay: LiveStay = {
    id: `liteapi:${hotel.id}`, name: hotel.name, city: query.city,
    lat: hotel.location.latitude, lng: hotel.location.longitude,
    kind: "hotel", stars: hotel.starRating as 2 | 3 | 4 | 5,
    ...(photoUrl ? { photoUrl } : {}),
    bedsPerRoom: 2, rooms, total,
    pricePerNight: { amount: Math.round(total / rooms / nightsBetween(query.checkIn, query.checkOut) * 100) / 100, currency: "USD" },
    freshness: "live", source: "LiteAPI", sourceUrl: "https://liteapi.travel/",
    quote: { checkIn: query.checkIn, checkOut: query.checkOut, occupants: query.occupants, quotedAt, guestNationality: query.guestNationality },
  };
  return matches(stay, query.filter) ? stay : null;
}

/** LiteAPI's hotel types for hostels; everything else it lists in a star search is a hotel. */
export const LITE_HOSTEL_TYPES = [203, 264];

const listedSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  hotelTypeId: z.number().int().optional(),
  stars: z.number().int().optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  main_photo: z.string().optional().catch(undefined),
  deletedAt: z.string().nullish(),
});

/**
 * A real hotel from LiteAPI's listings, without a rate for these dates: the place, its stars and photo are real, the
 * price is our typical one for its kind, so it shows as estimated and links to a search for it by name.
 */
export function mapLiteListing(raw: unknown, query: HotelSearchQuery): CatalogStay | null {
  const parsed = listedSchema.safeParse(raw);
  if (!parsed.success || parsed.data.deletedAt) return null;
  const h = parsed.data;
  const kind = h.hotelTypeId !== undefined && LITE_HOSTEL_TYPES.includes(h.hotelTypeId) ? "hostel" : "hotel";
  const stars = h.stars && h.stars >= 2 && h.stars <= 5 ? (h.stars as 2 | 3 | 4 | 5) : undefined;
  const photoUrl = photoOf(h);
  const stay: CatalogStay = {
    id: `liteapi:${h.id}`,
    name: h.name,
    city: query.city,
    lat: h.latitude,
    lng: h.longitude,
    kind,
    ...(kind === "hotel" && stars ? { stars } : {}),
    bedsPerRoom: kind === "hostel" ? 4 : 2,
    pricePerNight: { amount: typicalNightly(query.city, kind, stars), currency: "USD" },
    freshness: "estimated",
    ...(photoUrl ? { photoUrl } : {}),
    bookingUrl: bookingUrl({ city: query.city, place: h.name }, query.checkIn, query.checkOut, query.occupants),
    source: "LiteAPI listing", sourceUrl: "https://liteapi.travel/",
  };
  return matches(stay, query.filter) ? stay : null;
}
