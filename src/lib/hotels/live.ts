import "server-only";

import { searchDuffelStays } from "./duffel";
import { searchLiteStays } from "./liteapi";
import { rankStays, searchHotels } from "./search";
import type { HotelSearchQuery } from "./types";

/** Parallel optional sources keep fallback within one provider deadline, with Duffel preferred. */
export async function searchAvailableHotels(query: HotelSearchQuery, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(8_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const spare = new AbortController();
  // Attach a rejection handler immediately; the preferred source may finish first.
  const alternative = searchLiteStays(query, AbortSignal.any([combined, spare.signal])).catch(() => null);
  const preferred = await searchDuffelStays(query, combined).catch(() => null);
  if (preferred?.length) {
    spare.abort();
    return rankStays(preferred, query);
  }
  const other = await alternative;
  return other?.length ? rankStays(other, query) : searchHotels(query);
}
