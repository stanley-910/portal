import "server-only";
import { z } from "zod";

import { providers } from "./registry";
import {
  ProviderFailure,
  transfersOf,
  type Offer,
  type ProviderError,
  type ProviderId,
  type SearchQuery,
  type TransportProvider,
} from "./types";

export interface SearchResult {
  offers: Offer[];
  errors: ProviderError[];
  tookMs: number;
}

export interface FanOutOptions {
  providers?: readonly TransportProvider[];
  timeoutMs?: number;
  /** Caller cancellation, e.g. `request.signal`; aborts every provider. */
  signal?: AbortSignal;
}

export const PROVIDER_TIMEOUT_MS = 8_000;

const mode = z.enum(["flight", "train", "bus", "ferry"]);
const instant = z.iso.datetime({ offset: true });
const place = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
// Validate at the provider boundary: TypeScript does not validate upstream JSON.
const offerSchema = z.object({
  id: z.string().min(1),
  provider: z.string(),
  mode,
  kind: z.enum(["live", "cached", "timetable", "estimated"]),
  transfers: z.number().int().nonnegative().optional(),
  segments: z.array(z.object({
    mode,
    from: place,
    to: place,
    depart: instant,
    arrive: instant,
    durationMin: z.number().nonnegative(),
  }).refine((segment) => Date.parse(segment.arrive) >= Date.parse(segment.depart))).min(1),
  price: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    // Curated providers record a checked calendar date, not a fabricated instant.
    asOf: z.union([instant, z.iso.date()]).optional(),
  }).optional(),
});

