import { resolveHubs } from "./hubs/resolve";
import type { HubResolution } from "./hubs/types";
import { rankOffers, searchTransport, type SearchResult } from "./search";
import type { ProviderError, SearchQuery } from "./types";

export interface HubSearchResult extends SearchResult {
  hubs: HubResolution;
  /** A provider offer may be returned for more than one nearby search pair. */
  offerPairs: Record<string, string[]>;
  /** No schedule or price is invented when providers are unavailable or empty. */
  estimates: string[];
}

/** Resolve coordinates locally, search a bounded set of pairs, then rank fares. */
export async function searchFromCoordinates(query: SearchQuery, signal: AbortSignal): Promise<HubSearchResult> {
  const started = Date.now();
  const hubs = resolveHubs(query.from, query.to, query.modes);
  const searches = hubs.pairs.map((pair) => ({
    pairId: pair.id,
    query: { ...query, from: pair.from.hub, to: pair.to.hub, modes: [pair.mode] } as SearchQuery,
  }));
  // Bus adapters already match coordinates to their own stops. Preserve that path
  // without treating every nearby bus stop as an airport/rail/ferry hub.
  if (query.modes.length === 0 || query.modes.includes("bus")) {
    searches.push({ pairId: "", query: { ...query, modes: ["bus"] } });
  }
  const results = await Promise.all(searches.map(async (search) => ({
    ...search, result: await searchTransport(search.query, signal),
  })));
  const offerPairs: Record<string, string[]> = Object.create(null);
  const withOffers = new Set<string>();
  for (const { pairId, result } of results) {
    if (pairId && result.offers.length > 0) withOffers.add(pairId);
    for (const offer of result.offers) {
      if (!Object.hasOwn(offerPairs, offer.id)) offerPairs[offer.id] = [];
      if (pairId && !offerPairs[offer.id].includes(pairId)) offerPairs[offer.id].push(pairId);
    }
  }
  const errors = new Map<string, ProviderError>();
  for (const { result } of results) {
    for (const error of result.errors) errors.set(`${error.provider}:${error.code}`, error);
  }
  // Sort before deduplication so conflicting duplicate IDs retain the best-ranked
  // offer, independently of network completion order or pair enumeration.
  const offers = rankOffers(results.flatMap(({ result }) => result.offers), query.currency);
  const seen = new Set<string>();
  const uniqueOffers = offers.filter((offer) => {
    if (seen.has(offer.id)) return false;
    seen.add(offer.id);
    return true;
  });
  return {
    offers: uniqueOffers,
    errors: [...errors.values()].sort((a, b) => `${a.provider}:${a.code}`.localeCompare(`${b.provider}:${b.code}`)),
    tookMs: Date.now() - started,
    hubs,
    offerPairs,
    estimates: hubs.pairs.filter((pair) => !withOffers.has(pair.id)).map((pair) => pair.id),
  };
}
