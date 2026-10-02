export type Mode = "flight" | "train" | "bus" | "ferry";
export type ProviderId =
  | "travelpayouts"
  | "12go"
  | "tdx"
  | "korea-tago"
  | "china-rail"
  | "busonlineticket"
  | "gtfs";

export interface Place {
  name: string;
  lat: number;
  lng: number;
  country?: string;
  iata?: string;
  providerIds?: Partial<Record<ProviderId, string>>;
}

export interface SearchQuery {
  from: Place;
  to: Place;
  date: string;
  modes: Mode[];
  passengers: number;
  currency: string;
}

export interface Segment {
  mode: Mode;
  carrier?: string;
  number?: string;
  from: Place;
  to: Place;
  depart: string;
  arrive: string;
  durationMin: number;
}

export interface Price {
  amount: number;
  currency: string;
  asOf?: string;
}

export interface Offer {
  id: string;
  provider: ProviderId;
  mode: Mode;
  segments: Segment[];
  price?: Price;
  kind: "live" | "cached" | "timetable";
  bookingUrl?: string;
  attribution?: string;
}

export type ProviderErrorCode =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED_ROUTE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "UPSTREAM_ERROR"
  | "BAD_RESPONSE";

export interface ProviderError {
  provider: ProviderId;
  code: ProviderErrorCode;
  retryable: boolean;
}

export interface TransportProvider {
  id: ProviderId;
  modes: Mode[];
  covers(q: SearchQuery): boolean;
  search(q: SearchQuery, signal: AbortSignal): Promise<Offer[]>;
}

export class ProviderFailure extends Error {
  constructor(readonly code: ProviderErrorCode, readonly retryable = false) {
    super(code);
    this.name = "ProviderFailure";
  }
}
