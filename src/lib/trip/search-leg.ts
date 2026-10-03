import "server-only";

import { liveblocks } from "@/lib/liveblocks/server";
import type { LegSearch } from "@/lib/liveblocks/types";
import { searchFromCoordinates } from "@/lib/transport/hub-search";
import { MAX_OFFERS, toStoredOffer } from "@/lib/trip/offers";
import { stopToPlace } from "@/lib/trip/stops";

/**
 * Runs the route search for one leg and writes the results into the trip for everyone. Callers check who may
 * spend provider quota. `searchId` is the search the caller started: if the leg was edited since, a newer search owns
 * it and this one is dropped.
 */
export async function runLegSearch(roomId: string, legId: string, searchId: string) {
  const lb = liveblocks();
  const plan = await lb.getStorageDocument(roomId, "json");
  const leg = plan.legs?.[legId];
  const from = leg && plan.stops?.[leg.from];
  const to = leg && plan.stops?.[leg.to];
  if (!leg || !from || !to || leg.search.id !== searchId) return;

  let search: LegSearch;
  try {
    const result = await searchFromCoordinates({
      from: stopToPlace(from),
      to: stopToPlace(to),
      date: leg.date,
      modes: [],
      passengers: 1,
      currency: "USD",
    }, new AbortController().signal);
    search = { id: searchId, status: "done", offers: result.offers.slice(0, MAX_OFFERS).map(toStoredOffer) };
  } catch {
    search = { id: searchId, status: "failed", offers: [] };
  }

  await lb.mutateStorage(roomId, ({ root }) => {
    const current = root.get("legs").get(legId);
    if (current?.get("search").id === searchId) current.set("search", search);
  });
}
