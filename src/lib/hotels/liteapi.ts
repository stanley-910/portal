import "server-only";

import { env } from "@/lib/env.server";
import { iso2 } from "@/lib/entry/iso";

import type { LiveStay } from "./duffel-map";
import { LITE_HOSTEL_TYPES, liteOccupancies, liteRateHotelSchema, liteResponseSchema, mapLiteListing, mapLiteStay } from "./liteapi-map";
import { centre, type CatalogStay } from "./search";
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

/**
 * Real hotels near the centre from LiteAPI's listings, for when no source has a rate: works with a sandbox key and
 * needs no nationality, since nothing is quoted. Null when there's no key, the call fails or nothing matches.
 */
export async function listLiteStays(query: HotelSearchQuery, signal?: AbortSignal): Promise<CatalogStay[] | null> {
  const key = env.LITEAPI_API_KEY;
  if (!key || signal?.aborted) return null;
  const at = centre(query);
  const params = new URLSearchParams({ latitude: String(at.lat), longitude: String(at.lng), radius: "5000", limit: "8" });
  if (query.filter === "hostel") params.set("hotelTypeIds", LITE_HOSTEL_TYPES.join(","));
  else params.set("starRating", String(query.filter));
  try {
    const response = await fetch(`https://api.liteapi.travel/v3.0/data/hotels?${params}`, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000),
      headers: { "X-API-Key": key, accept: "application/json" },
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return null; }
    const parsed = liteResponseSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const stays = parsed.data.data.flatMap((raw) => mapLiteListing(raw, query) ?? []);
    return stays.length ? stays : null;
  } catch { return null; }
}
