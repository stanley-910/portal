import "server-only";
import { EARLIEST_HOUR, groundEstimate, GROUND_NOTE } from "./access";
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
const MAX_GATEWAYS = 5;
/** Stations and airports this far away are worth getting to for a cheaper or better-timed departure. */
const GATEWAY_KM = { flight: 150, train: 100 } as const;
/** Flying from another airport only pays on a trip long enough to fly. */
const FLY_FROM_KM = 300;
/** Nobody takes an early train to sit at a station for half a day... */
const MAX_WAIT_MIN = 180;
/** ...unless it's overnight: the last train in, the first one out in the morning. */
const MAX_OVERNIGHT_MIN = 11 * 60;

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
  /** `ground` is the distance estimate in ./access, not a provider. */
  provider: Offer["provider"] | "ground";
  /** A frequent ground link with no timetable: the times are a plan, not a booking. */
  flexible: boolean;
  /** Where the times and fare come from, when it isn't a provider's own offer. */
  note?: string;
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
// Test inventory is never a real flight or price, an estimate without a schedule can't be chained, and a service
// that lands before it leaves has times nobody can plan around.
const known = (o: Offer) => !o.sandbox && (o.kind !== "estimated" || o.provider === "cross-border") &&
  Date.parse(o.segments.at(-1)!.arrive) > Date.parse(o.segments[0].depart);
/** Ending further than this from where they're going isn't getting there: that's another city. */
const THERE_KM = 50;
/**
 * A train or bus that ends this much further from where they're going than another of its mode stops short: Taipei
 * to Kaohsiung isn't the cheaper train to Tainan, 40 km before Zuoying. The same at the start: it isn't the cheaper
 * train from Taoyuan either, when trains leave from Taipei itself. Flights use the airports there are.
 */
const SHORT_KM = 20;

/**
 * Offers that get as close to `to` (and, given `from`, start as close to it) as their mode can, dropping ground
 * services that stop short of or start further out than the others.
 */
export function closest(offers: Offer[], to: Place, from?: Place): Offer[] {
  const gap = (o: Offer) => ({ end: km(o.segments.at(-1)!.to, to), start: from ? km(o.segments[0].from, from) : 0 });
  const best = new Map<Mode, { end: number; start: number }>();
  for (const o of offers) {
    const g = gap(o), b = best.get(o.mode);
    best.set(o.mode, { end: Math.min(b?.end ?? Infinity, g.end), start: Math.min(b?.start ?? Infinity, g.start) });
  }
  return offers.filter((o) => {
    if (o.mode === "flight") return true;
    const g = gap(o), b = best.get(o.mode)!;
    return g.end <= b.end + SHORT_KM && g.start <= b.start + SHORT_KM;
  });
}

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

