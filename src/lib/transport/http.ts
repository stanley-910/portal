import { ProviderFailure } from "./types";

type RequestOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  next?: { revalidate: number };
};

async function request(url: string, options: RequestOptions): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
      throw new ProviderFailure("AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new ProviderFailure("RATE_LIMITED", true);
    }
    if (response.status >= 500) {
      throw new ProviderFailure("UPSTREAM_ERROR", true);
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderFailure("TIMEOUT", true);
    }
    throw new ProviderFailure("UPSTREAM_ERROR", true);
  }
}

export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderFailure("BAD_RESPONSE");
  }
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  const response = await request(url, options);
  try {
    return await response.text();
  } catch {
    throw new ProviderFailure("BAD_RESPONSE");
  }
}
