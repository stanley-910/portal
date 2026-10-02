import { aviasalesUrl } from "./links";
import { localIso, zoneOf } from "./timezones";
import type { TravelpayoutsFlight } from "./client";
import type { Offer, Place, SearchQuery } from "../../types";

export function mapFlights(rows: TravelpayoutsFlight[], query: SearchQuery, marker?: string): Offer[] {
  return rows.map((row) => {
    const durationMin = row.duration_to ?? row.duration ?? 0;
    // in the destination's local time, like every other provider's arrivals
    const destination = row.destination_airport ?? row.destination;
    const arrive = localIso(new Date(row.departure_at).getTime() + durationMin * 60_000, zoneOf(destination));
    const from: Place = { ...query.from, iata: row.origin_airport ?? row.origin };
    const to: Place = { ...query.to, iata: destination };
    return {
      id: `travelpayouts:${row.origin}-${row.destination}-${row.departure_at}-${row.flight_number}`,
      provider: "travelpayouts",
      mode: "flight",
      segments: [{
        mode: "flight",
        carrier: row.airline,
        number: `${row.airline}${row.flight_number}`,
        from,
        to,
        depart: row.departure_at,
        arrive,
        durationMin,
      }],
      // cached fares include connections but don't list the legs, so the count is all we have
      transfers: row.transfers ?? 0,
      price: { amount: row.price, currency: query.currency.toUpperCase(), asOf: row.found_at },
      kind: "cached",
      bookingUrl: row.link ? aviasalesUrl(row.link, marker) : undefined,
    };
  });
}
