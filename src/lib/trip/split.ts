import { arrivalDate } from "@/lib/transport/arrival";
import type { Stay, StoredOffer, TripMember } from "@/lib/liveblocks/types";

// Who pays for what. Pure: takes the room's Storage as JSON, so the UI and Pip read the same numbers.
// Fares go to each leg's riders and nights to each stay's guests; the two are separate, so riding a leg never puts
// anyone in a hotel, and leaving one doesn't take the other with it.

export type Money = { amount: number; currency: string };

/** Just the Storage the split reads. `getStorageDocument(room, "json")` and the agent's `PlanJson` both fit. */
export type SplitInput = {
  members?: Record<string, Pick<TripMember, "leaves">>;
  legs?: Record<
    string,
    {
      from: string;
      to: string;
      date: string;
      riders: string[];
      search: { offers: (Pick<StoredOffer, "id" | "price" | "kind"> & Partial<Pick<StoredOffer, "arrive" | "depart">>)[] };
      chosen: string | null;
      createdAt: number;
      /** Once a leg is being bought, each rider's share is their fare, whatever the chosen option quoted. */
      booking?: { seats: Record<string, { share: Money }> } | null;
    }
  >;
  stays?: Record<string, Stay>;
  /** Only rooms from before stays had their own dates read it (`staysOf`). */
  ends?: string | null;
};

/** A stay with every field, as `staysOf` reads it: rooms' old stop-keyed stays come out the same way. */
export type PlanStay = {
  id: string;
  stop: string;
  checkIn: string;
  checkOut: string;
  guests: string[];
  nightly: Money | null;
  label: string | null;
  estimated: boolean;
  listing?: Stay["listing"];
  createdAt: number;
};

export type SplitNight = {
  stay: string;
  stop: string;
  /** The night of this date: check in that day, out the next morning. */
  date: string;
  /** Guests sleeping there that night: the stay's guests, less anyone who has left the trip by then. */
  present: string[];
  /** The stay's cost for the night, or null if nobody has priced it. */
  nightly: Money | null;
};

export type MemberSplit = {
  /** One per leg they ride. Null price means the leg has no chosen option yet. */
  fares: { leg: string; price: Money | null; kind: StoredOffer["kind"] | null }[];
  nightShares: { stay: string; stop: string; date: string; share: Money }[];
  /** Currency → amount. Never converted, since offers mix currencies. */
  totals: Record<string, number>;
  missing: ("no_chosen_offer" | "no_stay_cost")[];
};

export type Split = {
  /** The morning after the last night of any stay, or null with none. */
  ends: string | null;
  nights: SplitNight[];
  members: Record<string, MemberSplit>;
};

const DAY_MS = 86_400_000;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
const minDate = (...dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => !!d).reduce<string | null>((a, b) => (a === null || b < a ? b : a), null);

/**
 * Every stay with all its fields. A stay from before stays had their own guests and dates (keyed by stop id, with only
 * a price) becomes one stay per run of nights the old rule gave that stop with the same people in it: riders sleep at a
 * leg's destination until their next leg, they leave, or the trip ends, and never at home. The first keeps the stop id.
 */
