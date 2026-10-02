import { ProviderFailure } from "./types";

type RequestOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  next?: { revalidate: number };
};

function isAborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

async function request(url: string, options: RequestOptions): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
      throw new ProviderFailure("AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new ProviderFailure("RATE_LIMITED", true);
    }
    if (!response.ok) {
      throw new ProviderFailure("UPSTREAM_ERROR", response.status >= 500);
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (isAborted(error, options.signal)) throw new ProviderFailure("TIMEOUT", true);
    throw new ProviderFailure("UPSTREAM_ERROR", true);
  }
}

async function readBody<T>(
  url: string,
  options: RequestOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const response = await request(url, options);
  try {
    return await read(response);
  } catch (error) {
    if (isAborted(error, options.signal)) throw new ProviderFailure("TIMEOUT", true);
    throw new ProviderFailure("BAD_RESPONSE");
  }
}

/** T is a caller assertion, not validation. Validate untrusted payloads in the adapter. */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return readBody(url, options, (response) => response.json() as Promise<T>);
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  return readBody(url, options, (response) => response.text());
}
