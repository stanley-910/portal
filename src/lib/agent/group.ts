import type { Composed, ComposeInput, Route } from "@/lib/transport/compose";
import type { Place } from "@/lib/transport/types";

// Getting a group to one place: each member's ways there from where they start (the route optimizer's direct options
// and via routes), then the combination with the lowest total that gets everyone in close together. People already
// know where they're meeting; this is how each of them gets there.

/** Everyone in within this of each other counts as arriving together. */
export const TOGETHER_MIN = 120;
/** Each member's options tried in combination: the direct baseline and the optimizer's alternatives. */
const PER_MEMBER = 4;

export interface Traveller {
  id: string;
  name: string;
  from: Place;
}

export interface GroupPick {
  member: Traveller;
  route: Route;
}

export interface GroupPlan {
  picks: GroupPick[];
  /** Everyone's totals added up, in the asked currency; null when a pick has no total. */
  total: { amount: number; currency: string; converted: boolean } | null;
  /** Minutes between the first and the last arrival. */
  spreadMin: number;
  /** Members no route was found for, with why. */
  missing: { member: Traveller; reason: string }[];
}

export type Compose = (input: ComposeInput) => Promise<Composed>;

const ms = (iso: string) => Date.parse(iso);

/** A member's options to combine: priced ones first, so an unpriced route is only taken when nothing else exists. */
function optionsOf(c: Composed): Route[] {
  const all = [...(c.baseline ? [c.baseline] : []), ...c.routes];
  const priced = all.filter((r) => r.total);
  return (priced.length ? priced : all).slice(0, PER_MEMBER);
}

/**
 * The best combination of one route per member: everyone in within `windowMin` if any combination manages it, then
 * no later than `arriveBy` if given, then the lowest total, then the closest arrivals. Exhaustive: a handful of
 * members with four options each is a few thousand combinations at most.
 */
export function pickGroup(
  options: { member: Traveller; routes: Route[] }[],
  { windowMin = TOGETHER_MIN, arriveBy }: { windowMin?: number; arriveBy?: string } = {},
): GroupPick[] | null {
  const live = options.filter((o) => o.routes.length);
  if (!live.length) return null;
  let best: { picks: GroupPick[]; score: number[] } | null = null;
  const by = arriveBy ? ms(arriveBy) : null;
  const walk = (i: number, chosen: GroupPick[]) => {
    if (i === live.length) {
      const arrivals = chosen.map((p) => ms(p.route.arrive));
      const spread = (Math.max(...arrivals) - Math.min(...arrivals)) / 60_000;
      const late = by === null ? 0 : chosen.filter((p) => ms(p.route.arrive) > by + 15 * 60_000).length;
      const unpriced = chosen.filter((p) => !p.route.total).length;
      const total = chosen.reduce((s, p) => s + (p.route.total?.amount ?? 0), 0);
      // lower is better, compared in order
      const score = [spread <= windowMin ? 0 : 1, late, unpriced, total, spread];
      if (!best || before(score, best.score)) best = { picks: [...chosen], score };
      return;
    }
    for (const route of live[i].routes) walk(i + 1, [...chosen, { member: live[i].member, route }]);
  };
  walk(0, []);
  return best ? (best as { picks: GroupPick[] }).picks : null;
}

/** `a` sorts before `b`, comparing in order. */
function before(a: number[], b: number[]): boolean {
  const k = a.findIndex((v, i) => v !== b[i]);
  return k >= 0 && a[k] < b[k];
}

function summarise(picks: GroupPick[], missing: GroupPlan["missing"]): GroupPlan {
  const totals = picks.map((p) => p.route.total);
  const arrivals = picks.map((p) => ms(p.route.arrive));
  return {
    picks,
    total: totals.every(Boolean) && totals.length
      ? { amount: totals.reduce((s, t) => s + t!.amount, 0), currency: totals[0]!.currency, converted: totals.some((t) => t!.converted) }
      : null,
    spreadMin: arrivals.length ? Math.round((Math.max(...arrivals) - Math.min(...arrivals)) / 60_000) : 0,
    missing,
  };
}

/**
 * Plans everyone's way to `to` on `date`. Each member's routes are found from where they start; when the cheapest
 * mix lands people too far apart, the others are searched again lined up with the latest arrival, so a friend's
 * evening flight pulls the train riders to an evening train rather than leaving them waiting all afternoon.
 */
export async function planGroup(
  input: { travellers: Traveller[]; to: Place; date: string; currency: string; arriveBy?: string; maxFare?: number; windowMin?: number },
  compose: Compose,
): Promise<GroupPlan> {
  const windowMin = input.windowMin ?? TOGETHER_MIN;
  const run = (t: Traveller, arriveNear?: string) =>
    compose({ from: t.from, to: input.to, date: input.date, currency: input.currency, maxFare: input.maxFare, arriveNear, windowMin })
      .then((c) => ({ member: t, routes: optionsOf(c), error: null as string | null }))
      .catch(() => ({ member: t, routes: [] as Route[], error: "the search failed" }));

  let found = await Promise.all(input.travellers.map((t) => run(t, input.arriveBy)));
  let picks = pickGroup(found, { windowMin, arriveBy: input.arriveBy });

  // too far apart and nobody set a time: line the others up with whoever arrives last
  if (picks && !input.arriveBy && picks.length > 1) {
    const arrivals = picks.map((p) => ms(p.route.arrive));
    if ((Math.max(...arrivals) - Math.min(...arrivals)) / 60_000 > windowMin) {
      const anchor = picks.reduce((a, b) => (ms(b.route.arrive) > ms(a.route.arrive) ? b : a));
      const again = await Promise.all(found.map((f) => (f.member.id === anchor.member.id ? f : run(f.member, anchor.route.arrive))));
      // keep both sets of options, so lining up never loses a cheaper pick that already fit
      found = found.map((f, i) => ({ ...f, routes: dedupe([...f.routes, ...again[i].routes]) }));
      picks = pickGroup(found, { windowMin });
    }
  }

  const missing = found.filter((f) => !f.routes.length).map((f) => ({ member: f.member, reason: f.error ?? "no way there was found" }));
  return summarise(picks ?? [], missing);
}

const routeKey = (r: Route) => r.parts.map((p) => `${p.carrier}:${p.number}:${p.depart}`).join(">");
function dedupe(routes: Route[]): Route[] {
  const seen = new Set<string>();
  return routes.filter((r) => !seen.has(routeKey(r)) && !!seen.add(routeKey(r)));
}
