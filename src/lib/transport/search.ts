import { z } from "zod";

import { providers } from "./registry";
import {
  ProviderFailure,
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
  kind: z.enum(["live", "cached", "timetable"]),
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
    asOf: instant.optional(),
  }).optional(),
});

function errorFor(provider: ProviderId, error: unknown): ProviderError {
  if (error instanceof ProviderFailure) {
    return { provider, code: error.code, retryable: error.retryable };
  }
  // Never serialize exception messages, bodies or authenticated URLs.
  return { provider, code: "UPSTREAM_ERROR", retryable: true };
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
export function rankOffers(offers: readonly Offer[], currency: string): Offer[] {
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

async function searchProvider(
  provider: TransportProvider,
  query: SearchQuery,
  requestSignal: AbortSignal,
): Promise<Offer[]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), PROVIDER_TIMEOUT_MS);
  const signal = AbortSignal.any([requestSignal, deadline.signal]);
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

export async function searchTransport(query: SearchQuery, signal: AbortSignal): Promise<SearchResult> {
  const started = Date.now();
  const errors: ProviderError[] = [];
  const applicable = providers.filter((provider) => {
    if (query.modes.length && !provider.modes.some((mode) => query.modes.includes(mode))) return false;
    try {
      return provider.covers(query);
    } catch (error) {
      errors.push(errorFor(provider.id, error));
      return false;
    }
  });
  const settled = await Promise.allSettled(applicable.map((provider) => searchProvider(provider, query, signal)));
  const offers: Offer[] = [];
  settled.forEach((result, index) => {
    const provider = applicable[index];
    if (result.status === "rejected") {
      errors.push(errorFor(provider.id, result.reason));
      return;
    }
    if (!Array.isArray(result.value)) {
      errors.push(errorFor(provider.id, new ProviderFailure("BAD_RESPONSE")));
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
    if (malformed) errors.push(errorFor(provider.id, new ProviderFailure("BAD_RESPONSE")));
  });
  errors.sort((a, b) => compareText(a.provider, b.provider));
  return { offers: rankOffers(offers, query.currency), errors, tookMs: Date.now() - started };
}
