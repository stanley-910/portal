import { env } from "@/lib/env.server";

import { fetchJson } from "../../http";
import type { SearchQuery } from "../../types";

export interface TravelpayoutsFlight {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline: string;
  flight_number: string;
  departure_at: string;
  duration_to?: number;
  duration?: number;
  transfers?: number;
  link?: string;
  found_at?: string;
}

export interface TravelpayoutsResponse {
  success: boolean;
  data?: TravelpayoutsFlight[];
  error?: string | null;
}

export async function getPrices(query: SearchQuery, origin: string, destination: string, signal: AbortSignal) {
  if (!env.TRAVELPAYOUTS_TOKEN) {
    throw new Error("NOT_CONFIGURED");
  }
  const params = new URLSearchParams({
    origin,
    destination,
    departure_at: query.date,
    one_way: "true",
    sorting: "price",
    currency: query.currency.toLowerCase(),
    market: env.TRAVELPAYOUTS_MARKET,
    limit: "30",
  });
  const response = await fetchJson<TravelpayoutsResponse>(
    `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`,
    {
      signal,
      headers: { "X-Access-Token": env.TRAVELPAYOUTS_TOKEN, "Accept-Encoding": "gzip, deflate" },
      next: { revalidate: 86400 },
    },
  );
  if (!response.success) throw new Error("BAD_RESPONSE");
  return response.data ?? [];
}
