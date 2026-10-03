import "server-only";
import { approx } from "./fx";
import { distanceKm } from "./hubs/geo";
import { HUBS } from "./hubs/catalog";
import { connectorMinutes, connectorOffer, CONNECTORS, type Connector } from "./providers/cross-border";
import type { Mode, Offer, Place, SearchQuery } from "./types";

/**
 * Leaving from further than this, or from across a border, means getting to another city first. A city name puts a
 * leg at its airport, which can be 30 km from the stations people mean by the same city (Hong Kong airport to West
 * Kowloon), so distance alone can't tell; Shenzhen North is closer than that to Hong Kong airport, but in China.
 */
const HERE_KM = 40;
/** One station: an arrival and a departure this close need no transfer between them. */
const SAME_STATION_KM = 2;
const MAX_GATEWAYS = 3;
/** Nobody takes an early train to sit at a station for half a day. */
const MAX_WAIT_MIN = 180;

/** Minimum time between arriving and the next departure. */
function bufferMin(next: Offer, after: { crossing: boolean }): number {
  if (next.mode === "flight") return 90;
  return after.crossing ? 25 : 20;
}

export interface RoutePart {
  mode: Mode;
  carrier: string | null;
  number: string | null;
  from: Place;
  to: Place;
  depart: string;
  arrive: string;
  price: { amount: number; currency: string } | null;
  kind: Offer["kind"];
  provider: Offer["provider"];
  /** A frequent ground link with no timetable: the times are a plan, not a booking. */
  flexible: boolean;
  offerId: string;
}

export interface Route {
  id: string;
  /** `direct` leaves from where they asked; `via` gets to another station first. */
  type: "direct" | "via";
  via: Place | null;
  parts: RoutePart[];
  depart: string;
  arrive: string;
  durationMin: number;
  /** Every part priced; in the requested currency, converted roughly when parts differ. */
  total: { amount: number; currency: string; converted: boolean } | null;
  /** Against the cheapest priced direct option, in the same currency; positive is cheaper. */
  saves: number | null;
  /** Minutes from the arrival target, when one was given; positive is later. */
  gapMin: number | null;
  estimated: boolean;
}

export interface ComposeInput {
  from: Place;
  to: Place;
  date: string;
  currency: string;
  /** Per person, in `currency`. */
  maxFare?: number;
  /** Arrive close to this time (ISO; without an offset, local time where they arrive), e.g. when a friend gets in. */
  arriveNear?: string;
  /** How far from `arriveNear` still counts as together. */
  windowMin?: number;
}

export interface Composed {
  /** The cheapest priced direct option, which savings are measured against. */
  baseline: Route | null;
  routes: Route[];
  gateways: Place[];
  searched: number;
}

type Search = (q: SearchQuery) => Promise<Offer[]>;

const km = (a: Place, b: Place) => distanceKm(a, b);

/**
 * A place's ISO country: its own when it's a code, else the nearest hub's, but only when that's clear. Near a border
 * (another country's hub nearly as close) it's unknown, and an unknown country never makes a station elsewhere.
 * Providers sometimes name the country ("Vietnam"), which isn't comparable, so that counts as unknown too.
 */
function countryOf(p: Place): string | null {
  if (p.country && /^[A-Za-z]{2}$/.test(p.country)) return p.country.toUpperCase();
  const near: { country: string; d: number }[] = [];
  for (const h of HUBS) {
    if (!h.country || Math.abs(h.lat - p.lat) > 1 || Math.abs(h.lng - p.lng) > 1) continue;
    const d = km(p, h);
    if (d <= 60) near.push({ country: h.country.toUpperCase(), d });
  }
  near.sort((a, b) => a.d - b.d);
  const [first] = near;
  if (!first) return null;
  const rival = near.find((n) => n.country !== first.country);
  return rival && rival.d - first.d < 15 ? null : first.country;
}

/** Is `station` somewhere you'd leave from when you asked to leave from `origin`? */
function here(station: Place, origin: Place, originCountry: string | null): boolean {
  if (km(station, origin) > HERE_KM) return false;
  const c = countryOf(station);
  return !c || !originCountry || c === originCountry;
}

/** The departure a route's service leaves from, as a key: same service, same departure, one route. */
const serviceKey = (r: Route) =>
  `${r.type}:${r.parts.map((p) => p.flexible ? p.carrier : `${p.carrier}:${p.number}:${p.depart}`).join(">")}`;
