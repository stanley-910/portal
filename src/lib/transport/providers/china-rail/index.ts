import "server-only";
import { distanceKm } from "../gtfs/geo";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { tripComTrainUrl } from "./links";
import type { Seed, SeedTrain, Station } from "./schema";
import seedJson from "./seed.json";

const MODES = ["train"] as const;
// The globe snaps to airports, while China Rail stations are often outside the
// airport's city-centre radius (PVG → Shanghai Hongqiao is about 45 km).
const MATCH_KM = 60;
// Both zones are fixed UTC+8, no DST.
const OFFSET = { "Asia/Shanghai": "+08:00", "Asia/Hong_Kong": "+08:00" } as const;


/** Nearest station within MATCH_KM picks the city; every station in that city matches. */
function stationsNear(seed: Seed, lat: number, lng: number): Set<string> {
  let city: string | undefined;
  let bestKm = MATCH_KM;
  for (const s of Object.values(seed.stations)) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km <= bestKm) {
      city = s.city;
      bestKm = km;
    }
  }
  return new Set(Object.keys(seed.stations).filter((k) => city !== undefined && seed.stations[k].city === city));
}

function at(date: string, hhmm: string, offset: string, plusMin = 0): string {
  const wall = Date.parse(`${date}T${hhmm}:00Z`) + plusMin * 60_000;
  return `${new Date(wall).toISOString().slice(0, 19)}${offset}`;
}

export function createChinaRailProvider(seed: Seed): TransportProvider {
  const trainsFor = (q: SearchQuery): SeedTrain[] => {
    const from = stationsNear(seed, q.from.lat, q.from.lng);
    const to = stationsNear(seed, q.to.lat, q.to.lng);
    return seed.trains.filter((t) => from.has(t.from) && to.has(t.to));
  };
  const place = (key: string, s: Station): Place => ({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    country: s.country,
    providerIds: { "china-rail": s.telecode ?? key },
  });

  return {
    id: "china-rail",
    modes: [...MODES],
    covers: (q) => servesModes(MODES, q) && trainsFor(q).length > 0,
    async search(q) {
      const trains = trainsFor(q);
      if (trains.length === 0) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return trains
        .flatMap((t) =>
          t.departures.map((hhmm): Offer => {
            const from = seed.stations[t.from];
            const to = seed.stations[t.to];
            const offset = OFFSET[t.tz];
            return {
              id: `china-rail:${t.number}:${t.from}:${q.date}T${hhmm}`,
              provider: "china-rail",
              mode: "train",
              kind: "timetable",
              segments: [
                {
                  mode: "train",
                  number: t.number,
                  from: place(t.from, from),
                  to: place(t.to, to),
                  depart: at(q.date, hhmm, offset),
                  arrive: at(q.date, hhmm, offset, t.durationMin),
                  durationMin: t.durationMin,
                },
              ],
              price: {
                amount: Math.round(t.durationMin * 1.9),
                currency: "CNY",
                asOf: seed.checked,
              },
              bookingUrl: tripComTrainUrl(from, to, q.date),
            };
          }),
        )
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}

export default createChinaRailProvider(seedJson as Seed);
