export type Mode = "flight" | "train" | "bus" | "ferry";
export type ProviderId =
  | "travelpayouts" | "12go" | "tdx" | "korea-tago" | "china-rail"
  | "busonlineticket" | "gtfs" | "srt";

export interface Place {
  name: string;               // own spelling, accents kept (DESIGN.md)
  lat: number; lng: number;
  country?: string;           // ISO 3166-1 alpha-2
  iata?: string;              // airports / city codes
  providerIds?: Partial<Record<ProviderId, string>>; // station/terminal ids per provider
}

export interface SearchQuery {
  from: Place; to: Place;
  date: string;               // YYYY-MM-DD, local date at origin
  modes: Mode[];              // empty = all
  passengers: number;         // default 1
  currency: string;           // ISO 4217, default "USD"
}

export interface Segment {
  mode: Mode;
  carrier?: string;           // airline / operator name
  number?: string;            // flight / train number
  from: Place; to: Place;
  depart: string; arrive: string; // ISO 8601 with offset
  durationMin: number;
}

export interface Price { amount: number; currency: string; asOf?: string }

export interface Offer {
  id: string;                 // `${provider}:${stable provider key}`
  provider: ProviderId;
  mode: Mode;
  segments: Segment[];        // ≥ 1
  transfers?: number;         // connections, when the provider counts them but doesn't list each segment
  price?: Price;              // absent = timetable only
  kind: "live" | "cached" | "timetable"; // honesty about freshness
  bookingUrl?: string;        // deep link incl. affiliate marker where ToS requires
  attribution?: string;       // text the provider ToS requires near the result
}

export type ProviderErrorCode =
  | "NOT_CONFIGURED" | "UNSUPPORTED_ROUTE" | "TIMEOUT" | "RATE_LIMITED"
  | "AUTH_FAILED" | "UPSTREAM_ERROR" | "BAD_RESPONSE";

export interface ProviderError { provider: ProviderId; code: ProviderErrorCode; retryable: boolean }

export interface TransportProvider {
  id: ProviderId;
  modes: Mode[];
  covers(q: SearchQuery): boolean;              // cheap, sync, no network
  search(q: SearchQuery, signal: AbortSignal): Promise<Offer[]>; // throws ProviderFailure
}

export class ProviderFailure extends Error {
  constructor(readonly code: ProviderErrorCode, readonly retryable = false) { super(code) }
}

/** How many times you change: the provider's count, or the gaps between listed segments. */
export const transfersOf = (o: Offer): number => Math.max(o.transfers ?? 0, o.segments.length - 1);
