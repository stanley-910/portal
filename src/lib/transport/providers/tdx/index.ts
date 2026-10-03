import "server-only";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { createBusSearch, type BusSearch } from "./bus";
import busSeedJson from "./bus-seed.json";
import busTerminalsJson from "./bus-terminals.json";
import { THSR_BOOKING_URL } from "./links";
import { busSeedSchema, busTerminalsSchema, seedSchema, type Seed, type SeedTrain } from "./schema";
import seedJson from "./seed.json";
import { at, runsOn, timeline } from "./time";

// THSR seed + 國道客運 seed, no TDX calls at request time. Provider id stays `tdx`.
const MODES = ["train", "bus"] as const;
const MIN_MATCH_KM = 20;

/** Minutes from midnight of the train's start day; may exceed DAY after midnight. */
interface Leg {
  train: SeedTrain;
  departMin: number;
  arriveMin: number;
}

function nearest(seed: Seed, lat: number, lng: number, radiusKm: number): string | undefined {
  let best: string | undefined;
  let bestKm = radiusKm;
  for (const [key, s] of Object.entries(seed.stations)) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km <= bestKm) {
      best = key;
      bestKm = km;
    }
  }
  return best;
}

function createThsrSearch(seed: Seed) {
  const timelines = seed.trains.map((train) => ({ train, times: timeline(train.stops) }));

  const legsFor = (q: SearchQuery): { from: string; to: string; legs: Leg[] } | undefined => {
    const radiusKm = matchRadiusKm(q.from, q.to, MIN_MATCH_KM);
    const from = nearest(seed, q.from.lat, q.from.lng, radiusKm);
    const to = nearest(seed, q.to.lat, q.to.lng, radiusKm);
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
    covers: (q: SearchQuery) => legsFor(q) !== undefined,
    search(q: SearchQuery): Offer[] | undefined {
      const found = legsFor(q);
      if (!found) return undefined;
      const { from, to, legs } = found;
      return legs.flatMap(({ train, departMin, arriveMin }): Offer[] => {
        const base = runsOn(q.date, departMin, train.days);
        if (base === undefined) return [];
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
      });
    },
  };
}

export function createTdxProvider(seed: Seed, bus?: BusSearch): TransportProvider {
  const thsr = createThsrSearch(seed);
  const wantsTrain = (q: SearchQuery) => servesModes(["train"], q);
  const busFor = (q: SearchQuery) => (bus && servesModes(["bus"], q) ? bus : undefined);

  return {
    id: "tdx",
    modes: [...MODES],
    covers: (q) => (wantsTrain(q) && thsr.covers(q)) || (busFor(q)?.covers(q) ?? false),
    async search(q) {
      const train = wantsTrain(q) ? thsr.search(q) : undefined;
      const buses = busFor(q)?.search(q);
      if (!train && !buses) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return [...(train ?? []), ...(buses ?? [])].sort(
        (a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart),
      );
    },
  };
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export default createTdxProvider(
  seedSchema.parse(seedJson),
  createBusSearch(busSeedSchema.parse(busSeedJson), busTerminalsSchema.parse(busTerminalsJson)),
);
