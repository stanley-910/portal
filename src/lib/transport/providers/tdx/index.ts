import "server-only";
import { env } from "../../../env.server";
import { createDailyClient, mapDaily, type DailyClient } from "./daily";
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

// Optional dated THSR API plus bundled THSR/國道客運 fallback. Provider id stays `tdx`.
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
            attribution: `THSR typical timetable, checked ${seed.checked}: ${train.source}; seats not checked`,
          },
        ];
      });
    },
  };
}

export function createTdxProvider(seed: Seed, bus?: BusSearch, daily?: DailyClient): TransportProvider {
  const thsr = createThsrSearch(seed);
  const wantsTrain = (q: SearchQuery) => servesModes(["train"], q);
  const busFor = (q: SearchQuery) => (bus && servesModes(["bus"], q) ? bus : undefined);

  const seeded = (q: SearchQuery): Offer[] => [
    ...(wantsTrain(q) ? thsr.search(q) ?? [] : []), ...(busFor(q)?.search(q) ?? []),
  ];
  return {
    id: "tdx",
    modes: [...MODES],
    covers: (q) => (wantsTrain(q) && thsr.covers(q)) || (busFor(q)?.covers(q) ?? false),
    ...(daily ? { fallback: (q: SearchQuery) => seeded(q).map((offer): Offer => ({
      ...offer, kind: "estimated", attribution: `${offer.attribution ?? "TDX"}; bundled fallback because dated timetable was unavailable`,
    })) } : {}),
    async search(q, signal) {
      signal.throwIfAborted();
      if (daily && wantsTrain(q) && thsr.covers(q)) {
        const radius = matchRadiusKm(q.from, q.to, MIN_MATCH_KM);
        const a = nearest(seed, q.from.lat, q.from.lng, radius)!;
        const b = nearest(seed, q.to.lat, q.to.lng, radius)!;
        const from = seed.stations[a], to = seed.stations[b];
        const abort = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
        // Query previous start day too: q.date is the date at the passenger's origin stop.
        const previousDate = new Date(Date.parse(`${q.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        const today = await daily(q.date, abort);
        const previous = await daily(previousDate, abort);
        const dated = mapDaily([...today, ...previous], q, from.id, to.id,
          { name: from.name, lat: from.lat, lng: from.lng, country: "TW" },
          { name: to.name, lat: to.lat, lng: to.lng, country: "TW" });
        return [...dated, ...(busFor(q)?.search(q) ?? [])].sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
      }
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
  env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET
    ? createDailyClient({ clientId: env.TDX_CLIENT_ID, clientSecret: env.TDX_CLIENT_SECRET }) : undefined,
);
