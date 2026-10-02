# Core — PLAN (Architecture)

Written once. Amend only via new `DECISIONS.md` ADR-C entry referenced here.
Codebase orientation: `REFERENCE.md`.

## Goal

One server-side search surface, `GET /api/transport/search`, fans a trip query out to every
provider that covers it (flights, trains, buses, ferries) and returns one normalized `Offer[]`.
Two people build seven adapters in parallel without touching the same file.

## Invariant

> Provider keys never reach the browser, and one slow or dead provider never fails the search.

Every provider call runs in a route handler with a per-provider timeout; failures come back as
`ProviderError` entries beside the offers, never as a 500.

## Topology

```
browser ──GET /api/transport/search?from&to&date&modes──▶ src/app/api/transport/search/route.ts
                                                            │  zod-parse query
                                                            ▼
                                     src/lib/transport/search.ts  fanOut(query)
                                       │ registry.ts: providers.filter(p => p.covers(q))
                                       │ Promise.allSettled, AbortSignal.timeout per provider
        ┌──────────────┬───────────────┼───────────────┬──────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼              ▼
  travelpayouts      12go          tdx (THSR/TRA/bus)  korea-tago     gtfs       busonlineticket …
   (Cata, F)      (Cata S / Ahmet B)  (Ahmet T/B)     (Ahmet T/B)   (Ahmet B)     (Ahmet B)
        └──────────── each: providers/<id>/index.ts, own env vars, own fixtures ──────────┘
                                                            │
                                                            ▼
                               { offers: Offer[], errors: ProviderError[], tookMs }
```

## Contract (C01 lands this verbatim; additive-optional changes only after)

```ts
// src/lib/transport/types.ts
export type Mode = "flight" | "train" | "bus" | "ferry";
export type ProviderId =
  | "travelpayouts" | "12go" | "tdx" | "korea-tago" | "china-rail"
  | "busonlineticket" | "gtfs";

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
```

## Decision table (full ADRs in DECISIONS.md; Rome2Rio dropped per trains ADR-T03)

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | Where provider calls run | Next route handlers, Node runtime | keys server-side; TDX/Korea need server anyway |
| D2 | Parallel work without conflicts | registry with all stubs pre-registered in C01 | each seat edits only its own `providers/<id>/` |
| D3 | Unit test runner | vitest, fixture-only, no network | none exists; adapters are mappers over JSON/XML |
| D4 | Env access | one zod schema `src/lib/env.server.ts`, each var optional | missing key = `NOT_CONFIGURED`, app still boots |
| D5 | Freshness honesty | `Offer.kind` live/cached/timetable | Travelpayouts prices are cached; timetables have no price |

## Phasing

0. Contract + registry stubs + vitest + env (C01, Ahmet)
1. Fan-out route + timeouts + merge + dev smoke page-less curl (C02, Cata)
2. Adapters in parallel: `F*`, `S*` (Cata) · `T*`, `B*` (Ahmet)

## Out of scope

- UI wiring of results onto the globe (separate initiative; POR tickets).
- Booking/payment. We deep-link out.
- Multi-leg itinerary composition across providers (backlog in core STATE).
- Place autocomplete UX. Adapters resolve `Place` → provider station id themselves.
