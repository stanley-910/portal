import "server-only";

import { env } from "@/lib/env.server";
import { iso2 } from "@/lib/entry/iso";

import type { LiveStay } from "./duffel-map";
import { liteOccupancies, liteRateHotelSchema, liteResponseSchema, mapLiteStay } from "./liteapi-map";
import { centre } from "./search";
import type { HotelSearchQuery } from "./types";

/** All calls, including details, share one 8-second budget. No persistent data or price cache. */
export async function searchLiteStays(query: HotelSearchQuery, signal?: AbortSignal): Promise<LiveStay[] | null> {
  const key = env.LITEAPI_API_KEY;
  const nationality = query.guestNationality && iso2(query.guestNationality);
  if (!key || key.startsWith("sand_") || !nationality || query.filter === "hostel" || signal?.aborted) return null;
  const deadline = AbortSignal.timeout(8_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const headers = { "X-API-Key": key, accept: "application/json", "Content-Type": "application/json" };
  const at = centre(query);
  try {
    const response = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
      method: "POST", cache: "no-store", signal: combined, headers,
      body: JSON.stringify({
        checkin: query.checkIn, checkout: query.checkOut, currency: "USD", guestNationality: nationality,
        occupancies: liteOccupancies(query.occupants), latitude: at.lat, longitude: at.lng, radius: 5_000,
        starRating: [query.filter], maxRatesPerHotel: 1, limit: 6, timeout: 6,
      }),
    });
    if (!response.ok || response.status === 204) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const parsed = liteResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.sandbox === true || combined.aborted) return null;
    const quotedAt = new Date().toISOString();
    const rows = parsed.data.data.flatMap((raw) => {
      const hotel = liteRateHotelSchema.safeParse(raw);
      return hotel.success ? [hotel.data] : [];
    }).slice(0, 6);
    const stays = await Promise.all(rows.map(async (row) => {
      try {
        const detail = await fetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(row.hotelId)}`, {
          headers, signal: combined, cache: "no-store",
        });
        if (!detail.ok) { await detail.body?.cancel().catch(() => {}); return null; }
        return mapLiteStay(row, await detail.json(), query, quotedAt);
      } catch { return null; }
    }));
    const valid = stays.filter((stay): stay is LiveStay => stay !== null);
    return valid.length && !combined.aborted ? valid : null;
  } catch { return null; }
}
