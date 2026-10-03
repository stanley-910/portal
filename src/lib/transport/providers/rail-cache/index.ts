import "server-only";
import { ProviderFailure, type Place, type SearchQuery, type TransportProvider, type Offer } from "../../types";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import { addDays, createScheduleSearch, type CachedJourney } from "./search";
import type { ScheduleCache } from "./schema";
import cacheJson from "./cache.json";

export function createRailCacheProvider(cache: ScheduleCache): TransportProvider {
  const search = createScheduleSearch(cache);
  const stations = Object.entries(cache.stations).filter(([, s]) => s.lat !== undefined && s.lng !== undefined);
  function matches(place: Place, radius: number): Set<string> {
    const explicit = place.providerIds?.["rail-cache"];
    if (explicit) return new Set(cache.stations[explicit]?.lat !== undefined && cache.stations[explicit]?.lng !== undefined ? [explicit] : []);
    return new Set(stations.filter(([, s]) => (!place.country || s.country === place.country) &&
      distanceKm(place.lat, place.lng, s.lat!, s.lng!) <= radius).map(([id]) => id));
  }
  function journeys(q: SearchQuery) {
    if (q.modes.length && !q.modes.includes("train")) return [];
    const radius = matchRadiusKm(q.from, q.to, 15);
    // A wide radius catches several stops of the same train; offer each run once, boarding
    // nearest the origin click and alighting nearest the destination click.
    const best = new Map<string, { journey: CachedJourney; km: number }>();
    for (const journey of search(matches(q.from, radius), matches(q.to, radius), q.date)) {
      const from = cache.stations[journey.from], to = cache.stations[journey.to];
      const km = distanceKm(q.from.lat, q.from.lng, from.lat!, from.lng!) + distanceKm(q.to.lat, q.to.lng, to.lat!, to.lng!);
      const boarding = journey.trip.stops.find((s) => s.station === journey.from)!.departure!;
      const run = `${journey.trip.id}|${addDays(journey.depart.slice(0, 10), -Math.floor(boarding / 86400))}`;
      const kept = best.get(run);
      if (!kept || km < kept.km) best.set(run, { journey, km });
    }
    return [...best.values()].map(({ journey }) => journey).sort((a, b) => a.depart.localeCompare(b.depart) || a.durationMin - b.durationMin);
  }
  function place(id: string): Place {
    const s = cache.stations[id];
    return { name: s.name, country: s.country, lat: s.lat!, lng: s.lng!, providerIds: { "rail-cache": id } };
  }
  return {
    id: "rail-cache", modes: ["train"],
    covers: (q) => journeys(q).length > 0,
    async search(q, signal) {
      signal.throwIfAborted();
      const found = journeys(q).filter((j) => cache.stations[j.from].lat !== undefined && cache.stations[j.to].lat !== undefined);
      if (!found.length) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return found.map((j): Offer => {
        const source = cache.sources[j.trip.source];
        return {
          id: `rail-cache:${j.trip.id}:${j.from}:${j.to}:${j.depart}`, provider: "rail-cache", mode: "train", kind: j.demoReuse ? "estimated" : "timetable",
          segments: [{ mode: "train", carrier: j.trip.operator, number: j.trip.number || undefined,
            from: place(j.from), to: place(j.to), depart: j.depart, arrive: j.arrive, durationMin: j.durationMin }],
          attribution: `${j.demoReuse ? `Demo schedule reused from ${j.trip.calendar.dates?.join(", ")}; operating date unverified` : j.trip.calendar.kind === "typical" ? "Typical timetable; confirm operating day" : "Cached published schedule"} — ${source.group}; captured ${source.retrievedAt?.slice(0, 10) ?? "date unrecorded"}; ${source.url ?? source.path}. Fares and seats not checked.${j.trip.notes ? ` ${j.trip.notes}` : ""}`,
        };
      });
    },
  };
}
export default createRailCacheProvider(cacheJson as ScheduleCache);
