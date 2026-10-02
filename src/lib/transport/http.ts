import "server-only";
import { ProviderFailure } from "./types";

export type FetchInit = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal;
  next?: { revalidate: number | false; tags?: string[] };
};

function isAborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

async function request(url: string | URL, options: FetchInit): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.ok) return response;
    // Release the socket; never surface an authenticated URL or upstream body.
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new ProviderFailure("AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new ProviderFailure("RATE_LIMITED", true);
    }
    throw new ProviderFailure("UPSTREAM_ERROR", response.status >= 500);
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (isAborted(error, options.signal)) throw new ProviderFailure("TIMEOUT", true);
    throw new ProviderFailure("UPSTREAM_ERROR", true);
  }
}

async function readBody<T>(
  url: string | URL,
  options: FetchInit,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const response = await request(url, options);
  try {
    return await read(response);
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (isAborted(error, options.signal)) throw new ProviderFailure("TIMEOUT", true);
    if (error instanceof SyntaxError) throw new ProviderFailure("BAD_RESPONSE");
    throw new ProviderFailure("UPSTREAM_ERROR", true);
  }
}

/** Unknown by default. T is a caller assertion, not validation; adapters validate payloads. */
export async function fetchJson<T = unknown>(url: string | URL, options: FetchInit = {}): Promise<T> {
  return readBody(url, options, (response) => response.json() as Promise<T>);
}

export async function fetchText(url: string | URL, options: FetchInit = {}): Promise<string> {
  return readBody(url, options, (response) => response.text());
}