const ms = (iso: string) => Date.parse(iso);
// Test inventory is never a real flight or price, and an estimate without a schedule can't be chained.
const known = (o: Offer) => !o.sandbox && (o.kind !== "estimated" || o.provider === "cross-border");

/**
 * Minutes from `target` to `arrive`. A target with no UTC offset ("22:40" as someone said it) is a wall-clock time
 * where they arrive, so it's compared with the arrival's own local time.
 */
export function minutesFrom(target: string, arrive: string): number {
  const zoned = /(?:Z|[+-]\d\d:\d\d)$/.test(target);
  return zoned
    ? Math.round((ms(arrive) - ms(target)) / 60_000)
    : Math.round((Date.parse(`${arrive.slice(0, 16)}Z`) - Date.parse(`${target.slice(0, 16)}Z`)) / 60_000);
}

function part(o: Offer, flexible = false): RoutePart {
  const first = o.segments[0], last = o.segments.at(-1)!;
  return {
    mode: o.mode, carrier: first.carrier ?? null, number: first.number ?? null,
    from: first.from, to: last.to, depart: first.depart, arrive: last.arrive,
    price: o.price ? { amount: o.price.amount, currency: o.price.currency } : null,
    kind: o.kind, provider: o.provider, flexible, offerId: o.id,
  };
}

function route(type: Route["type"], parts: RoutePart[], input: ComposeInput, via: Place | null): Route {
  const depart = parts[0].depart, arrive = parts.at(-1)!.arrive;
  let total: Route["total"] = null;
  if (parts.every((p) => p.price)) {
    const amounts = parts.map((p) => approx(p.price!.amount, p.price!.currency, input.currency));
    if (amounts.every((a) => a !== null)) {
      total = {
        amount: Math.round(amounts.reduce((s, a) => s + a!, 0)),
        currency: input.currency.toUpperCase(),
        converted: parts.some((p) => p.price!.currency.toUpperCase() !== input.currency.toUpperCase()),
      };
    }
  }
  return {
    id: "", type, via, parts, depart, arrive,
    durationMin: Math.round((ms(arrive) - ms(depart)) / 60_000),
    total, saves: null,
    gapMin: input.arriveNear ? minutesFrom(/^\d\d:\d\d$/.test(input.arriveNear) ? `${input.date}T${input.arriveNear}` : input.arriveNear, arrive) : null,
    estimated: parts.some((p) => p.kind !== "live"),
  };
}

/** The connector run so it reaches the station `bufferMin` before `next` leaves, inside its service hours. */
function connectorBefore(c: Connector, next: Offer, date: string): Offer | null {
  const leaveAt = ms(next.segments[0].depart) - (bufferMin(next, { crossing: true }) + connectorMinutes(c)) * 60_000;
  const midnight = ms(`${date}T00:00:00+08:00`);
  const minutes = Math.floor((leaveAt - midnight) / 60_000);
  const [fh, fm] = c.first.split(":").map(Number), [lh, lm] = c.last.split(":").map(Number);
  if (minutes < fh * 60 + fm || minutes > lh * 60 + lm) return null;
  return connectorOffer(c, date, minutes);
}

/**
 * Ways to get from `from` to `to` on `date`: the direct options, and options that first get to a cheaper or better
 * placed station nearby (by a frequent ground link or a short train), then go on from there. Parts are chained with
 * connection buffers, totals are added up, and each route says what it saves against the cheapest direct option and
 * how close it arrives to `arriveNear`. Never invents a fare: a route with an unpriced part has no total.
 */
