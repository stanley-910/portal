import "server-only";

import { DUFFEL_TIMEOUT_MS, requestOffers } from "./client";
import { mapOffers } from "./map";
import { toIata } from "../travelpayouts/places";
import { ProviderFailure, type SearchQuery, type TransportProvider } from "../../types";

// Live flight offers that can be booked through Duffel later. Without a token it reports NOT_CONFIGURED and
// Travelpayouts' cached fares and estimates still cover every flight leg.
// Duffel allows 30 offer requests a minute per account, and the globe searches on every landing, date change and
// dragged stop. The same route, day and party reuse an answer for a few minutes, searches already running are
// shared, and when Duffel says to slow down, an older answer beats estimates. Settling always prices the flight
// afresh (src/lib/booking), so a reused list never decides what anyone pays.
const FRESH_MS = 5 * 60_000;
const STALE_MS = 20 * 60_000;
const answers = new Map<string, { at: number; offers: unknown[] }>();
const running = new Map<string, Promise<unknown[]>>();

async function cachedOffers(query: SearchQuery, origin: string, destination: string, signal: AbortSignal): Promise<unknown[]> {
  const key = `${origin}-${destination}-${query.date}-${query.passengers}`;
  const known = answers.get(key);
  if (known && Date.now() - known.at < FRESH_MS) return known.offers;
  let pending = running.get(key);
  if (!pending) {
    // its own deadline, not the first caller's signal: another search may be waiting on the same answer
    pending = requestOffers(query, origin, destination, AbortSignal.timeout(DUFFEL_TIMEOUT_MS))
      .then((offers) => {
        answers.set(key, { at: Date.now(), offers });
        if (answers.size > 500) answers.delete(answers.keys().next().value!);
        return offers;
      })
      .finally(() => running.delete(key));
    running.set(key, pending);
  }
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  } catch (e) {
    if (!signal.aborted && known && Date.now() - known.at < STALE_MS) return known.offers;
    throw e;
  }
}

/** For tests: forget every reused answer. */
export const clearDuffelCache = () => answers.clear();

export const duffel: TransportProvider = {
  id: "duffel",
  modes: ["flight"],
  // Duffel waits up to SUPPLIER_TIMEOUT_MS for the airlines and then needs a couple of seconds of its own (about 2 s
  // seen from Hong Kong even for its instant test airline), so the default 8 s cut it off just as it answered.
  timeoutMs: DUFFEL_TIMEOUT_MS,
  covers(query: SearchQuery) {
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    return (query.modes.length === 0 || query.modes.includes("flight")) &&
      origin !== null && destination !== null && origin !== destination;
  },
  async search(query, signal) {
    const origin = toIata(query.from);
    const destination = toIata(query.to);
    if (!origin || !destination || origin === destination) throw new ProviderFailure("UNSUPPORTED_ROUTE");
    const raw = await cachedOffers(query, origin, destination, signal);
    signal.throwIfAborted();
    return mapOffers(raw, query, origin, destination);
  },
};

export default duffel;
