import "server-only";
import { z } from "zod";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { distanceKm } from "@/lib/transport/hubs/geo";
import type { Offer, SearchQuery } from "@/lib/transport/types";

export const railPreferences = {
  radius_km: z.number().min(1).max(100).default(100).describe("Maximum straight-line distance to each station; not driving time"),
  max_fare: z.number().nonnegative().optional().describe("Rail fare ceiling per person, excluding transfers; omit if no budget given"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
};
export const NEARBY_RAIL_INSTRUCTION = "For cheaper travel, a budget, or missing train options, call search_nearby_trains as well as the usual route/options tool. Suggest the returned nearby stations, including the access distance at each end. Unknown fares are not cheaper or within budget. Transfer costs and driving times are unknown; never claim a door-to-door saving or a one-hour drive from straight-line distance. Keep the original endpoints unless the user asks to change the trip.";

type Preferences = { radius_km: number; max_fare?: number; currency: string };
/** Search all rail providers independently of the mixed-mode result list, which can bury unpriced trains. */
export async function searchNearbyRail(
  query: SearchQuery,
  preferences: Preferences,
  signal: AbortSignal,
  search = searchFromCoordinates,
) {
  const result = await search({ ...query, modes: ["train"], passengers: 1, currency: preferences.currency }, signal);
  const radius = Math.min(100, Math.max(1, preferences.radius_km));
  const direct = distanceKm(query.from, query.to);
  const candidates = result.offers.flatMap((offer: Offer) => {
    if (offer.mode !== "train" || !offer.segments.length) return [];
    const first = offer.segments[0], last = offer.segments.at(-1)!;
    const access = distanceKm(query.from, first.from), egress = distanceKm(last.to, query.to);
    if (access > radius || egress > radius) return [];
    // Do not turn overlapping catchments into backwards travel or excessive detours.
    if (distanceKm(first.from, query.to) <= egress || distanceKm(last.to, query.from) <= access ||
      access + distanceKm(first.from, last.to) + egress > direct * 1.75 + 25) return [];
    const comparable = offer.price?.currency === preferences.currency;
    const railFareBudget = preferences.max_fare === undefined ? "not_requested" :
      !offer.price || !comparable ? "unknown" : offer.price.amount <= preferences.max_fare ? "within_rail_fare_budget" : "over_rail_fare_budget";
    return [{
      id: offer.id, from: first.from, to: last.to, date: query.date,
      depart: first.depart, arrive: last.arrive,
      railDurationMin: offer.segments.reduce((sum, segment) => sum + segment.durationMin, 0),
      kind: offer.kind, price: offer.price ?? null, railFareBudget,
      accessDistanceKm: Math.round(access * 10) / 10, egressDistanceKm: Math.round(egress * 10) / 10,
      transferCost: null, transferDurationMin: null, doorToDoorCost: null,
      source: offer.attribution ?? offer.provider,
    }];
  });
  // Compare only same-currency fares. Keep unpriced station alternatives available to Pip.
  const fare = (o: typeof candidates[number]) => o.price?.currency === preferences.currency ? o.price.amount : Infinity;
  candidates.sort((a, b) => fare(a) - fare(b) ||
    (a.accessDistanceKm + a.egressDistanceKm) - (b.accessDistanceKm + b.egressDistanceKm) || a.railDurationMin - b.railDurationMin);
  const routes = new Map<string, typeof candidates[number]>();
  for (const option of candidates) {
    const key = [option.from.lat, option.from.lng, option.to.lat, option.to.lng].join(":");
    if (!routes.has(key)) routes.set(key, option);
  }
  const alternatives = [...routes.values()];
  // Reserve space for fare-unknown routes; they must not disappear behind priced routes.
  const priced = alternatives.filter((o) => o.price?.currency === preferences.currency);
  const unknown = alternatives.filter((o) => !o.price || o.price.currency !== preferences.currency);
  const selected = [...priced.slice(0, unknown.length ? 6 : 10), ...unknown.slice(0, priced.length ? 4 : 10)];
  return {
    from: query.from, to: query.to, radiusKm: radius, found: candidates.length,
    stationPairs: routes.size, options: selected, truncated: selected.length < routes.size,
    errors: result.errors,
    note: "One representative service per station pair. Coverage is limited to available providers and geocoded stations. Distances are straight-line, not driving times. Prices are rail-only per person; transfers are not priced. Unknown fares cannot establish savings or budget compliance. Demo estimates are not verified schedules. No trip changes were made.",
  };
}