export async function composeRoutes(input: ComposeInput, search: Search): Promise<Composed> {
  const q = (from: Place, to: Place, modes: Mode[] = []): SearchQuery =>
    ({ from, to, date: input.date, modes, passengers: 1, currency: input.currency });
  let searched = 1;
  const direct = (await search(q(input.from, input.to))).filter((o) => o.segments.length && known(o));
  const home = countryOf(input.from);

  // Gateways: stations the direct search already leaves from that are elsewhere, and places a connector reaches.
  const gateways: Place[] = [];
  const addGateway = (p: Place) => {
    if (km(p, input.to) >= km(input.from, input.to)) return;
    if (!gateways.some((g) => km(g, p) <= SAME_STATION_KM)) gateways.push(p);
  };
  const reachable = CONNECTORS.filter((c) => km(input.from, c.from) <= c.radiusKm);
  for (const c of reachable) addGateway(c.to);
  for (const o of direct) {
    const from = o.segments[0].from;
    // a station is worth a try once it has trains; an airport elsewhere needs a way there nobody models yet
    if (!here(from, input.from, home) && o.mode !== "flight") addGateway(from);
  }
  gateways.splice(MAX_GATEWAYS);

  const routes: Route[] = [];
  for (const o of direct) if (here(o.segments[0].from, input.from, home)) routes.push(route("direct", [part(o)], input, null));

  await Promise.all(gateways.map(async (g) => {
    searched += 2;
    const [onward, access] = await Promise.all([
      search(q(g, input.to)).catch(() => [] as Offer[]),
      search(q(input.from, g, ["train", "bus", "ferry"])).catch(() => [] as Offer[]),
    ]);
    // Onward trips must actually leave from this station; a different station or the airport needs its own transfer.
    const leaving = [...direct, ...onward].filter((o) => known(o) && km(o.segments[0].from, g) <= SAME_STATION_KM);
    const seen = new Set<string>();
    const getThere = access.filter((o) => known(o) && o.provider !== "cross-border" &&
      km(o.segments.at(-1)!.to, g) <= SAME_STATION_KM && here(o.segments[0].from, input.from, home));
    // only a connector that ends at this very station: another one nearby would need a transfer nobody priced
    const connectors = reachable.filter((c) => km(c.to, g) <= SAME_STATION_KM);
    for (const next of leaving) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const leaves = ms(next.segments[0].depart);
      const options: Offer[] = connectors.map((c) => connectorBefore(c, next, input.date)).filter((o): o is Offer => !!o);
      // of the trains that make it, the cheapest and the latest (so nobody waits around for hours)
      const making = getThere.filter((o) => {
        const arrives = ms(o.segments.at(-1)!.arrive);
        return arrives + bufferMin(next, { crossing: false }) * 60_000 <= leaves && leaves - arrives <= MAX_WAIT_MIN * 60_000;
      });
      const fare = (o: Offer) => (o.price ? approx(o.price.amount, o.price.currency, "USD") ?? Infinity : Infinity);
      const cheapest = [...making].sort((a, b) => fare(a) - fare(b))[0];
      const latest = [...making].sort((a, b) => ms(b.segments.at(-1)!.arrive) - ms(a.segments.at(-1)!.arrive))[0];
      for (const train of new Set([cheapest, latest])) if (train) options.push(train);
      for (const first of options) {
        routes.push(route("via", [part(first, first.provider === "cross-border"), part(next)], input, g));
      }
    }
  }));

  const priced = (r: Route) => (r.total ? r.total.amount : Infinity);
  const baseline = routes.filter((r) => r.type === "direct" && r.total).sort((a, b) => priced(a) - priced(b))[0] ?? null;
  for (const r of routes) r.saves = baseline && r.total ? baseline.total!.amount - r.total.amount : null;

  const window = input.windowMin ?? 90;
  const fits = (r: Route) => r.gapMin === null || Math.abs(r.gapMin) <= window;
  const affordable = (r: Route) => input.maxFare === undefined || (r.total !== null && r.total.amount <= input.maxFare);
  const ranked = routes
    .filter((r) => !baseline || serviceKey(r) !== serviceKey(baseline))
    .sort((a, b) =>
      Number(fits(b)) - Number(fits(a)) ||
      Number(affordable(b)) - Number(affordable(a)) ||
      priced(a) - priced(b) ||
      (a.gapMin !== null && b.gapMin !== null ? Math.abs(a.gapMin) - Math.abs(b.gapMin) : 0) ||
      a.durationMin - b.durationMin);
  // One route per way of going (same gateway and onward service), so three answers are three different ideas.
  const distinct: Route[] = [];
  for (const r of ranked) if (!distinct.some((d) => serviceKey(d) === serviceKey(r))) distinct.push(r);
  const picked = distinct.slice(0, 3);
  picked.forEach((r, i) => { r.id = `R${i + 1}` });
  if (baseline) baseline.id = "R0";
  return { baseline, routes: picked, gateways, searched };
}