function errorFor(provider: ProviderId, error: unknown, unknownRetryable: boolean): ProviderError {
  if (error instanceof ProviderFailure) {
    return { provider, code: error.code, retryable: error.retryable };
  }
  // Never serialize exception messages, bodies or authenticated URLs.
  return { provider, code: "UPSTREAM_ERROR", retryable: unknownRetryable };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priceGroup(offer: Offer, currency: string): number {
  if (!offer.price || !Number.isFinite(offer.price.amount) || offer.price.amount < 0 ||
      !/^[A-Za-z]{3}$/.test(offer.price.currency)) return 2;
  return offer.price.currency.toUpperCase() === currency ? 0 : 1;
}

function departure(offer: Offer): number {
  const value = Date.parse(offer.segments[0]?.depart ?? "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/** Price-first within a currency, never FX conversion. Does not mutate input. */
export function rankFareOffers(offers: readonly Offer[], currency: string): Offer[] {
  const requestedCurrency = currency.toUpperCase();
  return [...offers].sort((a, b) => {
    const aGroup = priceGroup(a, requestedCurrency);
    const bGroup = priceGroup(b, requestedCurrency);
    if (aGroup !== bGroup) return aGroup - bGroup;
    if (aGroup !== 2) {
      const byCurrency = compareText(a.price!.currency.toUpperCase(), b.price!.currency.toUpperCase());
      if (byCurrency) return byCurrency;
      const byPrice = a.price!.amount - b.price!.amount;
      if (byPrice) return byPrice;
    }
    // Offsets differ between providers; lexical ISO ordering is not time ordering.
    const byDeparture = departure(a) - departure(b);
    if (byDeparture) return byDeparture;
    return compareText(a.provider, b.provider) || compareText(a.id, b.id);
  });
}

// Fixed estimates are for the best-option heuristic only, never displayed fares.
const USD_RATES: Record<string, number> = {
  USD: 1, CNY: 0.138, HKD: 0.128, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08,
};

function convenienceScore(offer: Offer): number {
  if (!offer.segments.length) return Infinity;
  const validPrice = priceGroup(offer, "USD") !== 2;
  const rate = validPrice ? USD_RATES[offer.price!.currency.toUpperCase()] : undefined;
  // An unsupported currency is not USD. Keep it behind comparable scores.
  const priceUsd = validPrice ? (rate === undefined ? Infinity : offer.price!.amount * rate) : 100;
  const durationPenalty = offer.segments.reduce((sum, segment) => sum + segment.durationMin, 0) * 0.03;
  const modePenalty = { flight: 0, train: 4, bus: 12, ferry: 16 }[offer.mode];
  const layoverPenalty = transfersOf(offer) * 30;
  return priceUsd * 0.75 + durationPenalty + modePenalty + layoverPenalty;
}

/**
 * Best-option heuristic, not a converted quote: fixed known FX estimates affect
 * ranking only. Original prices/currencies stay untouched; unsupported currencies
 * never default to USD. Equal/unknown scores use currency-grouped fares then UTC
 * departure, provider and ID, so ordering is deterministic without raw cross-FX
 * price comparison. A missing fare uses main's neutral heuristic, not a free fare.
 */
export function rankOffers(offers: readonly Offer[], currency: string): Offer[] {
  return rankFareOffers(offers, currency).sort((a, b) => convenienceScore(a) - convenienceScore(b));
}

async function searchProvider(
  provider: TransportProvider,
  query: SearchQuery,
  requestSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Offer[]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline.signal]) : deadline.signal;
  let onAbort: () => void = () => {};
  try {
    // Racing also bounds adapters that ignore AbortSignal. Their late rejection
    // remains handled by Promise.race; cancellation is still sent to fetch.
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ProviderFailure("TIMEOUT", true));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const work = Promise.resolve().then(() => {
      if (signal.aborted) throw new ProviderFailure("TIMEOUT", true);
      return provider.search(query, signal);
    });
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function runSearch(query: SearchQuery, opts: FanOutOptions, best: boolean): Promise<SearchResult> {
  const started = Date.now();
  const errors: ProviderError[] = [];
  const applicable = (opts.providers ?? providers).filter((provider) => {
    if (query.modes.length && !provider.modes.some((mode) => query.modes.includes(mode))) return false;
    try {
      return provider.covers(query);
    } catch (error) {
      // Preserve fanOut's eligibility contract; coordinate searches surface this error.
      if (!best) errors.push(errorFor(provider.id, error, true));
      return false;
    }
  });
  const settled = await Promise.allSettled(applicable.map((provider) =>
    searchProvider(provider, query, opts.signal, opts.timeoutMs ?? PROVIDER_TIMEOUT_MS)));
  const offers: Offer[] = [];
  settled.forEach((result, index) => {
    const provider = applicable[index];
    if (result.status === "rejected") {
      errors.push(errorFor(provider.id, result.reason, !best));
      return;
    }
    if (!Array.isArray(result.value)) {
      errors.push(errorFor(provider.id, new ProviderFailure("BAD_RESPONSE"), false));
      return;
    }
    let malformed = false;
    for (const offer of result.value) {
      if (!offerSchema.safeParse(offer).success || offer.provider !== provider.id ||
          !provider.modes.includes(offer.mode)) {
        malformed = true;
      } else if (!query.modes.length || query.modes.includes(offer.mode)) {
        offers.push(offer);
      }
    }
    if (malformed) errors.push(errorFor(provider.id, new ProviderFailure("BAD_RESPONSE"), false));
  });
  errors.sort((a, b) => compareText(a.provider, b.provider));
  const tookMs = Date.now() - started;
  if (best) {
    for (const error of errors) {
      if (error.code !== "NOT_CONFIGURED") {
        console.warn({ provider: error.provider, code: error.code, ms: tookMs }, "PROVIDER_FAILED");
      }
    }
  }
  return { offers: rankOffers(offers, query.currency), errors, tookMs };
}

/** Coordinate/hub searches use best-option ranking and retain their error contract. */
export function searchTransport(query: SearchQuery, signal: AbortSignal): Promise<SearchResult> {
  return runSearch(query, { signal }, false);
}

// No retries here yet: retryable failures go back to the client in `errors[]`.
export function fanOut(query: SearchQuery, opts: FanOutOptions = {}): Promise<SearchResult> {
  return runSearch(query, opts, true);
}
