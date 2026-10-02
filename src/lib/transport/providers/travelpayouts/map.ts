import { z } from "zod";

import { aviasalesUrl } from "./links";
import { airportPlace, toIata } from "./places";
import { ProviderFailure, type Offer, type SearchQuery } from "../../types";

const iata = z.string().regex(/^[A-Z]{3}$/);
const instant = z.iso.datetime({ offset: true });
const flightSchema = z.object({
  origin: iata,
  destination: iata,
  origin_airport: iata.optional(),
  destination_airport: iata.optional(),
  price: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  airline: z.string().trim().min(1),
  flight_number: z.string().trim().min(1),
  departure_at: instant,
  duration_to: z.number().positive().optional(),
  duration: z.number().positive().optional(),
  transfers: z.number().int().nonnegative(),
  link: z.string().optional(),
  found_at: instant.optional(),
}).refine((row) => row.duration_to !== undefined || row.duration !== undefined);

/** Invalid essential data rejects the batch; no invented times or fares. */
export function mapFlights(rows: readonly unknown[], query: SearchQuery, marker?: string): Offer[] {
  const offers: Offer[] = [];
  const origin = toIata(query.from);
  const destination = toIata(query.to);
  for (const raw of rows) {
    const parsed = flightSchema.safeParse(raw);
    if (!parsed.success) throw new ProviderFailure("BAD_RESPONSE");
    const row = parsed.data;
    if (row.currency && row.currency.toUpperCase() !== query.currency.toUpperCase()) {
      throw new ProviderFailure("BAD_RESPONSE");
    }
    // A cached aggregate with transfers cannot honestly become one direct segment.
    if (row.transfers !== 0) continue;
    const fromCode = row.origin_airport ?? row.origin;
    const toCode = row.destination_airport ?? row.destination;
    const fromMatches = query.from.iata ? fromCode === origin : row.origin === origin || fromCode === origin;
    const toMatches = query.to.iata ? toCode === destination : row.destination === destination || toCode === destination;
    if (!fromMatches || !toMatches || row.departure_at.slice(0, 10) !== query.date) continue;

    const durationMin = row.duration_to ?? row.duration!;
    const arrivalMs = Date.parse(row.departure_at) + durationMin * 60_000;
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(new Date(arrivalMs).getTime())) {
      throw new ProviderFailure("BAD_RESPONSE");
    }
    offers.push({
      id: `travelpayouts:${fromCode}-${toCode}-${row.departure_at}-${row.airline}-${row.flight_number}`,
      provider: "travelpayouts",
      mode: "flight",
      segments: [{
        mode: "flight",
        carrier: row.airline,
        number: `${row.airline}${row.flight_number}`,
        from: airportPlace(fromCode, query.from),
        to: airportPlace(toCode, query.to),
        depart: row.departure_at,
        arrive: new Date(arrivalMs).toISOString(),
        durationMin,
      }],
      price: { amount: row.price, currency: query.currency.toUpperCase(), asOf: row.found_at },
      kind: "cached",
      attribution: "Travelpayouts / Aviasales — cached fare per passenger; availability unverified",
      bookingUrl: row.link ? aviasalesUrl(row.link, marker) : undefined,
    });
  }
  return offers;
}
