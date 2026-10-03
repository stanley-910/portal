import type { SearchQuery } from "./types";

export interface SearchCacheOptions {
  /** How long a clean result is reused. */
  ttlMs: number;
  /** How long a result with provider errors is reused: short, so a flaky provider gets retried soon. */
  errorTtlMs: number;
  /** Entries kept; the oldest go first. */
  max: number;
  now?: () => number;
}

type Entry<R> = { at: number; ttl: number; value: Promise<R> };

/** One search's identity: places by position and ids, never by display name. */
export function searchKey(q: SearchQuery): string {
  const place = (p: SearchQuery["from"]) => [
    p.lat.toFixed(4), p.lng.toFixed(4), p.iata ?? "",
    Object.entries(p.providerIds ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(","),
  ].join("|");
  return [place(q.from), place(q.to), q.date, [...q.modes].sort().join(","), q.passengers, q.currency.toUpperCase()].join("~");
}

/**
 * Leg searches, meet-ups, nearby rail and the route composer often ask the same question within a minute. Reuse the
 * answer, and share one search between callers asking at the same time. The shared search runs on its own provider
 * deadlines; each caller can still stop waiting with its own signal.
 */
export function createSearchCache<R extends { errors: readonly unknown[] }>(
  run: (query: SearchQuery, signal: AbortSignal) => Promise<R>,
  opts: SearchCacheOptions,
) {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry<R>>();
  const cached = (query: SearchQuery, signal: AbortSignal): Promise<R> => {
    const key = searchKey(query);
    const hit = entries.get(key);
    if (hit && now() - hit.at < hit.ttl) return untilAborted(hit.value, signal);
    if (hit) entries.delete(key);
    const entry: Entry<R> = { at: now(), ttl: opts.ttlMs, value: run(query, new AbortController().signal) };
    entries.set(key, entry);
    entry.value.then(
      (result) => { if (result.errors.length) entry.ttl = opts.errorTtlMs; },
      () => { if (entries.get(key) === entry) entries.delete(key); },
    );
    while (entries.size > opts.max) entries.delete(entries.keys().next().value!);
    return untilAborted(entry.value, signal);
  };
  cached.clear = () => entries.clear();
  return cached;
}

function untilAborted<R>(value: Promise<R>, signal: AbortSignal): Promise<R> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<R>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    value.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