/** `iso` moved by `minutes`, written in the same UTC offset. */
function shift(iso: string, minutes: number): string {
  const offset = iso.match(/(Z|[+-]\d\d:\d\d)$/)?.[1] ?? "Z";
  const sign = offset === "Z" ? 0 : (offset[0] === "-" ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const wall = new Date(ms(iso) + (minutes + sign) * 60_000).toISOString().slice(0, 19);
  return `${wall}${offset === "Z" ? "Z" : offset}`;
}

/** The estimated ground trip that reaches `gateway` in time for `next`, leaving where they are. */
function groundBefore(from: Place, gateway: Place, next: Offer, crossing: boolean, currency: string): RoutePart {
  const g = groundEstimate(from, gateway, crossing);
  // in the currency they asked in, so nobody converts it by hand
  const local = approx(g.price.amount, g.price.currency, currency);
  const price = local === null ? g.price : { amount: Math.round(local), currency: currency.toUpperCase() };
  const depart = next.segments[0].depart;
  const arrive = shift(depart, -bufferMin(next, { crossing: false }));
  return {
    mode: "bus", carrier: crossing ? "Ground transfer and border" : "Ground transfer", number: null,
    from, to: gateway, depart: shift(arrive, -g.minutes), arrive,
    price, kind: "estimated", provider: "ground", flexible: true, offerId: `ground:${gateway.name}:${depart}`,
    note: GROUND_NOTE,
  };
}

/** The connector run so it reaches the station `bufferMin` before `next` leaves, inside its service hours. */
function connectorBefore(c: Connector, next: Offer): Offer | null {
  const leaveAt = ms(next.segments[0].depart) - (bufferMin(next, { crossing: true }) + connectorMinutes(c)) * 60_000;
  // its day is the one the next service leaves on, which may be the day after the leg's
  const date = next.segments[0].depart.slice(0, 10);
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
  const q = (from: Place, to: Place, modes: Mode[] = [], date = input.date): SearchQuery =>
    ({ from, to, date, modes, passengers: 1, currency: input.currency });
  const nextDay = new Date(Date.parse(`${input.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  let searched = 1;
  const arrives = (o: Offer) => km(o.segments.at(-1)!.to, input.to) <= THERE_KM;
  // everything that gets there, from wherever it leaves: other stations here are where gateways come from
  const direct = closest((await search(q(input.from, input.to))).filter((o) => o.segments.length && known(o) && arrives(o)), input.to);
  const home = countryOf(input.from);

  // Gateways, best first: where a modelled connector goes, stations the direct search already leaves from that are
  // elsewhere, then the biggest stations and airports nearby. None may add more than a tenth to the trip's length:
  // Macau is a little further from Tokyo than Hong Kong is, but on a long flight that's nothing.
  const gateways: Place[] = [];
  const kinds = new Map<Place, "flight" | "train">();
  const addGateway = (p: Place, kind: "flight" | "train") => {
    const trip = km(input.from, input.to);
    if (here(p, input.from, home) || km(p, input.to) > trip * 1.1) return;
    if (gateways.some((g) => km(g, p) <= SAME_STATION_KM)) return;
    gateways.push(p);
    kinds.set(p, kind);
  };
  const reachable = CONNECTORS.filter((c) => km(input.from, c.from) <= c.radiusKm);
  for (const c of reachable) addGateway(c.to, "train");
  for (const o of direct) addGateway(o.segments[0].from, o.mode === "flight" ? "flight" : "train");
  const flies = km(input.from, input.to) >= FLY_FROM_KM;
  HUBS
    .filter((h) => (h.mode === "train" && h.importance >= 2 && km(h, input.from) <= GATEWAY_KM.train) ||
      (h.mode === "flight" && flies && h.importance >= 3 && km(h, input.from) <= GATEWAY_KM.flight))
    .sort((a, b) => b.importance - a.importance || km(a, input.from) - km(b, input.from))
    .forEach((h) => addGateway(h, h.mode === "flight" ? "flight" : "train"));
  gateways.splice(MAX_GATEWAYS);

  const routes: Route[] = [];
  // direct means from here, and from as close as the mode gets: not the cheaper train from a station 30 km out
  for (const o of closest(direct, input.to, input.from)) if (here(o.segments[0].from, input.from, home)) routes.push(route("direct", [part(o)], input, null));

  await Promise.all(gateways.map(async (g) => {
    const flight = kinds.get(g) === "flight";
    searched += flight ? 2 : 3;
    // the next morning too, for an overnight connection; nobody takes a train to an airport, so none are searched
    const [onward, later, access] = await Promise.all([
      search(q(g, input.to)).catch(() => [] as Offer[]),
      search(q(g, input.to, [], nextDay)).catch(() => [] as Offer[]),
      flight ? Promise.resolve([] as Offer[]) : search(q(input.from, g, ["train", "bus", "ferry"])).catch(() => [] as Offer[]),
    ]);
    const crossing = (() => {
      const a = home, b = countryOf(g);
      return !!a && !!b && a !== b;
    })();
    // Onward trips must actually leave from this station; a different station or the airport needs its own transfer.
    const leaving = closest([...direct, ...onward, ...later].filter((o) => known(o) && arrives(o) && km(o.segments[0].from, g) <= SAME_STATION_KM), input.to);
    const seen = new Set<string>();
    const getThere = access.filter((o) => known(o) && o.provider !== "cross-border" &&
      km(o.segments.at(-1)!.to, g) <= SAME_STATION_KM && here(o.segments[0].from, input.from, home));
    // only a connector that ends at this very station: another one nearby would need a transfer nobody priced
    const connectors = reachable.filter((c) => km(c.to, g) <= SAME_STATION_KM);
    for (const next of leaving) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const leaves = ms(next.segments[0].depart);
      const options: Offer[] = connectors.map((c) => connectorBefore(c, next)).filter((o): o is Offer => !!o)
        // a flexible link timed back from the next morning's service leaves the next day: that's another day's trip
        .filter((o) => o.segments[0].depart.slice(0, 10) === input.date);
      // of the trains that make it, the cheapest and the latest (so nobody waits around for hours, except overnight)
      const making = getThere.filter((o) => {
        const arrives = ms(o.segments.at(-1)!.arrive);
        const overnight = o.segments.at(-1)!.arrive.slice(0, 10) < next.segments[0].depart.slice(0, 10);
        return arrives + bufferMin(next, { crossing: false }) * 60_000 <= leaves &&
          leaves - arrives <= (overnight ? MAX_OVERNIGHT_MIN : MAX_WAIT_MIN) * 60_000;
      });
      const fare = (o: Offer) => (o.price ? approx(o.price.amount, o.price.currency, "USD") ?? Infinity : Infinity);
      const cheapest = [...making].sort((a, b) => fare(a) - fare(b))[0];
      const latest = [...making].sort((a, b) => ms(b.segments.at(-1)!.arrive) - ms(a.segments.at(-1)!.arrive))[0];
      for (const train of new Set([cheapest, latest])) if (train) options.push(train);
      for (const first of options) {
        routes.push(route("via", [part(first, first.provider === "cross-border"), part(next)], input, g));
      }
      // nothing modelled gets there: estimate the trip, on the leg's day and after the first trains. Where a modelled
      // link exists, its own hours rule, so an estimate never stands in for it.
      if (!options.length && !connectors.length) {
        const ground = groundBefore(input.from, g, next, crossing, input.currency);
        const sets = ground.depart.slice(0, 10);
        if (sets === input.date && Number(ground.depart.slice(11, 13)) >= EARLIEST_HOUR) {
          routes.push(route("via", [ground, part(next)], input, g));
        }
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

