import "server-only";
import { distanceKm } from "../gtfs/geo";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { SRT_BOOKING_URL } from "./links";
import { seedSchema, type Seed, type SeedTrain, type TrainType } from "./schema";
import seedJson from "./seed.json";

// SRT seed from the TTS timetable, no request-time calls (ADR-T06, core ADR-C08).
const MODES = ["train"] as const;
const MATCH_KM = 15;
const OFFSET = "+07:00"; // Asia/Bangkok, no DST
const DAY = 1440;
const TYPE_LABEL: Record<TrainType, string> = {
  special: "Special Express",
  express: "Express",
  rapid: "Rapid",
  ordinary: "Ordinary",
  local: "Local",
  suburban: "Commuter",
  feeder_dm: "Feeder",
  tourist: "Excursion",
};

/** Minutes from midnight of the train's start day; may exceed DAY after midnight. */
interface Leg {
  train: SeedTrain;
  from: string;
  to: string;
  departMin: number;
  arriveMin: number;
}

/** Nearest station within MATCH_KM picks the city; every station of that city matches (Bangkok's two terminals). */
function cityStations(seed: Seed, lat: number, lng: number): { city?: string; keys: Set<string> } {
  let city: string | undefined;
  let bestKm = MATCH_KM;
  for (const s of Object.values(seed.stations)) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km <= bestKm) {
      city = s.city;
      bestKm = km;
    }
  }
  const keys = Object.keys(seed.stations).filter((k) => city !== undefined && seed.stations[k].city === city);
  return { city, keys: new Set(keys) };
}

/** Stops in running order with minutes; a smaller HH:MM than the previous stop rolls a day. */
function timeline(t: SeedTrain): [string, number][] {
  let day = 0;
  let prev = -1;
  return t.stops.map(([station, hhmm]) => {
    const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (m < prev) day += DAY;
    prev = m;
    return [station, day + m];
  });
}

/** `date` (YYYY-MM-DD) + `min` minutes, as local ISO with +07:00. */
function at(date: string, min: number): string {
  return `${new Date(Date.parse(`${date}T00:00:00Z`) + min * 60_000).toISOString().slice(0, 19)}${OFFSET}`;
}

export function createSrtProvider(seed: Seed): TransportProvider {
  const timelines = seed.trains.map((train) => ({ train, times: timeline(train) }));

  const legsFor = (q: SearchQuery): Leg[] | undefined => {
    const from = cityStations(seed, q.from.lat, q.from.lng);
    const to = cityStations(seed, q.to.lat, q.to.lng);
    if (!from.city || !to.city || from.city === to.city) return undefined;
    const legs: Leg[] = [];
    for (const { train, times } of timelines) {
      const i = times.findIndex(([k]) => from.keys.has(k));
      const j = i < 0 ? -1 : times.findIndex(([k], n) => n > i && to.keys.has(k));
      if (j < 0) continue;
      legs.push({ train, from: times[i][0], to: times[j][0], departMin: times[i][1], arriveMin: times[j][1] });
    }
    return legs.length ? legs : undefined;
  };

  const place = (key: string): Place => {
    const s = seed.stations[key];
    return { name: s.name, lat: s.lat, lng: s.lng, country: s.country ?? "TH", providerIds: { srt: key } };
  };

  return {
    id: "srt",
    modes: [...MODES],
    covers: (q) => servesModes(MODES, q) && legsFor(q) !== undefined,
    async search(q) {
      const legs = legsFor(q);
      if (!legs) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return legs
        .flatMap(({ train, from, to, departMin, arriveMin }): Offer[] => {
          // q.date is the origin's local date; `days` is keyed on the train's start day.
          const base = Math.floor(departMin / DAY) * DAY;
          const startWeekday = new Date(Date.parse(`${q.date}T00:00:00Z`) - base * 60_000).getUTCDay();
          if (train.days && !train.days.includes(startWeekday)) return [];
          return [
            {
              id: `srt:${train.number}:${from}:${q.date}`,
              provider: "srt",
              mode: "train",
              kind: "timetable",
              segments: [
                {
                  mode: "train",
                  carrier: `SRT ${TYPE_LABEL[train.type]}`,
                  number: train.number,
                  from: place(from),
                  to: place(to),
                  depart: at(q.date, departMin - base),
                  arrive: at(q.date, arriveMin - base),
                  durationMin: arriveMin - departMin,
                },
              ],
              bookingUrl: SRT_BOOKING_URL,
            },
          ];
        })
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export default createSrtProvider(seedSchema.parse(seedJson));
