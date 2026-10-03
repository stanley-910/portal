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
export async function searchFromCoordinates(query: SearchQuery, signal: AbortSignal, onProgress?: (result: HubSearchResult) => void): Promise<HubSearchResult> {
  const started = Date.now();
  const hubs = resolveHubs(query.from, query.to, query.modes);
  const searches = hubs.pairs.map((pair) => ({
    pairId: pair.id,
    query: { ...query, from: pair.from.hub, to: pair.to.hub, modes: [pair.mode] } as SearchQuery,
  }));
  // Surface adapters have their own broader station/route seeds. Keep a raw
  // coordinate search too: our curated hub graph must not suppress those routes.
  // Airports still use only the bounded, exact-IATA pair shortlist.
  const surfaceModes = (query.modes.length ? query.modes : ["train", "bus", "ferry"] as const)
    .filter((mode) => mode !== "flight");
  if (surfaceModes.length) searches.push({ pairId: "", query: { ...query, modes: surfaceModes } });
  const partial = new Map<number, SearchResult>();
  const snapshot = () => mergeResults(query, hubs, started, searches.flatMap((search, i) => {
    const result = partial.get(i);
    return result ? [{ pairId: search.pairId, result }] : [];
  }));
  await Promise.all(searches.map(async (search, i) => {
    const progress = onProgress ? (result: SearchResult) => {
      partial.set(i, result);
      if (!signal.aborted) onProgress(snapshot());
    } : undefined;
    const result = await (progress ? searchTransport(search.query, signal, progress) : searchTransport(search.query, signal));
    partial.set(i, result);
  }));
  return snapshot();
}

function mergeResults(query: SearchQuery, hubs: HubResolution, started: number,
  results: { pairId: string; result: SearchResult }[]): HubSearchResult {
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
