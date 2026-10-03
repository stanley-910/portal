import "server-only";

import { searchDuffelStays } from "./duffel";
import { searchLiteStays } from "./liteapi";
import { rankStays, searchHotels } from "./search";
import type { HotelSearchQuery } from "./types";

/** Parallel optional sources keep fallback within one provider deadline, with Duffel preferred. */
export async function searchAvailableHotels(query: HotelSearchQuery, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(8_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const results = await Promise.allSettled([searchDuffelStays(query, combined), searchLiteStays(query, combined)]);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.length) return rankStays(result.value, query);
  }
  return searchHotels(query);
}
