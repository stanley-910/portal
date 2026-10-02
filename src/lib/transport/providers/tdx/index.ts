import "server-only";
import { distanceKm } from "../gtfs/geo";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { THSR_BOOKING_URL } from "./links";
import { seedSchema, type Seed, type SeedTrain } from "./schema";
import seedJson from "./seed.json";

// THSR seed, no TDX calls (ADR-T04). Provider id stays `tdx`.
const MODES = ["train"] as const;
const MATCH_KM = 20;
const OFFSET = "+08:00"; // Asia/Taipei, no DST
const DAY = 1440;

/** Minutes from midnight of the train's start day; may exceed DAY after midnight. */
interface Leg {
  train: SeedTrain;
  departMin: number;
  arriveMin: number;
}

function nearest(seed: Seed, lat: number, lng: number): string | undefined {
  let best: string | undefined;
  let bestKm = MATCH_KM;
  for (const [key, s] of Object.entries(seed.stations)) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km <= bestKm) {
      best = key;
      bestKm = km;
    }
  }
  return best;
}

/** A smaller HH:MM than the previous stop rolls a day. */
function timeline(t: SeedTrain): Map<string, number> {
  const out = new Map<string, number>();
  let day = 0;
  let prev = -1;
  for (const [station, hhmm] of t.stops) {
    const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (m < prev) day += DAY;
    prev = m;
    out.set(station, day + m);
  }
  return out;
}

/** `date` (YYYY-MM-DD) + `min` minutes, as local ISO with +08:00. */
function at(date: string, min: number): string {
  return `${new Date(Date.parse(`${date}T00:00:00Z`) + min * 60_000).toISOString().slice(0, 19)}${OFFSET}`;
}

export function createTdxProvider(seed: Seed): TransportProvider {
  const timelines = seed.trains.map((train) => ({ train, times: timeline(train) }));

  const legsFor = (q: SearchQuery): { from: string; to: string; legs: Leg[] } | undefined => {
    const from = nearest(seed, q.from.lat, q.from.lng);
    const to = nearest(seed, q.to.lat, q.to.lng);
    if (!from || !to || from === to) return undefined;
    const legs: Leg[] = [];
    for (const { train, times } of timelines) {
      const departMin = times.get(from);
      const arriveMin = times.get(to);
      if (departMin !== undefined && arriveMin !== undefined && arriveMin > departMin) {
        legs.push({ train, departMin, arriveMin });
      }
    }
    return legs.length ? { from, to, legs } : undefined;
  };

  const place = (key: string): Place => {
    const s = seed.stations[key];
    return { name: s.name, lat: s.lat, lng: s.lng, country: "TW", providerIds: { tdx: s.id } };
  };

  return {
    id: "tdx",
    modes: [...MODES],
    covers: (q) => servesModes(MODES, q) && legsFor(q) !== undefined,
    async search(q) {
      const found = legsFor(q);
      if (!found) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      const { from, to, legs } = found;
      return legs
        .flatMap(({ train, departMin, arriveMin }): Offer[] => {
          // q.date is the origin's local date; `days` is keyed on the train's start day.
          const base = Math.floor(departMin / DAY) * DAY;
          const startWeekday = new Date(Date.parse(`${q.date}T00:00:00Z`) - base * 60_000).getUTCDay();
          if (train.days && !train.days.includes(startWeekday)) return [];
          return [
            {
              id: `tdx:${train.number}:${from}:${q.date}`,
              provider: "tdx",
              mode: "train",
              kind: "timetable",
              segments: [
                {
                  mode: "train",
                  carrier: "THSR",
                  number: train.number,
                  from: place(from),
                  to: place(to),
                  depart: at(q.date, departMin - base),
                  arrive: at(q.date, arriveMin - base),
                  durationMin: arriveMin - departMin,
                },
              ],
              bookingUrl: THSR_BOOKING_URL,
            },
          ];
        })
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export default createTdxProvider(seedSchema.parse(seedJson));
