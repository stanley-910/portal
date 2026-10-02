import { providers } from "./registry";
import { ProviderFailure, type Offer, type ProviderError, type SearchQuery } from "./types";

export interface SearchResult {
  offers: Offer[];
  errors: ProviderError[];
  tookMs: number;
}

function errorFor(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderFailure) {
    return { provider: provider as ProviderError["provider"], code: error.code, retryable: error.retryable };
  }
  return { provider: provider as ProviderError["provider"], code: "UPSTREAM_ERROR", retryable: true };
}

function compareOffers(a: Offer, b: Offer): number {
  const aPrice = a.price?.amount ?? Number.POSITIVE_INFINITY;
  const bPrice = b.price?.amount ?? Number.POSITIVE_INFINITY;
  return aPrice - bPrice ||
    a.segments[0].depart.localeCompare(b.segments[0].depart) ||
    a.id.localeCompare(b.id);
}

export async function searchTransport(query: SearchQuery, signal: AbortSignal): Promise<SearchResult> {
  const started = Date.now();
  const applicable = providers.filter((provider) => provider.modes.some((mode) =>
    query.modes.length === 0 || query.modes.includes(mode),
  ) && provider.covers(query));
  const settled = await Promise.allSettled(applicable.map((provider) => provider.search(query, signal)));
  const offers: Offer[] = [];
  const errors: ProviderError[] = [];
  settled.forEach((result, index) => {
    const provider = applicable[index];
    if (result.status === "fulfilled") offers.push(...result.value);
    else errors.push(errorFor(provider.id, result.reason));
  });
  offers.sort(compareOffers);
  errors.sort((a, b) => a.provider.localeCompare(b.provider));
  return { offers, errors, tookMs: Date.now() - started };
}
