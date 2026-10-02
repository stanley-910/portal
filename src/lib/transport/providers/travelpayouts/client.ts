import { z } from "zod";
import { env } from "@/lib/env.server";

import { fetchJson } from "../../http";
import { ProviderFailure, type SearchQuery } from "../../types";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
});

export async function getPrices(
  query: SearchQuery,
  origin: string,
  destination: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  if (!env.TRAVELPAYOUTS_TOKEN) throw new ProviderFailure("NOT_CONFIGURED");
  const params = new URLSearchParams({
    origin,
    destination,
    departure_at: query.date,
    one_way: "true",
    // The current Offer contract has no connection-summary representation.
    direct: "true",
    sorting: "price",
    currency: query.currency.toLowerCase(),
    market: env.TRAVELPAYOUTS_MARKET,
    limit: "30",
  });
  const payload = await fetchJson(
    `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`,
    {
      signal,
      headers: { "X-Access-Token": env.TRAVELPAYOUTS_TOKEN, "Accept-Encoding": "gzip, deflate" },
      next: { revalidate: 86400 },
    },
  );
  const response = responseSchema.safeParse(payload);
  if (!response.success || (response.data.currency && response.data.currency.toUpperCase() !== query.currency.toUpperCase())) {
    throw new ProviderFailure("BAD_RESPONSE");
  }
  return response.data.data;
}
