import { resolveHubs, snappedHub } from "./hubs/resolve";
import { duffelCity } from "./providers/duffel/cities";
import { providers } from "./registry";
import type { HubMode, HubResolution } from "./hubs/types";
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
  // Duffel's few requests a minute go to the best-placed pair's two cities (one request covers every airport in
  // them); airports in other cities, like Shenzhen for Hong Kong, keep cached fares and estimates.
  const best = hubs.pairs.find((pair) => pair.mode === "flight");
  const cities = (pair: HubResolution["pairs"][number]) => `${duffelCity(pair.from.hub.iata ?? "")}-${duffelCity(pair.to.hub.iata ?? "")}`;
  const searches = hubs.pairs.map((pair) => ({
    pairId: pair.id,
    query: { ...query, from: pair.from.hub, to: pair.to.hub, modes: [pair.mode] } as SearchQuery,
    only: pair.mode === "flight" && best && cities(pair) !== cities(best) ? providers.filter((p) => p.id !== "duffel") : undefined,
  }));
  // Surface adapters have their own broader station/route seeds. Keep a raw
  // coordinate search too: our curated hub graph must not suppress those routes.
  // Airports still use only the bounded, exact-IATA pair shortlist.
  // A snapped end keeps to its hub's mode: an airport picked means flights, a station trains. Ends snapped to
  // different modes have no pair and no surface search.
  const snapped = new Set([snappedHub(query.from), snappedHub(query.to)].flatMap((hub) => (hub ? [hub.mode] : [])));
  const surfaceModes = (query.modes.length ? query.modes : ["train", "bus", "ferry"] as const)
    .filter((mode) => mode !== "flight" && (snapped.size === 0 || (snapped.size === 1 && snapped.has(mode as HubMode))));
  // a snapped station's surface search starts from it, not from the click near it
  const from = snappedHub(query.from) ?? query.from;
  const to = snappedHub(query.to) ?? query.to;
  if (surfaceModes.length) searches.push({ pairId: "", query: { ...query, from, to, modes: surfaceModes }, only: undefined });
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
    const result = await (search.only
      ? searchTransport(search.query, signal, progress, search.only)
      : progress ? searchTransport(search.query, signal, progress) : searchTransport(search.query, signal));
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
