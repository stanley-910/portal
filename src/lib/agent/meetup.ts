import type { MeetupLeg, MeetupOption, Money } from "@/lib/agent/types";
import { HUBS } from "@/lib/transport/hubs/catalog";
import { distanceKm } from "@/lib/transport/hubs/geo";
import type { Hub } from "@/lib/transport/hubs/types";
import type { Offer, Place, SearchQuery } from "@/lib/transport/types";

// Where should a split party meet? Two phases, so a run stays inside its provider budget (harness G4):
// 1. score every big city with a distance model, no network;
// 2. search the best few for real and rank those. Arithmetic lives here, never in the model.

export type MeetupGroup = {
  /** Guest ids travelling together. */
  members: string[];
  /** At least 1. */
  people: number;
  stopId: string | null;
  place: Place & { hub: string | null; code: string | null };
};

export type MeetupQuery = {
  groups: MeetupGroup[];
  date: string;
  /** Group total (G8) or the worst-off person. */
  minimize: "price" | "duration";
  fairest: boolean;
  /** Names to restrict to, e.g. ["Shanghai", "Taipei"]. Empty means every big city. */
  candidates: string[];
};

export type MeetupResult = {
  options: MeetupOption[];
  /** Cities scored offline and dropped. */
  pruned: number;
  /** Real searches made. */
  searched: number;
};

type Search = (query: SearchQuery) => Promise<Offer[]>;

/** Cities the meet-up considers: the large hubs, one per city. */
export type City = {
  name: string; lat: number; lng: number; code: string | null; hub: string | null;
  /** Airports and stations in the city: a rough stand-in for how well connected it is. */
  hubs: number;
};

/** "Shanghai (Pudong)" and "Shanghai" are one city. */
const cityName = (hub: Hub) => (hub.city || hub.name).replace(/\s*\(.*\)\s*$/, "").trim();

let cities: City[] | null = null;
export function bigCities(hubs: readonly Hub[] = HUBS): City[] {
  if (hubs === HUBS && cities) return cities;
  const byName = new Map<string, City>();
  const count = new Map<string, number>();
  for (const hub of hubs) if (hub.importance >= 2) count.set(cityName(hub), (count.get(cityName(hub)) ?? 0) + 1);
  for (const hub of hubs) {
    if (hub.importance < 3) continue;
    const name = cityName(hub);
    // prefer the airport's code, so the card can show PVG rather than a station id
    if (!byName.has(name) || hub.mode === "flight" && !byName.get(name)!.code?.match(/^[A-Z]{3}$/)) {
      byName.set(name, { name, lat: hub.lat, lng: hub.lng, code: hub.iata ?? null, hub: hub.id, hubs: count.get(name) ?? 1 });
    }
  }
  const list = [...byName.values()];
  if (hubs === HUBS) cities = list;
  return list;
}

/** Below this, a group is already there. A meet-up means everyone travels. */
const HOME_KM = 150;
/** How many cities get real searches. */
const VERIFY = 3;
const SPARE = 2;

/**
 * Offline guess at one person's trip, in USD and minutes: ground under 300 km, else the F03 flight estimate. A city
 * with several airports and stations has more, and cheaper, routes than distance alone says: up to 24% off.
 */
export function estimateTrip(km: number, hubs = 1) {
  const discount = 1 - 0.08 * Math.min(3, hubs - 1);
  if (km < 300) return { usd: (10 + km * 0.1) * discount, min: 30 + (km / 90) * 60 };
  return { usd: (40 + km * 0.075) * discount, min: 40 + (km / 780) * 60 + 90 };
}

type Scored = { city: City; perGroup: { usd: number; min: number }[] };

/** Lower is better. Group total by default; the worst-off person when fairest. */
function score(q: MeetupQuery, perGroup: { usd: number; min: number }[]) {
  const metric = (g: { usd: number; min: number }) => (q.minimize === "price" ? g.usd : g.min);
  if (q.fairest) return Math.max(...perGroup.map(metric));
  if (q.minimize === "duration") return Math.max(...perGroup.map(metric));
  return perGroup.reduce((sum, g, i) => sum + metric(g) * q.groups[i].people, 0);
}

/** Phase 1: every candidate city, best first, from distance alone. */
export function shortlist(q: MeetupQuery, all: readonly City[] = bigCities()): Scored[] {
  const wanted = q.candidates.map((c) => c.toLowerCase());
  const scored: Scored[] = [];
  for (const city of all) {
    if (wanted.length && !wanted.some((w) => city.name.toLowerCase().includes(w))) continue;
    const kms = q.groups.map((g) => distanceKm(g.place, city));
    if (kms.some((k) => k < HOME_KM)) continue;
    scored.push({ city, perGroup: kms.map((k) => estimateTrip(k, city.hubs)) });
  }
  return scored.sort((a, b) => score(q, a.perGroup) - score(q, b.perGroup));
}

