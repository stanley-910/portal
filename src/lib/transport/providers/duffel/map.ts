import { z } from "zod";

import { withOffset } from "./time";
import type { Offer, Place, SearchQuery, Segment } from "../../types";

/** Duffel can return a hundred offers for a busy route; the ticket shows a handful. */
export const MAX_OFFERS = 12;

const iata = z.string().regex(/^[A-Z0-9]{2,3}$/);
const placeSchema = z.object({
  iata_code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  city_name: z.string().min(1).nullish(),
  time_zone: z.string().min(1).nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  iata_country_code: z.string().regex(/^[A-Z]{2}$/).nullish(),
});
const carrierSchema = z.object({ name: z.string().trim().min(1), iata_code: iata.nullish() });
const offerSchema = z.object({
  id: z.string().min(1),
  total_amount: z.string().regex(/^\d+(\.\d+)?$/),
  total_currency: z.string().regex(/^[A-Z]{3}$/),
  owner: z.object({ name: z.string().trim().min(1) }),
  slices: z.array(z.object({
    segments: z.array(z.object({
      departing_at: z.string(),
      arriving_at: z.string(),
      origin: placeSchema,
      destination: placeSchema,
      marketing_carrier: carrierSchema,
      marketing_carrier_flight_number: z.string().trim().min(1).nullish(),
      operating_carrier: carrierSchema.nullish(),
    })).min(1),
  })).min(1),
});

function place(p: z.infer<typeof placeSchema>, fallback: Place): Place {
  return {
    name: p.city_name ?? p.name,
    lat: p.latitude ?? fallback.lat,
    lng: p.longitude ?? fallback.lng,
    iata: p.iata_code,
    ...(p.iata_country_code ? { country: p.iata_country_code } : {}),
  };
}

/**
 * Live, bookable offers for the asked route and date, cheapest first. Offers that don't parse, leave from another
 * airport or day, or have times we can't place are dropped one by one rather than failing the batch: Duffel mixes many
 * airlines' answers, and one odd offer shouldn't hide the rest.
 */
export function mapOffers(raw: readonly unknown[], query: SearchQuery, origin: string, destination: string): Offer[] {
  const offers: Offer[] = [];
  for (const item of raw) {
    const parsed = offerSchema.safeParse(item);
    if (!parsed.success) continue;
    const o = parsed.data;
    const legs = o.slices[0].segments;
    if (legs[0].origin.iata_code !== origin || legs.at(-1)!.destination.iata_code !== destination) continue;

    const segments: Segment[] = [];
    for (const s of legs) {
      const depart = withOffset(s.departing_at, s.origin.time_zone);
      const arrive = withOffset(s.arriving_at, s.destination.time_zone);
      const durationMin = depart && arrive ? Math.round((Date.parse(arrive) - Date.parse(depart)) / 60_000) : NaN;
      if (!depart || !arrive || !(durationMin > 0)) break;
      // the operating airline goes up front: US rules require it on the first screen an offer shows
      const marketing = s.marketing_carrier;
      segments.push({
        mode: "flight",
        carrier: s.operating_carrier?.name ?? marketing.name,
        number: marketing.iata_code && s.marketing_carrier_flight_number ? `${marketing.iata_code}${s.marketing_carrier_flight_number}` : undefined,
        from: place(s.origin, query.from),
        to: place(s.destination, query.to),
        depart,
        arrive,
        durationMin,
      });
    }
    if (segments.length !== legs.length || segments[0].depart.slice(0, 10) !== query.date) continue;

    const operators = [...new Set(segments.map((s) => s.carrier))].filter((c) => c !== o.owner.name);
    offers.push({
      id: `duffel:${o.id}`,
      provider: "duffel",
      mode: "flight",
      segments,
      // per passenger, like every other fare we show
      price: { amount: Math.round((Number(o.total_amount) / query.passengers) * 100) / 100, currency: o.total_currency },
      kind: "live",
      attribution: `Duffel — live fare from ${o.owner.name}` + (operators.length ? `; operated by ${operators.join(", ")}` : ""),
    });
  }
  return offers.sort((a, b) => a.price!.amount - b.price!.amount).slice(0, MAX_OFFERS);
}
