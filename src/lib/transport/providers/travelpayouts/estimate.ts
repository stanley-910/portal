import { withTpMarker } from "./links";
import { airportPlace } from "./places";
import type { Offer, SearchQuery } from "../../types";

// The mock fallback every provider needs (AGENTS.md): when there's no cached fare for a pair, the leg still gets a
// flight, clearly marked as an estimate, so the demo never shows an empty leg. Fitted loosely to cached Asian
// economy fares seen on 2026-10-03 (HKG–PVG $146, SIN–HND $279, BKK–ICN $248).

/** Below this, people don't fly. */
export const MIN_FLIGHT_KM = 300;
const CRUISE_KMH = 780;
const OVERHEAD_MIN = 40; // taxi, climb and descent

const km = (q: SearchQuery) => {
  const r = Math.PI / 180;
  const h =
    Math.sin(((q.to.lat - q.from.lat) * r) / 2) ** 2 +
    Math.cos(q.from.lat * r) * Math.cos(q.to.lat * r) * Math.sin(((q.to.lng - q.from.lng) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** A distance-based nonstop estimate, or nothing for a hop too short to fly. */
export function estimateFlight(query: SearchQuery, origin: string, destination: string, marker?: string): Offer[] {
  if (origin === destination) return [];
  const from = airportPlace(origin, query.from);
  const to = airportPlace(destination, query.to);
  const distance = km({ ...query, from, to });
  if (distance < MIN_FLIGHT_KM) return [];
  const durationMin = Math.round(OVERHEAD_MIN + (distance / CRUISE_KMH) * 60);
  // no departure time is known: midnight UTC stands in, and the UI shows "estimated" instead of a time
  const depart = `${query.date}T00:00:00Z`;
  const [, mm, dd] = query.date.split("-");
  return [
    {
      id: `travelpayouts:estimate:${origin}-${destination}-${query.date}`,
      provider: "travelpayouts",
      mode: "flight",
      kind: "estimated",
      attribution: "Travelpayouts / Aviasales search — distance-based estimate; availability unverified",
      segments: [
        {
          mode: "flight",
          from,
          to,
          depart,
          arrive: new Date(Date.parse(depart) + durationMin * 60_000).toISOString(),
          durationMin,
        },
      ],
      price: { amount: Math.round(40 + distance * 0.075), currency: "USD" },
      bookingUrl: withTpMarker(`https://www.aviasales.com/search/${origin}${dd}${mm}${destination}1`, marker),
    },
  ];
}
