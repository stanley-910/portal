import "server-only";
import hubsJson from "../../hubs/surface-hubs.json";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { ferrySeedSchema, type FerrySeed } from "./schema";
import seedJson from "./seed.json";

// All included ports use fixed Asian offsets. No host/process timezone dependency.
const offsets: Record<string, number> = { "Asia/Singapore": 480, "Asia/Jakarta": 420, "Asia/Seoul": 540, "Asia/Tokyo": 540 };
const hubs = new Map(hubsJson.map((hub) => [hub.id, hub]));
const localIso = (instant: number, offset: number) =>
  `${new Date(instant + offset * 60_000).toISOString().slice(0, 19)}+${String(offset / 60).padStart(2, "0")}:00`;

/** Official published timetable subset; no network, fares, or seat confirmation. */
export function createOfficialFerriesProvider(seed: FerrySeed): TransportProvider {
  const portIds = new Set(seed.routes.flatMap((r) => [r.from, r.to]));
  for (const id of portIds) {
    const hub = hubs.get(id);
    if (!hub || !(hub.timezone in offsets)) throw new Error(`Unknown ferry port/timezone: ${id}`);
  }
  const nearest = (place: Place, radius: number) => {
    // Hub-pair queries must stay at that terminal, even when another is close.
    if ("id" in place && typeof place.id === "string") return portIds.has(place.id) ? place.id : undefined;
    let best: string | undefined;
    let distance = radius;
    for (const id of portIds) {
      const hub = hubs.get(id)!;
      const km = distanceKm(place.lat, place.lng, hub.lat, hub.lng);
      if (km < distance) { best = id; distance = km; }
    }
    return best;
  };
  const routesFor = (q: SearchQuery) => {
    if (q.modes.length && !q.modes.includes("ferry")) return [];
    const radius = matchRadiusKm(q.from, q.to, 30);
    const from = nearest(q.from, radius);
    const to = nearest(q.to, radius);
    if (!from || !to || from === to) return [];
    const weekday = new Date(`${q.date}T12:00:00Z`).getUTCDay();
    return seed.routes.filter((r) => r.from === from && r.to === to && r.weekdays.includes(weekday) &&
      (!r.effectiveFrom || q.date >= r.effectiveFrom));
  };
  return {
    id: "official-ferries",
    modes: ["ferry"],
    covers: (q) => routesFor(q).length > 0,
    async search(q, signal) {
      if (signal.aborted) throw new ProviderFailure("TIMEOUT", true);
      return routesFor(q).flatMap((route) => {
        const from = hubs.get(route.from)!;
        const to = hubs.get(route.to)!;
        return route.departures.map((time): Offer => {
          const utc = Date.parse(`${q.date}T${time}:00Z`) - offsets[from.timezone] * 60_000;
          return {
            id: `official-ferries:${route.id}:${q.date}:${time}`,
            provider: "official-ferries",
            mode: "ferry",
            kind: "timetable",
            segments: [{ mode: "ferry", carrier: route.carrier, from, to,
              depart: localIso(utc, offsets[from.timezone]),
              arrive: localIso(utc + route.durationMin * 60_000, offsets[to.timezone]),
              durationMin: route.durationMin }],
            bookingUrl: route.source,
            attribution: `${route.carrier} — Published typical timetable, checked ${seed.checked}; confirm sailing and seats with operator. ${route.source}` +
              (route.durationSource ? ` Duration estimate: ${route.durationSource}.` : "") +
              ` ${route.note} ${route.noteSource}`,
          };
        });
      });
    },
  };
}

export default createOfficialFerriesProvider(ferrySeedSchema.parse(seedJson));
