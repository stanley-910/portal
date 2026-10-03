import "server-only";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { tripComTrainUrl } from "./links";
import type { Seed, SeedTrain, Station } from "./schema";
import seedJson from "./seed.json";

const MODES = ["train"] as const;
// The globe snaps to airports, while China Rail stations are often outside the
// airport's city-centre radius (PVG → Shanghai Hongqiao is about 45 km).
const MIN_MATCH_KM = 60;
// Both zones are fixed UTC+8, no DST.
const OFFSET = { "Asia/Shanghai": "+08:00", "Asia/Hong_Kong": "+08:00" } as const;


/** Include adjacent cities too; nearest-city-only matching hides useful rail alternatives. */
function stationsNear(seed: Seed, lat: number, lng: number, radiusKm: number): Set<string> {
  return new Set(Object.entries(seed.stations)
    .filter(([, station]) => distanceKm(lat, lng, station.lat, station.lng) <= radiusKm)
    .map(([id]) => id));
}

function at(date: string, hhmm: string, offset: string, plusMin = 0): string {
  const wall = Date.parse(`${date}T${hhmm}:00Z`) + plusMin * 60_000;
  return `${new Date(wall).toISOString().slice(0, 19)}${offset}`;
}

export function createChinaRailProvider(seed: Seed): TransportProvider {
  const trainsFor = (q: SearchQuery): SeedTrain[] => {
    const radiusKm = matchRadiusKm(q.from, q.to, MIN_MATCH_KM);
    const from = stationsNear(seed, q.from.lat, q.from.lng, radiusKm);
    const to = stationsNear(seed, q.to.lat, q.to.lng, radiusKm);
    const km = (a: Place, b: Place) => distanceKm(a.lat, a.lng, b.lat, b.lng);
    const direct = km(q.from, q.to);
    return seed.trains.filter((t) => {
      if (!from.has(t.from) || !to.has(t.to)) return false;
      const a = seed.stations[t.from], b = seed.stations[t.to];
      const access = km(q.from, a), egress = km(b, q.to);
      return km(a, q.to) > egress && km(b, q.from) > access &&
        access + km(a, b) + egress <= direct * 1.75 + 25;
    });
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
              ...(t.fare && { price: { amount: t.fare.amount, currency: t.fare.currency, asOf: seed.checked } }),
        attribution: t.fare
          ? `Typical China rail timetable, checked ${seed.checked}: ${t.source}. Second-class fare as published at ${t.fare.source}; real fares vary by train and date, seats not checked`
          : `Typical China rail timetable, checked ${seed.checked}: ${t.source}; fare and seats not checked`,
              bookingUrl: tripComTrainUrl(from, to, q.date),
            };
          }),
        )
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}

export default createChinaRailProvider(seedJson as Seed);
