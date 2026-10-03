import "server-only";
import { approx } from "./fx";
import { distanceKm } from "./hubs/geo";
import { connectorMinutes, connectorOffer, connectorsFor, CONNECTORS, type Connector } from "./providers/cross-border";
import type { Mode, Offer, Place, SearchQuery } from "./types";

/** Departing further than this from where someone asked to leave means getting to another city first. */
const ELSEWHERE_KM = 15;
/** One station: an arrival and a departure this close need no transfer between them. */
const SAME_STATION_KM = 2;
const MAX_GATEWAYS = 3;

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
  /** Arrive close to this instant (ISO), e.g. when a friend's train gets in. */
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
const ms = (iso: string) => Date.parse(iso);
const known = (o: Offer) => o.kind !== "estimated" || o.provider === "cross-border";

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
    gapMin: input.arriveNear ? Math.round((ms(arrive) - ms(input.arriveNear)) / 60_000) : null,
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

  // Gateways: stations the direct search already leaves from that are elsewhere, and places a connector reaches.
  const gateways: Place[] = [];
  const addGateway = (p: Place) => {
    if (km(p, input.to) >= km(input.from, input.to)) return;
    if (!gateways.some((g) => km(g, p) <= SAME_STATION_KM)) gateways.push(p);
  };
  for (const o of direct) if (km(o.segments[0].from, input.from) > ELSEWHERE_KM) addGateway(o.segments[0].from);
  for (const c of CONNECTORS) if (km(input.from, c.from) <= c.radiusKm) addGateway(c.to);
  gateways.splice(MAX_GATEWAYS);

  const routes: Route[] = [];
  for (const o of direct) {
    if (km(o.segments[0].from, input.from) <= ELSEWHERE_KM) routes.push(route("direct", [part(o)], input, null));
  }

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
      km(o.segments.at(-1)!.to, g) <= SAME_STATION_KM && km(o.segments[0].from, input.from) <= ELSEWHERE_KM);
    const connectors = connectorsFor(input.from, g);
    for (const next of leaving) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const leaves = ms(next.segments[0].depart);
      const options: Offer[] = connectors.map((c) => connectorBefore(c, next, input.date)).filter((o): o is Offer => !!o);
      // the latest train that still makes it, so nobody waits around for hours
      const train = getThere
        .filter((o) => ms(o.segments.at(-1)!.arrive) + bufferMin(next, { crossing: false }) * 60_000 <= leaves)
        .sort((a, b) => ms(b.segments.at(-1)!.arrive) - ms(a.segments.at(-1)!.arrive))[0];
      if (train) options.push(train);
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
    .filter((r) => r !== baseline)
    .sort((a, b) =>
      Number(fits(b)) - Number(fits(a)) ||
      Number(affordable(b)) - Number(affordable(a)) ||
      priced(a) - priced(b) ||
      (a.gapMin !== null && b.gapMin !== null ? Math.abs(a.gapMin) - Math.abs(b.gapMin) : 0) ||
      a.durationMin - b.durationMin);
  // One route per way of going (same gateway and onward service), so three answers are three different ideas.
  const distinct: Route[] = [];
  const key = (r: Route) => `${r.type}:${r.parts.map((p) => p.flexible ? p.carrier : `${p.carrier}:${p.number}:${p.depart}`).join(">")}`;
  for (const r of ranked) if (!distinct.some((d) => key(d) === key(r))) distinct.push(r);
  const picked = distinct.slice(0, 3);
  picked.forEach((r, i) => { r.id = `R${i + 1}` });
  if (baseline) baseline.id = "R0";
  return { baseline, routes: picked, gateways, searched };
}

