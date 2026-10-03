import { z } from "zod";

import { roomsFor, type LiveStay } from "./duffel-map";
import { matches, nightsBetween } from "./search";
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
}) });

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
  const stay: LiveStay = {
    id: `liteapi:${hotel.id}`, name: hotel.name, city: query.city,
    lat: hotel.location.latitude, lng: hotel.location.longitude,
    kind: "hotel", stars: hotel.starRating as 2 | 3 | 4 | 5,
    bedsPerRoom: 2, rooms, total,
    pricePerNight: { amount: Math.round(total / rooms / nightsBetween(query.checkIn, query.checkOut) * 100) / 100, currency: "USD" },
    freshness: "live", source: "LiteAPI", sourceUrl: "https://liteapi.travel/",
    quote: { checkIn: query.checkIn, checkOut: query.checkOut, occupants: query.occupants, quotedAt, guestNationality: query.guestNationality },
  };
  return matches(stay, query.filter) ? stay : null;
}
