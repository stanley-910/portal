import "server-only";
import { providers as registered } from "./registry";
import { ProviderFailure, type Offer, type ProviderError, type SearchQuery, type TransportProvider } from "./types";

export const PROVIDER_TIMEOUT_MS = 8_000;

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

function covers(p: TransportProvider, q: SearchQuery): boolean {
  try {
    return p.covers(q);
  } catch {
    return false;
  }
}

// Races the provider against its signal so one that ignores `signal` still cannot stall the fan-out.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProviderFailure("TIMEOUT", true));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProviderFailure("TIMEOUT", true));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function toError(p: TransportProvider, e: unknown, signal: AbortSignal): ProviderError {
  if (e instanceof ProviderFailure) return { provider: p.id, code: e.code, retryable: e.retryable };
  if (signal.aborted) return { provider: p.id, code: "TIMEOUT", retryable: true };
  return { provider: p.id, code: "UPSTREAM_ERROR", retryable: false };
}

const priceRank = (o: Offer) => o.price?.amount ?? Number.POSITIVE_INFINITY;
const departMs = (o: Offer) => Date.parse(o.segments[0]?.depart ?? "") || Number.POSITIVE_INFINITY;

const USD_RATES: Record<string, number> = {
  USD: 1,
  CNY: 0.138,
  HKD: 0.128,
  THB: 0.028,
  MYR: 0.21,
  SGD: 0.74,
  EUR: 1.08,
};

function convenienceScore(offer: Offer): number {
  const segment = offer.segments[0];
  const priceUsd = offer.price
    ? offer.price.amount * (USD_RATES[offer.price.currency] ?? 1)
    : 100;
  const durationPenalty = segment.durationMin * 0.03;
  const modePenalty = { flight: 0, train: 4, bus: 12, ferry: 16 }[offer.mode];
  const layoverPenalty = Math.max(0, offer.segments.length - 1) * 30;
  return priceUsd * 0.75 + durationPenalty + modePenalty + layoverPenalty;
}

function compareOffers(a: Offer, b: Offer): number {
  return convenienceScore(a) - convenienceScore(b) ||
    priceRank(a) - priceRank(b) ||
    departMs(a) - departMs(b) ||
    a.provider.localeCompare(b.provider) ||
    a.id.localeCompare(b.id);
}

// No retries here yet: retryable failures go back to the client in `errors[]`.
export async function fanOut(q: SearchQuery, opts: FanOutOptions = {}): Promise<SearchResult> {
  const started = performance.now();
  const timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const active = (opts.providers ?? registered).filter((p) => covers(p, q));

  const settled = await Promise.all(
    active.map(async (p) => {
      const t0 = performance.now();
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
      try {
        const offers = await untilAborted(Promise.resolve().then(() => p.search(q, signal)), signal);
        return { offers, error: undefined };
      } catch (e) {
        const error = toError(p, e, signal);
        if (error.code !== "NOT_CONFIGURED") {
          console.warn({ provider: p.id, code: error.code, ms: Math.round(performance.now() - t0) }, "PROVIDER_FAILED");
        }
        return { offers: [] as Offer[], error };
      }
    }),
  );

  return {
    offers: settled.flatMap((s) => s.offers).sort(compareOffers),
    errors: settled.flatMap((s) => (s.error ? [s.error] : [])),
    tookMs: Math.round(performance.now() - started),
  };
}