// Fixed rates to compare fares across currencies. Ranking and the "≈ total" only; each leg keeps its own price.
const USD: Record<string, number> = {
  USD: 1, CNY: 0.138, HKD: 0.128, JPY: 0.0067, KRW: 0.00072, TWD: 0.031, THB: 0.028, MYR: 0.21, SGD: 0.74, EUR: 1.08, CAD: 0.73,
};
const toUsd = (p: Money | null) => (p && USD[p.currency.toUpperCase()] !== undefined ? p.amount * USD[p.currency.toUpperCase()] : null);

/** What an option costs everyone, in USD, or null when a leg has no price to compare. */
export function meetupTotal(legs: readonly MeetupLeg[]): Money | null {
  const usd = legs.map((leg) => toUsd(leg.price));
  if (usd.some((u) => u === null)) return null;
  return { amount: Math.round(usd.reduce((sum: number, u, j) => sum + u! * legs[j].people, 0)), currency: "USD" };
}

const durationOf = (o: Offer) => {
  const first = o.segments[0];
  const last = o.segments[o.segments.length - 1];
  const span = (Date.parse(last.arrive) - Date.parse(first.depart)) / 60_000;
  return Number.isFinite(span) && span > 0 ? Math.round(span) : o.segments.reduce((s, x) => s + x.durationMin, 0);
};

function bestOffer(offers: Offer[], minimize: MeetupQuery["minimize"]): Offer | null {
  const usable = offers.filter((o) => o.segments.length);
  if (!usable.length) return null;
  const key = (o: Offer) =>
    minimize === "duration" ? durationOf(o) : toUsd(o.price ? { amount: o.price.amount, currency: o.price.currency } : null) ?? Infinity;
  return usable.reduce((best, o) => (key(o) < key(best) ? o : best));
}

/** Phase 2: real searches for the shortlist, then the final ranking. */
export async function findMeetup(q: MeetupQuery, search: Search, all?: readonly City[]): Promise<MeetupResult> {
  const ranked = shortlist(q, all);
  const pool = ranked.slice(0, VERIFY + SPARE);
  let searched = 0;

  const verified = await Promise.all(
    pool.map(async ({ city }) => {
      const legs = await Promise.all(
        q.groups.map(async (g): Promise<MeetupLeg | null> => {
          searched++;
          const offers = await search({
            from: { name: g.place.name, lat: g.place.lat, lng: g.place.lng },
            to: { name: city.name, lat: city.lat, lng: city.lng },
            date: q.date,
            modes: [],
            passengers: 1,
            currency: "USD",
          }).catch(() => []);
          const best = bestOffer(offers, q.minimize);
          if (!best) return null;
          return {
            members: g.members,
            people: g.people,
            fromStop: g.stopId,
            from: { name: g.place.name, lat: g.place.lat, lng: g.place.lng, hub: g.place.hub, code: g.place.code },
            mode: best.mode,
            carrier: best.segments[0]?.carrier ?? null,
            durationMin: durationOf(best),
            price: best.price ? { amount: best.price.amount, currency: best.price.currency } : null,
            kind: best.kind,
          };
        }),
      );
      return legs.every(Boolean) ? { city, legs: legs as MeetupLeg[] } : null;
    }),
  );

  const metric = (leg: MeetupLeg) => (q.minimize === "duration" ? leg.durationMin : toUsd(leg.price) ?? Infinity);
  const finalScore = (legs: MeetupLeg[]) =>
    q.fairest || q.minimize === "duration"
      ? Math.max(...legs.map(metric))
      : legs.reduce((sum, leg) => sum + metric(leg) * leg.people, 0);

  const options = verified
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => finalScore(a.legs) - finalScore(b.legs))
    .slice(0, VERIFY)
    .map(({ city, legs }, i): MeetupOption => {
      return {
        id: `P${i + 1}`,
        place: { name: city.name, code: city.code, lat: city.lat, lng: city.lng, hub: city.hub },
        date: q.date,
        legs,
        total: meetupTotal(legs),
        estimated: legs.filter((leg) => leg.kind === "estimated").length,
      };
    });

  return { options, pruned: Math.max(0, ranked.length - pool.length), searched };
}
