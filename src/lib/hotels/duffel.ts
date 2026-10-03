import "server-only";

import { z } from "zod";

import { env } from "@/lib/env.server";

import { mapStays, roomsFor, type LiveStay } from "./duffel-map";
import type { HotelSearchQuery } from "./types";

const RADIUS_KM = 5;
const TIMEOUT_MS = 8_000;

const responseSchema = z.object({ data: z.object({ results: z.array(z.unknown()), live_mode: z.boolean().optional() }), live_mode: z.boolean().optional() });

/**
 * Live stays from Duffel around the landed point, or null when there's no token, the call fails or nothing matches,
 * so the caller falls back to estimates. Duffel lists hotels, not hostels.
 */
export async function searchDuffelStays(query: HotelSearchQuery, signal?: AbortSignal): Promise<LiveStay[] | null> {
  if (!env.DUFFEL_ACCESS_TOKEN || env.DUFFEL_ACCESS_TOKEN.startsWith("duffel_test_") || query.filter === "hostel" || signal?.aborted) return null;
  try {
    const response = await fetch("https://api.duffel.com/stays/search", {
      method: "POST",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${env.DUFFEL_ACCESS_TOKEN}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          rooms: roomsFor(query.occupants),
          guests: Array.from({ length: query.occupants }, () => ({ type: "adult" })),
          check_in_date: query.checkIn,
          check_out_date: query.checkOut,
          location: { radius: RADIUS_KM, geographic_coordinates: { latitude: query.lat, longitude: query.lng } },
        },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.warn({ provider: "duffel-stays", status: response.status }, "FELL_BACK_TO_ESTIMATE");
      return null;
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.live_mode === false || parsed.data.data.live_mode === false) return null;
    const stays = mapStays(parsed.data.data.results, query);
    return stays.length ? stays : null;
  } catch {
    console.warn({ provider: "duffel-stays" }, "FELL_BACK_TO_ESTIMATE");
    return null;
  }
}
