import "server-only";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import type { Offer, Place, SearchQuery } from "../../types";
import type { BusSeed, BusTerminals, BusTrip } from "./schema";
import { at, runsOn, timeline } from "./time";

// 國道客運 seed. A city can have several intercity terminals (Taipei: main, Yuanshan, Nangang,
// City Hall), so every terminal within the match radius counts; per trip the one nearest the query point wins.
const MIN_MATCH_KM = 10;

export interface BusSearch {
  covers(q: SearchQuery): boolean;
  /** undefined = no seeded trip connects the two ends (on any day). */
  search(q: SearchQuery): Offer[] | undefined;
}

interface Leg {
  trip: BusTrip;
  from: string;
  to: string;
  departMin: number;
  arriveMin: number;
}

export function createBusSearch(seed: BusSeed, terminals: BusTerminals): BusSearch {
  const trips = seed.trips.map((trip) => ({ trip, times: timeline(trip.stops) }));

  /** terminal key → km from the point, only those within `radiusKm`. */
  const near = (lat: number, lng: number, radiusKm: number): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [key, t] of Object.entries(terminals.terminals)) {
      const km = distanceKm(lat, lng, t.lat, t.lng);
      if (km <= radiusKm) out.set(key, km);
    }
    return out;
  };

  const legsFor = (q: SearchQuery): Leg[] => {
    const radiusKm = matchRadiusKm(q.from, q.to, MIN_MATCH_KM);
    const fromKm = near(q.from.lat, q.from.lng, radiusKm);
    const toKm = near(q.to.lat, q.to.lng, radiusKm);
    if (fromKm.size === 0 || toKm.size === 0) return [];
    const legs: Leg[] = [];
    for (const { trip, times } of trips) {
      const pick = (km: Map<string, number>, after = -1) => {
        let best: string | undefined;
        for (const [key] of trip.stops) {
          const d = km.get(key);
          const t = times.get(key);
          if (d === undefined || t === undefined || t <= after) continue;
          if (best === undefined || d < km.get(best)!) best = key;
        }
        return best;
      };
      const from = pick(fromKm);
      if (!from) continue;
      const departMin = times.get(from)!;
      const to = pick(toKm, departMin);
      if (!to) continue;
      legs.push({ trip, from, to, departMin, arriveMin: times.get(to)! });
    }
    return legs;
  };

  const place = (key: string): Place => {
    const t = terminals.terminals[key];
    return { name: t.name, lat: t.lat, lng: t.lng, country: "TW", providerIds: { tdx: key } };
  };

  return {
    covers: (q) => legsFor(q).length > 0,
    search(q) {
      const legs = legsFor(q);
      if (legs.length === 0) return undefined;
      const seen = new Set<string>();
      return legs.flatMap(({ trip, from, to, departMin, arriveMin }): Offer[] => {
        const base = runsOn(q.date, departMin, trip.days);
        if (base === undefined) return [];
        const depart = at(q.date, departMin - base);
        const id = `tdx:bus:${trip.sub}:${from}:${to}:${depart.slice(0, 16)}`;
        if (seen.has(id)) return [];
        seen.add(id);
        const route = seed.routes[trip.route];
        return [
          {
            id,
            provider: "tdx",
            mode: "bus",
            kind: "timetable",
            segments: [
              {
                mode: "bus",
                carrier: route.operator,
                number: trip.route,
                from: place(from),
                to: place(to),
                depart,
                arrive: at(q.date, arriveMin - base),
                durationMin: arriveMin - departMin,
              },
            ],
            bookingUrl: route.bookingUrl,
          },
        ];
      });
    },
  };
}
