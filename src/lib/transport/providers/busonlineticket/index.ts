import "server-only";
import { env } from "@/lib/env.server";
import { distanceKm } from "../gtfs/geo";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { botRouteUrl } from "./links";
import { seedSchema, type City, type Seed, type SeedRoute } from "./schema";
import seedJson from "./seed.json";

// Seed + link-out, no BOT calls. JB and Singapore centres are ~21 km apart → nearest wins.
const MODES = ["bus"] as const;
const MATCH_KM = 30;
// Fixed offsets in minutes, no DST in any of these zones.
const OFFSET_MIN: Record<City["tz"], number> = {
  "Asia/Kuala_Lumpur": 480,
  "Asia/Singapore": 480,
  "Asia/Bangkok": 420,
};

function nearest(seed: Seed, lat: number, lng: number): string | undefined {
  let best: string | undefined;
  let bestKm = MATCH_KM;
  for (const [key, c] of Object.entries(seed.cities)) {
    const km = distanceKm(lat, lng, c.lat, c.lng);
    if (km <= bestKm) {
      best = key;
      bestKm = km;
    }
  }
  return best;
}

const offset = (tz: City["tz"]) => {
  const m = OFFSET_MIN[tz];
  return `+${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Instant (ms) → local ISO with the zone's fixed offset. */
function local(ms: number, tz: City["tz"]): string {
  return `${new Date(ms + OFFSET_MIN[tz] * 60_000).toISOString().slice(0, 19)}${offset(tz)}`;
}

const carrierKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function createBusOnlineTicketProvider(seed: Seed, opts: { refererId?: string } = {}): TransportProvider {
  const routesFor = (q: SearchQuery): SeedRoute[] => {
    const from = nearest(seed, q.from.lat, q.from.lng);
    const to = nearest(seed, q.to.lat, q.to.lng);
    if (!from || !to || from === to) return [];
    return seed.routes.filter((r) => r.from === from && r.to === to);
  };
  const place = (key: string): Place => {
    const c = seed.cities[key];
    return { name: c.name, lat: c.lat, lng: c.lng, country: c.country, providerIds: { busonlineticket: key } };
  };

  return {
    id: "busonlineticket",
    modes: [...MODES],
    covers: (q) => servesModes(MODES, q) && routesFor(q).length > 0,
    async search(q) {
      const routes = routesFor(q);
      if (routes.length === 0) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return routes
        .flatMap((r) => {
          const to = seed.cities[r.to];
          const bookingUrl = botRouteUrl(seed.cities[r.from].botSlug, to.botSlug, opts.refererId);
          return r.departures.map((hhmm): Offer => {
            const departMs = Date.parse(`${q.date}T${hhmm}:00${offset(r.tz)}`);
            return {
              id: `busonlineticket:${r.from}:${r.to}:${carrierKey(r.carrier)}:${q.date}T${hhmm}`,
              provider: "busonlineticket",
              mode: "bus",
              kind: "timetable",
              segments: [
                {
                  mode: "bus",
                  carrier: r.carrier,
                  from: place(r.from),
                  to: place(r.to),
                  depart: local(departMs, r.tz),
                  arrive: local(departMs + r.durationMin * 60_000, to.tz),
                  durationMin: r.durationMin,
                },
              ],
              bookingUrl,
            };
          });
        })
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}

// Parsed once at module load; a bad seed fails the seed test, not a request.
export default createBusOnlineTicketProvider(seedSchema.parse(seedJson), { refererId: env.BOT_REFERER_ID });
