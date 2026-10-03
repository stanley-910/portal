import { z } from "zod";

import { env } from "@/lib/env.server";

import { fetchJson } from "../../http";
import { ProviderFailure, type SearchQuery } from "../../types";

/** Airlines get this long to answer, well under Duffel's own deadline, so slow airlines drop out instead of us. */
const SUPPLIER_TIMEOUT_MS = 6_000;
/** The fan-out's deadline for Duffel: the airlines' time plus Duffel's own overhead and a 500 KB answer. */
export const DUFFEL_TIMEOUT_MS = 10_000;

const responseSchema = z.object({ data: z.object({ offers: z.array(z.unknown()) }) });

/** One-way offer request for every passenger as an adult. Returns the raw offers; `map.ts` validates them. */
export async function requestOffers(query: SearchQuery, origin: string, destination: string, signal: AbortSignal): Promise<unknown[]> {
  if (!env.DUFFEL_ACCESS_TOKEN) throw new ProviderFailure("NOT_CONFIGURED");
  const params = new URLSearchParams({ return_offers: "true", supplier_timeout: String(SUPPLIER_TIMEOUT_MS) });
  const payload = await fetchJson(`https://api.duffel.com/air/offer_requests?${params}`, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.DUFFEL_ACCESS_TOKEN}`,
      "Duffel-Version": "v2",
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        slices: [{ origin, destination, departure_date: query.date }],
        passengers: Array.from({ length: query.passengers }, () => ({ type: "adult" })),
        cabin_class: "economy",
        max_connections: 1,
      },
    }),
  });
  const response = responseSchema.safeParse(payload);
  if (!response.success) throw new ProviderFailure("BAD_RESPONSE");
  return response.data.data.offers;
}