export function staysOf(plan: SplitInput): PlanStay[] {
  const out: PlanStay[] = [];
  const legacy: Record<string, Stay> = {};
  for (const [id, stay] of Object.entries(plan.stays ?? {})) {
    if (stay.stop && stay.checkIn && stay.checkOut) {
      out.push({
        id,
        stop: stay.stop,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        guests: stay.guests ?? [],
        nightly: stay.nightly,
        label: stay.label,
        estimated: stay.estimated ?? false,
        ...(stay.listing ? { listing: stay.listing } : {}),
        createdAt: stay.createdAt ?? 0,
      });
    } else legacy[id] = stay;
  }
  if (Object.keys(legacy).length) out.push(...legacyStays(plan, legacy));
  return out.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function legacyStays(plan: SplitInput, legacy: Record<string, Stay>): PlanStay[] {
  const legs = Object.values(plan.legs ?? {}).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const members = plan.members ?? {};
  const latestLeg = legs.map((l) => destinationDate(l)).sort().at(-1);
  const latestLeave = Object.values(members).map((m) => m.leaves).filter((d): d is string => !!d).sort().at(-1);
  const ends = plan.ends ?? latestLeave ?? (latestLeg ? nextDay(latestLeg) : null);
  const ids = new Set(Object.keys(members));
  for (const leg of legs) for (const r of leg.riders) ids.add(r);

  // stop → date → who slept there
  const nights = new Map<string, Map<string, Set<string>>>();
  for (const id of ids) {
    const mine = legs.filter((l) => l.riders.includes(id));
    const home = mine[0]?.from;
    mine.forEach((leg, i) => {
      if (leg.to === home || !legacy[leg.to]) return;
      const until = minDate(mine[i + 1]?.date, members[id]?.leaves, ends);
      for (let d = destinationDate(leg); until && d < until; d = nextDay(d)) {
        const byDate = nights.get(leg.to) ?? new Map<string, Set<string>>();
        nights.set(leg.to, byDate);
        const present = byDate.get(d) ?? new Set<string>();
        byDate.set(d, present.add(id));
      }
    });
  }

  const out: PlanStay[] = [];
  for (const [stop, stay] of Object.entries(legacy)) {
    const dates = [...(nights.get(stop)?.keys() ?? [])].sort();
    const present = (d: string) => [...nights.get(stop)!.get(d)!].sort().join();
    let run = 0;
    for (let i = 0; i < dates.length; ) {
      // a run of consecutive nights with the same people, so everyone keeps paying for exactly the nights they had
      let j = i;
      while (j + 1 < dates.length && dates[j + 1] === nextDay(dates[j]!) && present(dates[j + 1]!) === present(dates[i]!)) j++;
      const guests = nights.get(stop)!.get(dates[i]!)!;
      out.push({
        id: run ? `${stop}#${run + 1}` : stop,
        stop,
        checkIn: dates[i]!,
        checkOut: nextDay(dates[j]!),
        guests: [...guests],
        nightly: stay.nightly,
        label: stay.label,
        estimated: stay.estimated ?? false,
        ...(stay.listing ? { listing: stay.listing } : {}),
        createdAt: 0,
      });
      run++;
      i = j + 1;
    }
  }
  return out;
}

const destinationDate = (leg: NonNullable<SplitInput["legs"]>[string]) =>
  arrivalDate(leg.date, leg.search.offers.find((offer) => offer.id === leg.chosen));

export function computeSplit(plan: SplitInput): Split {
  const legs = Object.entries(plan.legs ?? {}).sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const members = plan.members ?? {};
  const stays = staysOf(plan);

  const out: Record<string, MemberSplit> = {};
  const member = (id: string) => (out[id] ??= { fares: [], nightShares: [], totals: {}, missing: [] });
  for (const id of Object.keys(members)) member(id);

  for (const [legId, leg] of legs) {
    const offer = leg.chosen ? leg.search.offers.find((o) => o.id === leg.chosen) : undefined;
    for (const id of leg.riders) {
      const seat = leg.booking?.seats[id];
      // a settled seat is the price the airline quoted for this rider; a quote from the search is only an estimate of it
      member(id).fares.push(seat ? { leg: legId, price: seat.share, kind: "live" } : { leg: legId, price: offer?.price ?? null, kind: offer?.kind ?? null });
    }
  }

  // each night of a stay is split among its guests still on the trip that night
  const nights: SplitNight[] = [];
  for (const stay of stays) {
    for (let d = stay.checkIn; d < stay.checkOut; d = nextDay(d)) {
      const present = stay.guests.filter((g) => !members[g]?.leaves || d < members[g]!.leaves!);
      if (present.length) nights.push({ stay: stay.id, stop: stay.stop, date: d, present, nightly: stay.nightly });
    }
  }

  const sorted = nights.sort((a, b) => a.date.localeCompare(b.date) || a.stop.localeCompare(b.stop));
  const raw: Record<string, Record<string, number>> = {};
  const add = (id: string, m: Money) => {
    const t = (raw[id] ??= {});
    t[m.currency] = (t[m.currency] ?? 0) + m.amount;
  };

  for (const night of sorted) {
    for (const id of night.present) {
      const split = member(id);
      if (!night.nightly) {
        if (!split.missing.includes("no_stay_cost")) split.missing.push("no_stay_cost");
        continue;
      }
      const share = { amount: night.nightly.amount / night.present.length, currency: night.nightly.currency };
      split.nightShares.push({ stay: night.stay, stop: night.stop, date: night.date, share: { ...share, amount: round(share.amount) } });
      add(id, share);
    }
  }

  for (const [id, split] of Object.entries(out)) {
    for (const fare of split.fares) {
      if (fare.price) add(id, fare.price);
      else if (!split.missing.includes("no_chosen_offer")) split.missing.unshift("no_chosen_offer");
    }
    split.totals = Object.fromEntries(Object.entries(raw[id] ?? {}).map(([c, n]) => [c, round(n)]));
  }

  const ends = stays.map((s) => s.checkOut).sort().at(-1) ?? null;
  return { ends, nights: sorted, members: out };
}

/** A member's night shares grouped by stop, in the order they first stay there: nights and the sum per currency. */
export function nightsByStop(shares: MemberSplit["nightShares"]): { stop: string; nights: number; totals: Record<string, number> }[] {
  const byStop = new Map<string, { stop: string; nights: number; totals: Record<string, number> }>();
  for (const n of shares) {
    const entry = byStop.get(n.stop) ?? { stop: n.stop, nights: 0, totals: {} };
    entry.nights++;
    entry.totals[n.share.currency] = round((entry.totals[n.share.currency] ?? 0) + n.share.amount);
    byStop.set(n.stop, entry);
  }
  return [...byStop.values()];
}

/** What the totals leave out, for the whole group: legs someone rides with no option chosen, and stops with a stay nobody has priced. */
export function splitGaps(split: Split): { legs: string[]; stops: string[] } {
  const legs = new Set<string>();
  for (const m of Object.values(split.members)) for (const f of m.fares) if (!f.price) legs.add(f.leg);
  const stops = new Set(split.nights.filter((n) => !n.nightly && n.present.length).map((n) => n.stop));
  return { legs: [...legs], stops: [...stops] };
}
