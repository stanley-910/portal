import "server-only";
import { ProviderFailure } from "./types";

export type FetchInit = Omit<RequestInit, "signal"> & { signal: AbortSignal };

async function request(url: string | URL, init: FetchInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw toFailure(e, init.signal);
  }
  if (res.ok) return res;
  // Drain so the socket is released; body content is never surfaced.
  await res.body?.cancel().catch(() => {});
  if (res.status === 401 || res.status === 403) throw new ProviderFailure("AUTH_FAILED");
  if (res.status === 429) throw new ProviderFailure("RATE_LIMITED", true);
  if (res.status >= 500) throw new ProviderFailure("UPSTREAM_ERROR", true);
  throw new ProviderFailure("UPSTREAM_ERROR");
}

function toFailure(e: unknown, signal: AbortSignal): ProviderFailure {
  if (e instanceof ProviderFailure) return e;
  const name = e instanceof Error ? e.name : "";
  if (signal.aborted || name === "AbortError" || name === "TimeoutError") {
    return new ProviderFailure("TIMEOUT", true);
  }
  return new ProviderFailure("UPSTREAM_ERROR", true);
}

/** Returns `unknown` on purpose: adapters validate with zod before mapping. */
export async function fetchJson(url: string | URL, init: FetchInit): Promise<unknown> {
  const text = await fetchText(url, init);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderFailure("BAD_RESPONSE");
  }
}

export async function fetchText(url: string | URL, init: FetchInit): Promise<string> {
  const res = await request(url, init);
  try {
    return await res.text();
  } catch (e) {
    throw toFailure(e, init.signal);
  }
}
