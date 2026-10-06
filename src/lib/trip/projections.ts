import type { Leg, LegBooking, LegEnd, LegSearch, Stay, Stop, StoredOffer, TripMember } from "@/lib/liveblocks/types";
import { hubById } from "@/lib/transport/hubs/pick";
import type { DatePlan } from "./dates";
import { computeSplit, staysOf, type SplitInput } from "./split";

/** Immutable Liveblocks snapshots. Never mutate these values or their arrays. */
export type PlanSnapshot = {
  legs: Record<string, Omit<Leg, "votes"> & { votes: Record<string, string> }>;
  stops: Record<string, Stop>;
  members: Record<string, TripMember>;
  stays?: Record<string, Stay>;
  ends?: string | null;
};
export type PlanLeg = {
  id: string;
  from: LegEnd & { id: string };
  to: LegEnd & { id: string };
  date: string;
  createdBy: string;
  riders: string[];
  search: LegSearch;
  votes: Record<string, string[]>;
  chosen: StoredOffer | null;
  createdAt: number;
  booking: LegBooking | null;
  bookingNotice: string | null;
};

/** A leg's view of its stop: the hub its end is snapped to, if any, in place of the stop's preview hub. */
function snappedEnd(stop: Stop, snap: string | undefined): LegEnd {
  const hub = hubById(snap);
  return hub ? { ...stop, hub: hub.id, code: hub.code, snapped: true } : stop;
}

// All subscribers to a snapshot share the same projection. Weak keys release old room revisions.
const legLists = new WeakMap<PlanSnapshot["legs"], { stops: PlanSnapshot["stops"]; value: PlanLeg[] }>();
const legRows = new WeakMap<object, { id: string; from: Stop; to: Stop; value: PlanLeg }>();
export function selectPlanLegs(root: PlanSnapshot): PlanLeg[] {
  const old = legLists.get(root.legs);
  if (old?.stops === root.stops) return old.value;
  const out: PlanLeg[] = [];
  for (const [id, leg] of Object.entries(root.legs)) {
    const from = root.stops[leg.from], to = root.stops[leg.to];
    if (!from || !to) continue;
    const cached = legRows.get(leg);
    if (cached?.id === id && cached.from === from && cached.to === to) { out.push(cached.value); continue; }
    const votes: Record<string, string[]> = {};
    for (const [who, offer] of Object.entries(leg.votes)) (votes[offer] ??= []).push(who);
    const value: PlanLeg = {
      id, from: { id: leg.from, ...snappedEnd(from, leg.snap?.from) }, to: { id: leg.to, ...snappedEnd(to, leg.snap?.to) }, date: leg.date, createdBy: leg.createdBy,
      riders: leg.riders, search: leg.search, votes, chosen: leg.search.offers.find((o) => o.id === leg.chosen) ?? null,
      createdAt: leg.createdAt, booking: leg.booking ?? null, bookingNotice: leg.bookingNotice ?? null,
    };
    legRows.set(leg, { id, from, to, value });
    out.push(value);
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  const value = old && old.value.length === out.length && out.every((v, i) => v === old.value[i]) ? old.value : out;
  legLists.set(root.legs, { stops: root.stops, value });
  return value;
}

// Compare compact derived values once per changed snapshot, never once per subscriber.
// This keeps votes/chat/status changes from causing unrelated date/split React commits.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function projection<T>(derive: (root: PlanSnapshot) => T, withStays: boolean) {
  const previous = new WeakMap<object, T>();
  const cache = new WeakMap<object, { members: object; stays?: object; ends?: string | null; value: T }>();
  return (root: PlanSnapshot): T => {
    const old = cache.get(root.legs);
    if (old && old.members === root.members && old.ends === root.ends && (!withStays || old.stays === root.stays)) return old.value;
    const next = derive(root);
    const prior = previous.get(root.stops);
    const value = prior !== undefined && equal(prior, next) ? prior : next;
    previous.set(root.stops, value);
    cache.set(root.legs, { members: root.members, stays: root.stays, ends: root.ends, value });
    return value;
  };
}
const splitInput = (root: PlanSnapshot): SplitInput => ({ members: root.members, legs: root.legs, stays: root.stays, ends: root.ends });
export const selectPlanStays = projection((root) => staysOf(splitInput(root)), true);
export const selectSplit = projection((root) => computeSplit(splitInput(root)), true);
export const selectPlanDates = projection((root): DatePlan => ({
  legs: Object.fromEntries(Object.entries(root.legs).map(([id, l]) => [id, { date: l.date, riders: l.riders, createdAt: l.createdAt, booking: l.booking ?? null }])),
  members: Object.fromEntries(Object.entries(root.members).map(([id, m]) => [id, { leaves: m.leaves ?? null }])),
  ends: root.ends ?? null,
}), false);
